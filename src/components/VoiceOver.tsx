import { useEffect, useMemo, useRef, useState } from 'react'
import { newId, useLocalStorage } from '../hooks/useLocalStorage'
import {
  buildRecording,
  downloadBlob,
  isRecordingSupported,
  startCapture,
  timestamp,
  type Capture,
  type Recording,
} from '../tts/recorder'
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

interface Character extends VoiceSettings {
  id: string
  name: string
  color: string
}

interface ScriptLine {
  index: number
  text: string
  pauseMs?: number
  character?: Character
  /** ชื่อตัวละครที่พิมพ์ไว้แต่ไม่พบในรายชื่อ */
  unknownName?: string
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

const DEFAULT_SINGLE: VoiceSettings & { text: string } = {
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

function formatTime(sec: number) {
  const s = Math.floor(sec)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/* ---------- การบันทึกเสียง ---------- */

type RecPhase = 'idle' | 'choosing' | 'recording' | 'processing'

function useRecordSession(player: ReturnType<typeof useSpeechPlayer>) {
  const [phase, setPhase] = useState<RecPhase>('idle')
  const [error, setError] = useState('')
  const [recording, setRecording] = useState<Recording | null>(null)
  const [seconds, setSeconds] = useState(0)
  const capRef = useRef<Capture | null>(null)
  const marksRef = useRef<{ tag: number; t: number }[]>([])
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    if (phase !== 'recording') return
    const id = window.setInterval(() => setSeconds(capRef.current?.elapsed() ?? 0), 250)
    return () => window.clearInterval(id)
  }, [phase])

  useEffect(
    () => () => {
      capRef.current?.cancel()
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    },
    [],
  )

  async function finish() {
    const cap = capRef.current
    if (!cap) return
    capRef.current = null
    player.stop()
    setPhase('processing')
    try {
      const rec = buildRecording(await cap.stop(), marksRef.current)
      if (!rec) {
        setError(
          'ไฟล์ไม่มีเสียง — ตอนเลือกหน้าจอให้เลือก "ทั้งหน้าจอ (Entire screen)" และติ๊ก "แชร์เสียงของระบบด้วย" และอย่าปิดเสียง (mute) ของเครื่อง',
        )
        return
      }
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      urlRef.current = rec.url
      setRecording(rec)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPhase('idle')
    }
  }

  async function start(segments: Segment[], gapMs: number) {
    if (segments.length === 0) return
    setError('')
    setSeconds(0)
    player.stop()
    setPhase('choosing')
    try {
      capRef.current = await startCapture(() => void finish())
    } catch (e) {
      setError((e as Error).message)
      setPhase('idle')
      return
    }
    marksRef.current = []
    setPhase('recording')
    // รอให้ตัวอัดพร้อมก่อนเริ่มพูด
    await new Promise((r) => window.setTimeout(r, 500))
    if (!capRef.current) return
    let lastTag: number | null = null
    player.play(segments, gapMs, {
      onSegment: (tag) => {
        if (tag === lastTag) return
        lastTag = tag
        marksRef.current.push({ tag, t: capRef.current?.elapsed() ?? 0 })
      },
      onEnd: () => window.setTimeout(() => void finish(), 800),
    })
  }

  return { phase, error, recording, seconds, start, finish, busy: phase !== 'idle' }
}

type RecordSession = ReturnType<typeof useRecordSession>

function RecordPanel({
  session,
  onRecord,
  disabled,
  filename,
}: {
  session: RecordSession
  onRecord: () => void
  disabled: boolean
  filename: string
}) {
  const { phase, error, recording, seconds } = session

  if (!isRecordingSupported) {
    return (
      <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
        การบันทึกเป็นไฟล์เสียงต้องใช้ Google Chrome หรือ Microsoft Edge บนคอมพิวเตอร์ Windows
      </p>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border border-rose-200 bg-rose-50/50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {phase === 'idle' && (
          <button className={`${btn} bg-rose-600 text-white hover:bg-rose-700`} onClick={onRecord} disabled={disabled}>
            ⏺ บันทึกเป็นไฟล์เสียง
          </button>
        )}
        {phase === 'choosing' && (
          <span className="text-sm text-slate-600">⏳ เลือกหน้าจอ แล้วติ๊ก "แชร์เสียงของระบบ" ในหน้าต่างที่เด้งขึ้นมา...</span>
        )}
        {phase === 'recording' && (
          <>
            <span className="flex items-center gap-2 text-sm font-medium text-rose-700">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-600" />
              กำลังบันทึก {formatTime(seconds)}
            </span>
            <button className={`${btn} bg-slate-800 text-white hover:bg-slate-900`} onClick={() => void session.finish()}>
              ■ หยุดและบันทึก
            </button>
          </>
        )}
        {phase === 'processing' && <span className="text-sm text-slate-600">⏳ กำลังสร้างไฟล์เสียง...</span>}
      </div>

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">⚠ {error}</div>}

      <details open={!recording} className="text-sm text-slate-600">
        <summary className="cursor-pointer font-medium text-slate-700">วิธีบันทึก (อ่านก่อนใช้ครั้งแรก)</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            กด <b>⏺ บันทึกเป็นไฟล์เสียง</b> จะมีหน้าต่างถามว่าจะแชร์อะไร
          </li>
          <li>
            เลือกแท็บ <b>ทั้งหน้าจอ (Entire screen)</b> แล้วคลิกเลือกหน้าจอ
          </li>
          <li>
            ติ๊ก ✅ <b>แชร์เสียงของระบบด้วย (Also share system audio)</b> แล้วกด <b>แชร์ (Share)</b>
          </li>
          <li>โปรแกรมจะอ่านบทและบันทึกให้เอง เมื่ออ่านจบจะได้ไฟล์ .wav ให้ดาวน์โหลด</li>
        </ol>
        <p className="mt-2 text-xs text-slate-500">
          💡 ระหว่างบันทึก ปิดเพลง/วิดีโออื่นและเสียงแจ้งเตือน เพราะเสียงทั้งหมดในเครื่องจะถูกบันทึกด้วย · อย่ากดปิดเสียง (mute)
          ของเครื่อง · ไม่ต้องห่วงเรื่องภาพ โปรแกรมเก็บเฉพาะเสียง
        </p>
      </details>

      {recording && (
        <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-medium text-emerald-800">
              ✅ บันทึกสำเร็จ · ยาว {recording.seconds.toFixed(1)} วินาที · {(recording.blob.size / 1024 / 1024).toFixed(1)} MB
            </span>
            <button
              className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}
              onClick={() => downloadBlob(recording.blob, filename)}
            >
              ⬇ ดาวน์โหลด (.wav)
            </button>
          </div>
          <audio key={recording.url} src={recording.url} controls className="w-full" />
          <p className="text-xs text-emerald-700">
            ไฟล์ .wav ใช้ได้กับ CapCut, Canva, Clipchamp, PowerPoint และโปรแกรมตัดต่อวิดีโอทั่วไป
          </p>
        </div>
      )}
    </div>
  )
}

/* ---------- ส่วนประกอบย่อย ---------- */

function VoiceSelect({
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
  playLabel = '▶ ฟังเสียง',
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
      <button
        className={`${btn} bg-slate-100 text-slate-700 hover:bg-slate-200`}
        onClick={onStop}
        disabled={disabled || status === 'idle'}
      >
        ■ หยุด
      </button>
    </div>
  )
}

/* ---------- โหมดข้อความเดียว ---------- */

function SingleMode({ voices }: { voices: SpeechSynthesisVoice[] }) {
  const [state, setState] = useLocalStorage('tts-single', DEFAULT_SINGLE)
  const player = useSpeechPlayer()
  const session = useRecordSession(player)
  const [segments, setSegments] = useState<Segment[]>([])
  const update = (s: Partial<typeof state>) => setState((prev) => ({ ...prev, ...s }))

  function makeSegments() {
    const segs = buildSegments(state.text, state, voices, 0).map((s, i) => ({ ...s, tag: i }))
    setSegments(segs)
    return segs
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
            disabled={session.busy}
          />
        </div>

        <PlayerControls
          status={player.status}
          onPlay={() => player.play(makeSegments())}
          onPause={player.pause}
          onResume={player.resume}
          onStop={player.stop}
          disabled={!state.text.trim() || session.busy}
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

        <RecordPanel
          session={session}
          onRecord={() => void session.start(makeSegments(), 0)}
          disabled={!state.text.trim()}
          filename={`voiceover-${timestamp()}.wav`}
        />

        <div>
          <h3 className="mb-2 font-semibold text-slate-700">รูปแบบเสียง</h3>
          <StylePicker settings={state} onChange={update} />
        </div>
      </div>

      <div className={`${card} space-y-4 self-start`}>
        <div>
          <h3 className="mb-2 font-semibold text-slate-700">เสียงผู้พากย์</h3>
          <VoiceSelect value={state.voiceURI} onChange={(voiceURI) => update({ voiceURI })} voices={voices} />
          <p className="mt-1 text-xs text-slate-400">มีเสียงให้เลือก {voices.length} เสียงในเบราว์เซอร์นี้</p>
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

function ScriptMode({ voices }: { voices: SpeechSynthesisVoice[] }) {
  const [characters, setCharacters] = useLocalStorage<Character[]>('tts-characters', DEFAULT_CHARACTERS)
  const [script, setScript] = useLocalStorage('tts-script', SAMPLE_SCRIPT)
  const [gapMs, setGapMs] = useLocalStorage('tts-gap', 400)
  const player = useSpeechPlayer()
  const session = useRecordSession(player)

  const lines = useMemo(() => parseScript(script, characters), [script, characters])
  const unknownNames = Array.from(new Set(lines.map((l) => l.unknownName).filter(Boolean))) as string[]
  const clips = session.recording?.clips

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

  function segmentsFor(line: ScriptLine): Segment[] {
    if (line.pauseMs !== undefined) {
      return [{ text: '', voice: null, lang: '', rate: 1, pitch: 1, volume: 1, tag: line.index, pauseMs: line.pauseMs }]
    }
    return line.character ? buildSegments(line.text, line.character, voices, line.index) : []
  }

  function testCharacter(c: Character) {
    const sample = /[฀-๿]/.test(c.name) ? `สวัสดี ฉันชื่อ${c.name}` : `Hello, my name is ${c.name}.`
    player.play(buildSegments(sample, c, voices, -1))
  }

  function downloadLine(line: ScriptLine) {
    const blob = clips?.get(line.index)
    if (!blob) return
    const n = String(line.index + 1).padStart(2, '0')
    const who = line.character ? asciiName(line.character.name) : ''
    downloadBlob(blob, `line-${n}${who ? `-${who}` : ''}.wav`)
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
                disabled={session.busy}
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
              <VoiceSelect value={c.voiceURI} onChange={(voiceURI) => updateCharacter(c.id, { voiceURI })} voices={voices} />
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
            disabled={session.busy}
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
              disabled={session.busy}
            />
          </label>
          <PlayerControls
            status={player.status}
            onPlay={() => player.play(lines.flatMap(segmentsFor), gapMs)}
            onPause={player.pause}
            onResume={player.resume}
            onStop={player.stop}
            playLabel="▶ ฟังทั้งบท"
            disabled={lines.length === 0 || session.busy}
          />
          <RecordPanel
            session={session}
            onRecord={() => void session.start(lines.flatMap(segmentsFor), gapMs)}
            disabled={lines.length === 0}
            filename={`script-${timestamp()}.wav`}
          />
        </div>

        {lines.length > 0 && (
          <div className={`${card} !p-3`}>
            <p className="mb-2 px-2 text-xs text-slate-400">
              คลิกที่บรรทัดเพื่อฟังจากตรงนั้น{clips && ' · กด ⬇ เพื่อดาวน์โหลดเสียงแยกทีละบรรทัด'}
            </p>
            <ol className="space-y-1">
              {lines.map((l) => {
                const active = player.activeTag === l.index
                const clip = clips?.has(l.index)
                return (
                  <li key={l.index} className="flex items-start gap-1">
                    <button
                      onClick={() => player.play(lines.slice(l.index).flatMap(segmentsFor), gapMs)}
                      disabled={session.busy}
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
                    {clip && (
                      <button
                        className="shrink-0 rounded-lg px-2 py-1.5 text-sm text-slate-500 hover:bg-slate-100"
                        onClick={() => downloadLine(l)}
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
  const voices = useVoices()
  const [mode, setMode] = useLocalStorage<'single' | 'script'>('tts-mode', 'single')
  const hasThai = voices.some((v) => v.lang.toLowerCase().startsWith('th'))

  if (!isSpeechSupported) {
    return (
      <div className={`${card} text-sm text-slate-600`}>
        เบราว์เซอร์นี้ไม่รองรับการแปลงข้อความเป็นเสียง (Web Speech API) กรุณาใช้ Microsoft Edge หรือ Google Chrome เวอร์ชันล่าสุด
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">พากย์เสียง (Text-to-Speech)</h2>
          <p className="text-sm text-slate-500">
            แปลงข้อความเป็นเสียง เลือกรูปแบบเสียงได้หลากหลาย และบันทึกเป็นไฟล์ไปใส่วิดีโอได้ — ฟรีทั้งหมด
          </p>
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

      {voices.length > 0 && !hasThai && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          ไม่พบเสียงภาษาไทยในเบราว์เซอร์นี้ — แนะนำให้ใช้ <b>Microsoft Edge</b> (มีเสียงไทยคุณภาพสูงฟรี เช่น Premwadee, Niwat)
          หรือติดตั้งเสียงไทยใน Windows: Settings → Time &amp; Language → Speech → Add voices
        </div>
      )}
      {voices.length === 0 && (
        <div className="rounded-lg bg-slate-100 p-3 text-sm text-slate-600">กำลังโหลดรายชื่อเสียง...</div>
      )}

      {mode === 'single' ? <SingleMode voices={voices} /> : <ScriptMode voices={voices} />}

      <p className="text-xs text-slate-400">
        หมายเหตุ: เสียงมาจากระบบของเบราว์เซอร์/เครื่อง จึงแตกต่างกันในแต่ละอุปกรณ์ · แนะนำ Microsoft Edge
        เพราะมีเสียงไทยแบบ Natural ที่สมจริง · เสียงบางตัวอาจไม่รองรับการปรับระดับเสียงสูง-ต่ำ
      </p>
    </div>
  )
}
