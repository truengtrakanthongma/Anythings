import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { newId, useLocalStorage } from '../hooks/useLocalStorage'
import {
  GENDER_TH,
  SAMPLE_RATE,
  concatPcm,
  downloadBlob,
  encodeWav,
  groupGoogleVoices,
  pcmSeconds,
  renderText,
  silence,
  timestamp,
  useGoogleVoices,
  voiceLang,
  voiceTier,
  type GoogleVoice,
} from '../tts/google'
import {
  STYLE_PRESETS,
  buildSegments,
  findPreset,
  groupVoices,
  isSpeechSupported,
  useSpeechPlayer,
  useVoices,
  type PlayerStatus,
  type Segment,
  type VoiceSettings,
} from '../tts/speech'

type Engine = 'browser' | 'google'

interface Character extends VoiceSettings {
  id: string
  name: string
  color: string
  /** เสียงของ Google Cloud ('' = อัตโนมัติ) */
  googleVoice?: string
}

interface ScriptLine {
  index: number
  text: string
  pauseMs?: number
  character?: Character
  /** ชื่อตัวละครที่พิมพ์ไว้แต่ไม่พบในรายชื่อ */
  unknownName?: string
}

interface GoogleCtx {
  apiKey: string
  voices: GoogleVoice[]
  showAll: boolean
  ready: boolean
}

const COLORS = ['#6366f1', '#ec4899', '#0ea5e9', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#14b8a6']

const preset = (id: string) => {
  const p = STYLE_PRESETS.find((s) => s.id === id) ?? STYLE_PRESETS[0]
  return { rate: p.rate, pitch: p.pitch, volume: p.volume }
}

const DEFAULT_CHARACTERS: Character[] = [
  { id: 'narrator', name: 'ผู้บรรยาย', color: COLORS[0], voiceURI: '', ...preset('narrator') },
  { id: 'anna', name: 'Anna', color: COLORS[1], voiceURI: '', ...preset('child') },
  { id: 'tom', name: 'Tom', color: COLORS[2], voiceURI: '', rate: 1, pitch: 0.7, volume: 1 },
]

const SAMPLE_SCRIPT = `ผู้บรรยาย: วันนี้เราจะมาฝึกบทสนทนาภาษาอังกฤษเรื่อง การแนะนำตัว กันนะ
Anna: Hello! My name is Anna. What's your name?
Tom: Hi Anna, I'm Tom. Nice to meet you.
Anna: Nice to meet you too. Where are you from?
Tom: I'm from Chiang Mai, Thailand.
[หยุด 1.5]
ผู้บรรยาย: เก่งมาก! ทีนี้ลองพูดตามทีละประโยคนะ`

const DEFAULT_SINGLE: VoiceSettings & { text: string; googleVoice?: string } = {
  text: 'สวัสดีครับ ยินดีต้อนรับสู่โปรแกรมพากย์เสียง ลองพิมพ์ข้อความแล้วเลือกรูปแบบเสียงได้เลย\nHello everyone, welcome to our English class!',
  voiceURI: '',
  ...preset('normal'),
}

const card = 'rounded-xl bg-white p-5 shadow-sm'
const btn = 'rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40'
const selectCls =
  'w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none'

function parseScript(script: string, characters: Character[]): ScriptLine[] {
  const byName = new Map(characters.map((c) => [c.name.trim().toLowerCase(), c]))
  const narrator = characters[0]
  const lines: ScriptLine[] = []

  for (const raw of script.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const index = lines.length

    const pause = line.match(/^\[\s*(?:หยุด|พัก|pause)\s*([\d.]+)?\s*(?:วินาที|วิ|s|sec)?\s*\]$/i)
    if (pause) {
      const secs = Math.min(Number(pause[1] ?? 1) || 1, 30)
      lines.push({ index, text: `หยุด ${secs} วินาที`, pauseMs: secs * 1000 })
      continue
    }

    const m = line.match(/^([^:：]{1,30})[:：]\s*(.+)$/)
    if (m) {
      const name = m[1].trim()
      const found = byName.get(name.toLowerCase())
      lines.push({ index, text: m[2].trim(), character: found ?? narrator, unknownName: found ? undefined : name })
      continue
    }

    lines.push({ index, text: line, character: narrator })
  }
  return lines
}

/** ชื่อไฟล์ใช้เฉพาะอักษรอังกฤษ/ตัวเลข — บางเบราว์เซอร์ตัดชื่อไฟล์ภาษาไทยทิ้งเหลือแค่ "download" */
function asciiName(s: string) {
  return s.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30)
}

/* ---------- เครื่องเล่นเสียงตัวอย่าง (Google) ---------- */

function usePreviewAudio() {
  const ref = useRef<HTMLAudioElement | null>(null)
  const stop = () => {
    if (!ref.current) return
    ref.current.pause()
    URL.revokeObjectURL(ref.current.src)
    ref.current = null
  }
  useEffect(() => stop, [])
  return {
    play(pcm: Int16Array) {
      stop()
      const audio = new Audio(URL.createObjectURL(encodeWav(pcm)))
      ref.current = audio
      void audio.play().catch(() => {})
    },
    stop,
  }
}

interface RenderResult {
  url: string
  blob: Blob
  seconds: number
  /** เวลาเริ่ม (วินาที) ของแต่ละบรรทัด */
  offsets: number[]
  signature: string
}

function useRenderResult() {
  const [result, setResult] = useState<RenderResult | null>(null)
  const urlRef = useRef<string | null>(null)
  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
  }, [])
  function set(pcm: Int16Array, offsets: number[], signature: string) {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    const blob = encodeWav(pcm)
    const url = URL.createObjectURL(blob)
    urlRef.current = url
    setResult({ url, blob, seconds: pcmSeconds(pcm), offsets, signature })
  }
  return [result, set] as const
}

/* ---------- ส่วนประกอบย่อย ---------- */

function BrowserVoiceSelect({
  value,
  onChange,
  voices,
}: {
  value: string
  onChange: (uri: string) => void
  voices: SpeechSynthesisVoice[]
}) {
  const groups = useMemo(() => groupVoices(voices), [voices])
  const missing = value && !voices.some((v) => v.voiceURI === value)
  return (
    <select className={selectCls} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">✨ อัตโนมัติ (ไทยใช้เสียงไทย / อังกฤษใช้เสียงอังกฤษ)</option>
      {missing && <option value={value}>(เสียงที่บันทึกไว้ไม่มีในเครื่องนี้)</option>}
      {groups.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.voices.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {v.name} — {v.lang}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

function GoogleVoiceSelect({
  value,
  onChange,
  google,
}: {
  value: string
  onChange: (name: string) => void
  google: GoogleCtx
}) {
  const groups = useMemo(() => groupGoogleVoices(google.voices, google.showAll), [google.voices, google.showAll])
  const missing = value && google.ready && !google.voices.some((v) => v.name === value)
  return (
    <select className={selectCls} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">✨ อัตโนมัติ (ไทยใช้เสียงไทย / อังกฤษใช้เสียงอังกฤษ)</option>
      {missing && <option value={value}>(ไม่พบเสียง {value})</option>}
      {groups.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.voices.map((v) => (
            <option key={v.name} value={v.name}>
              {v.name.slice(voiceLang(v).length + 1)} · {GENDER_TH[v.ssmlGender] ?? '-'} · {voiceLang(v)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

function StylePicker({
  settings,
  onChange,
  compact = false,
}: {
  settings: VoiceSettings
  onChange: (s: Partial<VoiceSettings>) => void
  compact?: boolean
}) {
  const active = findPreset(settings.rate, settings.pitch, settings.volume)
  if (compact) {
    return (
      <select
        className={selectCls}
        value={active?.id ?? ''}
        onChange={(e) => {
          const p = STYLE_PRESETS.find((s) => s.id === e.target.value)
          if (p) onChange({ rate: p.rate, pitch: p.pitch, volume: p.volume })
        }}
      >
        {!active && <option value="">🎚️ กำหนดเอง</option>}
        {STYLE_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.icon} {p.label}
          </option>
        ))}
      </select>
    )
  }
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {STYLE_PRESETS.map((p) => (
        <button
          key={p.id}
          title={p.hint}
          onClick={() => onChange({ rate: p.rate, pitch: p.pitch, volume: p.volume })}
          className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
            active?.id === p.id
              ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
              : 'border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          <span className="mr-1">{p.icon}</span>
          {p.label}
          <span className="block text-xs text-slate-400">{p.hint}</span>
        </button>
      ))}
    </div>
  )
}

function Sliders({
  settings,
  onChange,
}: {
  settings: VoiceSettings
  onChange: (s: Partial<VoiceSettings>) => void
}) {
  const rows = [
    { key: 'rate', label: 'ความเร็ว', min: 0.5, max: 2, step: 0.05, fmt: (v: number) => `${v.toFixed(2)}x` },
    { key: 'pitch', label: 'ระดับเสียง (สูง-ต่ำ)', min: 0, max: 2, step: 0.05, fmt: (v: number) => v.toFixed(2) },
    { key: 'volume', label: 'ความดัง', min: 0, max: 1, step: 0.05, fmt: (v: number) => `${Math.round(v * 100)}%` },
  ] as const
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <label key={r.key} className="block text-xs text-slate-500">
          <span className="flex justify-between">
            <span>{r.label}</span>
            <span className="font-medium text-slate-700">{r.fmt(settings[r.key])}</span>
          </span>
          <input
            type="range"
            className="w-full accent-indigo-600"
            min={r.min}
            max={r.max}
            step={r.step}
            value={settings[r.key]}
            onChange={(e) => onChange({ [r.key]: Number(e.target.value) })}
          />
        </label>
      ))}
    </div>
  )
}

function PlayerControls({
  status,
  onPlay,
  onPause,
  onResume,
  onStop,
  playLabel = '▶ เล่นเสียง',
  disabled,
}: {
  status: PlayerStatus
  onPlay: () => void
  onPause: () => void
  onResume: () => void
  onStop: () => void
  playLabel?: string
  disabled?: boolean
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <button className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700`} onClick={onPlay} disabled={disabled}>
        {status === 'idle' ? playLabel : '↺ เริ่มใหม่'}
      </button>
      {status === 'playing' && (
        <button className={`${btn} bg-amber-100 text-amber-800 hover:bg-amber-200`} onClick={onPause}>
          ⏸ หยุดชั่วคราว
        </button>
      )}
      {status === 'paused' && (
        <button className={`${btn} bg-emerald-100 text-emerald-800 hover:bg-emerald-200`} onClick={onResume}>
          ⏵ เล่นต่อ
        </button>
      )}
      <button className={`${btn} bg-slate-100 text-slate-700 hover:bg-slate-200`} onClick={onStop} disabled={status === 'idle'}>
        ■ หยุด
      </button>
    </div>
  )
}

function AudioResultPanel({
  result,
  filename,
  stale,
  audioRef,
  onTimeUpdate,
}: {
  result: RenderResult
  filename: string
  stale: boolean
  audioRef?: RefObject<HTMLAudioElement | null>
  onTimeUpdate?: (t: number) => void
}) {
  const sizeMb = (result.blob.size / 1024 / 1024).toFixed(1)
  return (
    <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-medium text-emerald-800">
          ✅ ไฟล์เสียงพร้อมแล้ว · ยาว {result.seconds.toFixed(1)} วินาที · {sizeMb} MB
        </span>
        <button
          className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}
          onClick={() => downloadBlob(result.blob, filename)}
        >
          ⬇ ดาวน์โหลด (.wav)
        </button>
      </div>
      {stale && (
        <p className="text-xs text-amber-700">⚠ มีการแก้ไขข้อความหรือเสียงหลังสร้างไฟล์ — กดสร้างใหม่เพื่ออัปเดต</p>
      )}
      <audio
        ref={audioRef}
        key={result.url}
        src={result.url}
        controls
        autoPlay
        className="w-full"
        onTimeUpdate={(e) => onTimeUpdate?.(e.currentTarget.currentTime)}
        onEnded={() => onTimeUpdate?.(-1)}
      />
      <p className="text-xs text-emerald-700">
        ไฟล์ .wav ใช้ได้กับ CapCut, Canva, Clipchamp, PowerPoint และโปรแกรมตัดต่อวิดีโอทั่วไป
      </p>
    </div>
  )
}

function ErrorBox({ message }: { message: string }) {
  if (!message) return null
  return <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">⚠ {message}</div>
}

/* ---------- ตั้งค่า Google Cloud ---------- */

function GoogleSetup({
  apiKey,
  setApiKey,
  status,
  error,
  voices,
  reload,
  showAll,
  setShowAll,
}: {
  apiKey: string
  setApiKey: (k: string) => void
  status: 'idle' | 'loading' | 'ok' | 'error'
  error: string
  voices: GoogleVoice[]
  reload: () => void
  showAll: boolean
  setShowAll: (v: boolean) => void
}) {
  const [show, setShow] = useState(false)
  const thaiCount = voices.filter((v) => voiceLang(v).startsWith('th')).length
  const tiers = Array.from(new Set(voices.filter((v) => voiceLang(v).startsWith('th')).map((v) => voiceTier(v.name))))

  return (
    <div className={`${card} space-y-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-slate-700">☁️ ตั้งค่า Google Cloud Text-to-Speech</h3>
        {status === 'ok' && (
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">
            เชื่อมต่อแล้ว · เสียงไทย {thaiCount} เสียง {tiers.length > 0 && `(${tiers.join(', ')})`}
          </span>
        )}
        {status === 'loading' && <span className="text-xs text-slate-500">กำลังตรวจสอบ API key...</span>}
      </div>

      <div className="flex gap-2">
        <input
          type={show ? 'text' : 'password'}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value.trim())}
          placeholder="วาง API key ที่นี่ (ขึ้นต้นด้วย AIza...)"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-indigo-400 focus:outline-none"
          autoComplete="off"
          spellCheck={false}
        />
        <button className={`${btn} bg-slate-100 text-slate-700 hover:bg-slate-200`} onClick={() => setShow((s) => !s)}>
          {show ? 'ซ่อน' : 'แสดง'}
        </button>
        {status === 'error' && (
          <button className={`${btn} bg-indigo-50 text-indigo-700 hover:bg-indigo-100`} onClick={reload}>
            ลองใหม่
          </button>
        )}
      </div>
      <ErrorBox message={status === 'error' ? error : ''} />

      <label className="flex items-center gap-2 text-xs text-slate-500">
        <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
        แสดงเสียงภาษาอื่น ๆ ด้วย (จีน ญี่ปุ่น เกาหลี ฯลฯ)
      </label>

      <details open={status !== 'ok'} className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
        <summary className="cursor-pointer font-medium text-slate-700">วิธีขอ API key (ทำครั้งเดียว ประมาณ 10 นาที)</summary>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5">
          <li>
            เข้า{' '}
            <a className="text-indigo-600 underline" href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">
              console.cloud.google.com
            </a>{' '}
            ด้วยบัญชี Google แล้วสร้างโปรเจกต์ใหม่ (New Project)
          </li>
          <li>
            ผูกบัญชีชำระเงิน (Billing) — Google ขอบัตรเพื่อยืนยันตัวตน แต่ถ้าใช้ไม่เกินโควตาฟรีรายเดือนจะไม่ถูกเรียกเก็บเงิน
          </li>
          <li>
            ไปที่ <b>APIs &amp; Services → Library</b> ค้นหา <b>Cloud Text-to-Speech API</b> แล้วกด <b>Enable</b>
          </li>
          <li>
            ไปที่ <b>APIs &amp; Services → Credentials → Create credentials → API key</b> แล้วคัดลอกมาวางในช่องด้านบน
          </li>
        </ol>
        <p className="mt-3 font-medium text-slate-700">🔒 ความปลอดภัย (แนะนำมาก)</p>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>
            ตั้งค่า key: <b>API restrictions</b> → เลือกเฉพาะ Cloud Text-to-Speech API และ <b>Website restrictions</b> →
            ใส่ที่อยู่เว็บของโปรแกรมนี้
          </li>
          <li>
            ตั้ง <b>Billing → Budgets &amp; alerts</b> เช่น งบ 10 บาท/เดือน เพื่อให้แจ้งเตือนทางอีเมลหากมีค่าใช้จ่าย
          </li>
          <li>key ถูกเก็บไว้ในเบราว์เซอร์ของเครื่องนี้เท่านั้น อย่าแชร์ key ให้คนอื่น</li>
        </ul>
      </details>
    </div>
  )
}

/* ---------- โหมดข้อความเดียว ---------- */

function SingleMode({
  engine,
  browserVoices,
  google,
}: {
  engine: Engine
  browserVoices: SpeechSynthesisVoice[]
  google: GoogleCtx
}) {
  const [state, setState] = useLocalStorage('tts-single', DEFAULT_SINGLE)
  const player = useSpeechPlayer()
  const [segments, setSegments] = useState<Segment[]>([])
  const [result, setResult] = useRenderResult()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const update = (s: Partial<typeof state>) => setState((prev) => ({ ...prev, ...s }))

  const signature = JSON.stringify([state.text, state.googleVoice ?? '', state.rate, state.pitch, state.volume])

  function playBrowser() {
    const segs = buildSegments(state.text, state, browserVoices, 0).map((s, i) => ({ ...s, tag: i }))
    setSegments(segs)
    player.play(segs)
  }

  async function renderGoogle() {
    setBusy(true)
    setError('')
    try {
      const pcm = await renderText(google.apiKey, state.text, state, google.voices)
      setResult(pcm, [0], signature)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className={`${card} space-y-4`}>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <h3 className="font-semibold text-slate-700">ข้อความที่ต้องการพากย์</h3>
            <span className="text-xs text-slate-400">{state.text.length} ตัวอักษร</span>
          </div>
          <textarea
            className="h-48 w-full resize-y rounded-lg border border-slate-300 p-3 text-sm leading-relaxed focus:border-indigo-400 focus:outline-none"
            value={state.text}
            onChange={(e) => update({ text: e.target.value })}
            placeholder="พิมพ์หรือวางข้อความที่นี่..."
          />
        </div>

        {engine === 'browser' ? (
          <>
            <PlayerControls
              status={player.status}
              onPlay={playBrowser}
              onPause={player.pause}
              onResume={player.resume}
              onStop={player.stop}
              disabled={!state.text.trim()}
            />
            {player.status !== 'idle' && segments.length > 0 && (
              <div className="rounded-lg bg-slate-50 p-3 text-sm leading-relaxed">
                <p className="mb-1 text-xs text-slate-400">
                  กำลังอ่านส่วนที่ {(player.activeTag ?? 0) + 1}/{segments.length}
                </p>
                {segments.map((s) => (
                  <span
                    key={s.tag}
                    className={`mr-1 rounded px-0.5 ${player.activeTag === s.tag ? 'bg-yellow-200 text-slate-900' : 'text-slate-500'}`}
                  >
                    {s.text}
                  </span>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="space-y-3">
            <button
              className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700`}
              onClick={renderGoogle}
              disabled={!state.text.trim() || !google.ready || busy}
            >
              {busy ? '⏳ กำลังสร้างเสียง...' : '🎧 สร้างไฟล์เสียง'}
            </button>
            {!google.ready && <p className="text-xs text-slate-500">ใส่ API key ด้านบนก่อนจึงจะสร้างเสียงได้</p>}
            <ErrorBox message={error} />
            {result && (
              <AudioResultPanel
                result={result}
                filename={`voiceover-${timestamp()}.wav`}
                stale={result.signature !== signature}
              />
            )}
          </div>
        )}

        <div>
          <h3 className="mb-2 font-semibold text-slate-700">รูปแบบเสียง</h3>
          <StylePicker settings={state} onChange={update} />
        </div>
      </div>

      <div className={`${card} space-y-4 self-start`}>
        <div>
          <h3 className="mb-2 font-semibold text-slate-700">เสียงผู้พากย์</h3>
          {engine === 'browser' ? (
            <>
              <BrowserVoiceSelect value={state.voiceURI} onChange={(voiceURI) => update({ voiceURI })} voices={browserVoices} />
              <p className="mt-1 text-xs text-slate-400">มีเสียงให้เลือก {browserVoices.length} เสียงในเบราว์เซอร์นี้</p>
            </>
          ) : (
            <GoogleVoiceSelect
              value={state.googleVoice ?? ''}
              onChange={(googleVoice) => update({ googleVoice })}
              google={google}
            />
          )}
        </div>
        <div>
          <h3 className="mb-2 font-semibold text-slate-700">ปรับละเอียด</h3>
          <Sliders settings={state} onChange={update} />
        </div>
      </div>
    </div>
  )
}

/* ---------- โหมดบทพากย์หลายตัวละคร ---------- */

function ScriptMode({
  engine,
  browserVoices,
  google,
}: {
  engine: Engine
  browserVoices: SpeechSynthesisVoice[]
  google: GoogleCtx
}) {
  const [characters, setCharacters] = useLocalStorage<Character[]>('tts-characters', DEFAULT_CHARACTERS)
  const [script, setScript] = useLocalStorage('tts-script', SAMPLE_SCRIPT)
  const [gapMs, setGapMs] = useLocalStorage('tts-gap', 400)
  const player = useSpeechPlayer()
  const preview = usePreviewAudio()
  const [result, setResult] = useRenderResult()
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState('')
  const [audioLine, setAudioLine] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const lines = useMemo(() => parseScript(script, characters), [script, characters])
  const unknownNames = Array.from(new Set(lines.map((l) => l.unknownName).filter(Boolean))) as string[]
  const signature = JSON.stringify([
    gapMs,
    lines.map((l) => [l.text, l.pauseMs, l.character?.googleVoice ?? '', l.character?.rate, l.character?.pitch, l.character?.volume]),
  ])
  const isGoogle = engine === 'google'
  const busy = progress !== null
  const activeLine = isGoogle ? audioLine : player.activeTag

  function updateCharacter(id: string, patch: Partial<Character>) {
    setCharacters((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  function addCharacter(name = `ตัวละคร ${characters.length + 1}`) {
    setCharacters((prev) => [
      ...prev,
      { id: newId(), name, color: COLORS[prev.length % COLORS.length], voiceURI: '', ...preset('normal') },
    ])
  }

  function removeCharacter(id: string) {
    if (characters.length <= 1) return
    setCharacters((prev) => prev.filter((c) => c.id !== id))
  }

  /* --- เบราว์เซอร์ --- */
  function segmentsFor(line: ScriptLine): Segment[] {
    if (line.pauseMs !== undefined) {
      return [{ text: '', voice: null, lang: '', rate: 1, pitch: 1, volume: 1, tag: line.index, pauseMs: line.pauseMs }]
    }
    return line.character ? buildSegments(line.text, line.character, browserVoices, line.index) : []
  }

  /* --- Google --- */
  async function renderLine(line: ScriptLine) {
    if (line.pauseMs !== undefined) return silence(line.pauseMs)
    return renderText(google.apiKey, line.text, line.character!, google.voices)
  }

  async function renderAll() {
    setError('')
    setProgress({ done: 0, total: lines.length })
    try {
      // สร้างพร้อมกันครั้งละ 3 บรรทัด
      const pcms: Int16Array[] = new Array(lines.length)
      let next = 0
      let done = 0
      const worker = async () => {
        while (next < lines.length) {
          const i = next++
          pcms[i] = await renderLine(lines[i])
          setProgress({ done: ++done, total: lines.length })
        }
      }
      await Promise.all([worker(), worker(), worker()])

      const parts: Int16Array[] = []
      const offsets: number[] = []
      let samples = 0
      pcms.forEach((pcm, i) => {
        if (i > 0 && lines[i].pauseMs === undefined && lines[i - 1].pauseMs === undefined) {
          const gap = silence(gapMs)
          parts.push(gap)
          samples += gap.length
        }
        offsets.push(samples / SAMPLE_RATE)
        parts.push(pcm)
        samples += pcm.length
      })
      setResult(concatPcm(parts), offsets, signature)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setProgress(null)
    }
  }

  async function downloadLine(line: ScriptLine) {
    setError('')
    try {
      const pcm = await renderLine(line)
      const n = String(line.index + 1).padStart(2, '0')
      downloadBlob(encodeWav(pcm), `line-${n}${line.character && asciiName(line.character.name) ? `-${asciiName(line.character.name)}` : ''}.wav`)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  function onAudioTime(t: number) {
    if (t < 0 || !result) return setAudioLine(null)
    let idx = 0
    result.offsets.forEach((o, i) => {
      if (t >= o) idx = i
    })
    setAudioLine(idx)
  }

  async function clickLine(line: ScriptLine) {
    if (!isGoogle) {
      player.play(lines.slice(line.index).flatMap(segmentsFor), gapMs)
      return
    }
    // ถ้ามีไฟล์รวมที่ตรงกับบทปัจจุบัน → กระโดดไปตำแหน่งนั้น, ไม่งั้นเล่นเฉพาะบรรทัดนี้
    if (result && result.signature === signature && audioRef.current) {
      audioRef.current.currentTime = result.offsets[line.index] ?? 0
      void audioRef.current.play()
      return
    }
    setError('')
    try {
      preview.play(await renderLine(line))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function testCharacter(c: Character) {
    const sample = /[฀-๿]/.test(c.name) ? `สวัสดี ฉันชื่อ${c.name}` : `Hello, my name is ${c.name}.`
    if (!isGoogle) {
      player.play(buildSegments(sample, c, browserVoices, -1))
      return
    }
    setError('')
    try {
      preview.play(await renderText(google.apiKey, sample, c, google.voices))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-700">ตัวละคร ({characters.length})</h3>
          <button className={`${btn} bg-indigo-50 text-indigo-700 hover:bg-indigo-100`} onClick={() => addCharacter()}>
            + เพิ่มตัวละคร
          </button>
        </div>
        {characters.map((c, i) => (
          <div key={c.id} className={`${card} space-y-3 border-l-4 !p-4`} style={{ borderLeftColor: c.color }}>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={c.color}
                onChange={(e) => updateCharacter(c.id, { color: e.target.value })}
                className="h-8 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                aria-label="สีตัวละคร"
              />
              <input
                value={c.name}
                onChange={(e) => updateCharacter(c.id, { name: e.target.value })}
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium focus:border-indigo-400 focus:outline-none"
                aria-label="ชื่อตัวละคร"
              />
              <button
                className="shrink-0 rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-200 disabled:opacity-40"
                onClick={() => testCharacter(c)}
                disabled={isGoogle && !google.ready}
              >
                🔊 ทดสอบ
              </button>
              <button
                className="shrink-0 rounded-lg px-2 py-1.5 text-sm text-red-500 hover:bg-red-50 disabled:opacity-30"
                onClick={() => removeCharacter(c.id)}
                disabled={characters.length <= 1}
                aria-label="ลบตัวละคร"
              >
                ✕
              </button>
            </div>
            {i === 0 && <p className="text-xs text-slate-400">ตัวละครแรกจะเป็นเสียงหลัก ใช้กับบรรทัดที่ไม่ระบุชื่อ</p>}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {isGoogle ? (
                <GoogleVoiceSelect
                  value={c.googleVoice ?? ''}
                  onChange={(googleVoice) => updateCharacter(c.id, { googleVoice })}
                  google={google}
                />
              ) : (
                <BrowserVoiceSelect
                  value={c.voiceURI}
                  onChange={(voiceURI) => updateCharacter(c.id, { voiceURI })}
                  voices={browserVoices}
                />
              )}
              <StylePicker compact settings={c} onChange={(s) => updateCharacter(c.id, s)} />
            </div>
            <details className="text-sm">
              <summary className="cursor-pointer text-xs text-slate-500">ปรับละเอียด</summary>
              <div className="pt-2">
                <Sliders settings={c} onChange={(s) => updateCharacter(c.id, s)} />
              </div>
            </details>
          </div>
        ))}
      </div>

      <div className="space-y-4">
        <div className={`${card} space-y-3`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-slate-700">บทพากย์</h3>
            <div className="flex gap-2">
              <button className="text-xs text-indigo-600 hover:underline" onClick={() => setScript(SAMPLE_SCRIPT)}>
                ใส่บทตัวอย่าง
              </button>
              <button className="text-xs text-slate-500 hover:underline" onClick={() => setScript('')}>
                ล้างบท
              </button>
            </div>
          </div>
          <textarea
            className="h-56 w-full resize-y rounded-lg border border-slate-300 p-3 font-mono text-sm leading-relaxed focus:border-indigo-400 focus:outline-none"
            value={script}
            onChange={(e) => setScript(e.target.value)}
            placeholder={'ชื่อตัวละคร: ข้อความที่จะพูด\n[หยุด 2]'}
          />
          <p className="text-xs leading-relaxed text-slate-500">
            รูปแบบ: <code className="rounded bg-slate-100 px-1">ชื่อตัวละคร: ข้อความ</code> หนึ่งบรรทัดต่อหนึ่งประโยค ·
            ใส่ช่วงเงียบด้วย <code className="rounded bg-slate-100 px-1">[หยุด 2]</code> (วินาที)
          </p>
          {unknownNames.length > 0 && (
            <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
              ไม่พบตัวละคร: {unknownNames.map((n) => `"${n}"`).join(', ')} — จะใช้เสียงของ "{characters[0]?.name}" แทน
              <div className="mt-2 flex flex-wrap gap-1">
                {unknownNames.map((n) => (
                  <button
                    key={n}
                    className="rounded bg-amber-100 px-2 py-1 font-medium hover:bg-amber-200"
                    onClick={() => addCharacter(n)}
                  >
                    + เพิ่ม "{n}"
                  </button>
                ))}
              </div>
            </div>
          )}
          <label className="block text-xs text-slate-500">
            <span className="flex justify-between">
              <span>เว้นจังหวะระหว่างบรรทัด</span>
              <span className="font-medium text-slate-700">{(gapMs / 1000).toFixed(1)} วินาที</span>
            </span>
            <input
              type="range"
              className="w-full accent-indigo-600"
              min={0}
              max={3000}
              step={100}
              value={gapMs}
              onChange={(e) => setGapMs(Number(e.target.value))}
            />
          </label>

          {isGoogle ? (
            <div className="space-y-3">
              <button
                className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700`}
                onClick={renderAll}
                disabled={lines.length === 0 || !google.ready || busy}
              >
                {progress ? `⏳ กำลังสร้างเสียง ${progress.done}/${progress.total} บรรทัด...` : '🎬 สร้างไฟล์เสียงทั้งบท'}
              </button>
              {!google.ready && <p className="text-xs text-slate-500">ใส่ API key ด้านบนก่อนจึงจะสร้างเสียงได้</p>}
              <ErrorBox message={error} />
              {result && (
                <AudioResultPanel
                  result={result}
                  filename={`script-${timestamp()}.wav`}
                  stale={result.signature !== signature}
                  audioRef={audioRef}
                  onTimeUpdate={onAudioTime}
                />
              )}
            </div>
          ) : (
            <PlayerControls
              status={player.status}
              onPlay={() => player.play(lines.flatMap(segmentsFor), gapMs)}
              onPause={player.pause}
              onResume={player.resume}
              onStop={player.stop}
              playLabel="▶ เล่นทั้งบท"
              disabled={lines.length === 0}
            />
          )}
        </div>

        {lines.length > 0 && (
          <div className={`${card} !p-3`}>
            <p className="mb-2 px-2 text-xs text-slate-400">
              คลิกที่บรรทัดเพื่อฟังจากตรงนั้น{isGoogle && ' · กด ⬇ เพื่อดาวน์โหลดเสียงแยกทีละบรรทัด'}
            </p>
            <ol className="space-y-1">
              {lines.map((l) => {
                const active = activeLine === l.index
                return (
                  <li key={l.index} className="flex items-start gap-1">
                    <button
                      onClick={() => clickLine(l)}
                      disabled={isGoogle && !google.ready}
                      className={`flex min-w-0 flex-1 items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                        active ? 'bg-yellow-100 ring-1 ring-yellow-300' : 'hover:bg-slate-50'
                      }`}
                    >
                      {l.pauseMs !== undefined ? (
                        <span className="italic text-slate-400">⏱ {l.text}</span>
                      ) : (
                        <>
                          <span
                            className="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium text-white"
                            style={{ backgroundColor: l.character?.color }}
                          >
                            {l.character?.name}
                            {l.unknownName && ' ?'}
                          </span>
                          <span className={active ? 'text-slate-900' : 'text-slate-600'}>{l.text}</span>
                        </>
                      )}
                    </button>
                    {isGoogle && l.pauseMs === undefined && (
                      <button
                        className="shrink-0 rounded-lg px-2 py-1.5 text-sm text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                        onClick={() => downloadLine(l)}
                        disabled={!google.ready}
                        title="ดาวน์โหลดเสียงบรรทัดนี้"
                        aria-label={`ดาวน์โหลดเสียงบรรทัดที่ ${l.index + 1}`}
                      >
                        ⬇
                      </button>
                    )}
                  </li>
                )
              })}
            </ol>
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------- หน้าหลัก ---------- */

export function VoiceOver() {
  const browserVoices = useVoices()
  const [mode, setMode] = useLocalStorage<'single' | 'script'>('tts-mode', 'single')
  const [engine, setEngine] = useLocalStorage<Engine>('tts-engine', 'browser')
  const [apiKey, setApiKey] = useLocalStorage('tts-google-key', import.meta.env.VITE_GOOGLE_TTS_KEY ?? '')
  const [showAll, setShowAll] = useLocalStorage('tts-google-all-langs', false)
  const g = useGoogleVoices(apiKey, engine === 'google')
  const google: GoogleCtx = { apiKey, voices: g.voices, showAll, ready: g.status === 'ok' }
  const hasThai = browserVoices.some((v) => v.lang.toLowerCase().startsWith('th'))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">พากย์เสียง (Text-to-Speech)</h2>
          <p className="text-sm text-slate-500">แปลงข้อความเป็นเสียง เลือกรูปแบบเสียงและตัวละครได้หลากหลาย</p>
        </div>
        <div className="flex rounded-lg bg-slate-200 p-1 text-sm">
          {(
            [
              ['single', '📝 ข้อความเดียว'],
              ['script', '🎭 บทพากย์หลายตัวละคร'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setMode(key)}
              className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                mode === key ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {(
          [
            ['browser', '🔈 เสียงเบราว์เซอร์', 'ฟรี ไม่ต้องตั้งค่า · ฟังได้อย่างเดียว บันทึกไฟล์ไม่ได้'],
            ['google', '☁️ Google Cloud', 'เสียงสมจริง · ดาวน์โหลดไฟล์เสียงไปใส่วิดีโอได้ · ต้องใช้ API key'],
          ] as const
        ).map(([key, label, desc]) => (
          <button
            key={key}
            onClick={() => setEngine(key)}
            className={`rounded-xl border-2 px-4 py-3 text-left transition-colors ${
              engine === key ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white hover:bg-slate-50'
            }`}
          >
            <span className={`block text-sm font-semibold ${engine === key ? 'text-indigo-700' : 'text-slate-700'}`}>
              {label}
            </span>
            <span className="block text-xs text-slate-500">{desc}</span>
          </button>
        ))}
      </div>

      {engine === 'google' && (
        <GoogleSetup
          apiKey={apiKey}
          setApiKey={setApiKey}
          status={g.status}
          error={g.error}
          voices={g.voices}
          reload={g.reload}
          showAll={showAll}
          setShowAll={setShowAll}
        />
      )}

      {engine === 'browser' && !isSpeechSupported && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          เบราว์เซอร์นี้ไม่รองรับเสียงเบราว์เซอร์ (Web Speech API) — ใช้ Chrome/Edge หรือเปลี่ยนไปใช้ Google Cloud
        </div>
      )}
      {engine === 'browser' && isSpeechSupported && browserVoices.length > 0 && !hasThai && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          ไม่พบเสียงภาษาไทยในเบราว์เซอร์นี้ — แนะนำให้ใช้ <b>Microsoft Edge</b> (มีเสียงไทยคุณภาพสูง เช่น Premwadee, Niwat)
          หรือติดตั้งเสียงไทยใน Windows: Settings → Time &amp; Language → Speech → Add voices
        </div>
      )}

      {mode === 'single' ? (
        <SingleMode engine={engine} browserVoices={browserVoices} google={google} />
      ) : (
        <ScriptMode engine={engine} browserVoices={browserVoices} google={google} />
      )}

      <p className="text-xs text-slate-400">
        {engine === 'browser'
          ? 'หมายเหตุ: เสียงมาจากระบบของเบราว์เซอร์/เครื่อง จึงแตกต่างกันในแต่ละอุปกรณ์ · เสียงบางตัว (เช่นเสียง Online/Natural) อาจไม่รองรับการปรับระดับเสียงสูง-ต่ำ'
          : 'หมายเหตุ: เสียงบางตระกูล (เช่น Chirp3-HD) อาจไม่รองรับการปรับระดับเสียงสูง-ต่ำ โปรแกรมจะสร้างเสียงโดยไม่ปรับให้อัตโนมัติ · ไฟล์เสียงซ้ำจะไม่ถูกสร้างใหม่ เพื่อประหยัดโควตา'}
      </p>
    </div>
  )
}
