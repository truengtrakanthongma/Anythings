import { useEffect, useState } from 'react'
import { encodeWav } from './recorder'
import { splitText } from './speech'

/**
 * เสียง AI ของ Gemini (Google AI Studio) — ใช้ API key ฟรีจาก aistudio.google.com
 * ส่งข้อความ (พร้อมคำสั่งสไตล์การพูด) แล้วได้เสียง PCM กลับมาเป็นไฟล์โดยตรง
 */

const API = 'https://generativelanguage.googleapis.com/v1beta'
export const GEMINI_RATE = 24000

export class GeminiError extends Error {}
/** โควตารายวันหมด */
export class DailyQuotaError extends GeminiError {}

/* ---------- ตัวนับการใช้งาน (นับเฉพาะเครื่องนี้) ---------- */

const USAGE_KEY = 'tts-gemini-usage'
const USAGE_EVENT = 'tts-gemini-usage-changed'
/** Google รีเซ็ตโควตารายวันตอนเที่ยงคืนเวลาแปซิฟิก */
const QUOTA_TZ = 'America/Los_Angeles'

interface Usage {
  day: string
  counts: Record<string, number>
  exhausted: Record<string, boolean>
}

export function quotaDay(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: QUOTA_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    now,
  )
}

/** เวลาที่โควตารายวันจะรีเซ็ตครั้งถัดไป */
export function nextQuotaReset(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: QUOTA_TZ,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  const elapsed = get('hour') * 3600 + get('minute') * 60 + get('second')
  return new Date(now.getTime() + (86400 - elapsed) * 1000)
}

export function formatResetTime(now = new Date()) {
  return nextQuotaReset(now).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
}

function readUsage(): Usage {
  const empty = { day: quotaDay(), counts: {}, exhausted: {} }
  try {
    const u = JSON.parse(localStorage.getItem(USAGE_KEY) ?? 'null') as Partial<Usage> | null
    if (u && u.day === empty.day) return { ...empty, ...u }
  } catch {
    // อ่าน localStorage ไม่ได้ → เริ่มนับใหม่
  }
  return empty
}

function updateUsage(fn: (u: Usage) => void) {
  const u = readUsage()
  fn(u)
  try {
    localStorage.setItem(USAGE_KEY, JSON.stringify(u))
  } catch {
    // ไม่เป็นไร ตัวนับเป็นแค่ข้อมูลช่วยดู
  }
  window.dispatchEvent(new Event(USAGE_EVENT))
}

/** จำนวนครั้งที่ใช้เสียง AI วันนี้ (ของโมเดลที่เลือก, เฉพาะเครื่องนี้) */
export function useGeminiUsage(model: string) {
  const [usage, setUsage] = useState(readUsage)
  useEffect(() => {
    const update = () => setUsage(readUsage())
    window.addEventListener(USAGE_EVENT, update)
    window.addEventListener('storage', update) // อัปเดตเมื่อใช้งานจากแท็บอื่น
    const id = window.setInterval(update, 60_000) // เผื่อข้ามเวลารีเซ็ต
    return () => {
      window.removeEventListener(USAGE_EVENT, update)
      window.removeEventListener('storage', update)
      window.clearInterval(id)
    }
  }, [])
  return { count: usage.counts[model] ?? 0, exhausted: !!usage.exhausted[model], resetAt: formatResetTime() }
}

/** เสียงสำเร็จรูปของ Gemini (ชื่อ — ลักษณะเสียง) */
export const GEMINI_VOICES: { name: string; desc: string; gender: 'ญ' | 'ช' }[] = [
  { name: 'Kore', desc: 'หนักแน่น มั่นใจ', gender: 'ญ' },
  { name: 'Zephyr', desc: 'สดใส', gender: 'ญ' },
  { name: 'Leda', desc: 'อ่อนเยาว์', gender: 'ญ' },
  { name: 'Aoede', desc: 'สบาย ๆ โปร่ง', gender: 'ญ' },
  { name: 'Callirrhoe', desc: 'ผ่อนคลาย', gender: 'ญ' },
  { name: 'Autonoe', desc: 'สดใส', gender: 'ญ' },
  { name: 'Despina', desc: 'นุ่มนวล', gender: 'ญ' },
  { name: 'Erinome', desc: 'ชัดเจน', gender: 'ญ' },
  { name: 'Laomedeia', desc: 'ร่าเริง', gender: 'ญ' },
  { name: 'Achernar', desc: 'นุ่ม เบา', gender: 'ญ' },
  { name: 'Gacrux', desc: 'เป็นผู้ใหญ่', gender: 'ญ' },
  { name: 'Pulcherrima', desc: 'มั่นใจ ตรงไปตรงมา', gender: 'ญ' },
  { name: 'Vindemiatrix', desc: 'อ่อนโยน', gender: 'ญ' },
  { name: 'Sulafat', desc: 'อบอุ่น', gender: 'ญ' },
  { name: 'Puck', desc: 'ร่าเริง', gender: 'ช' },
  { name: 'Charon', desc: 'ให้ข้อมูล น่าเชื่อถือ', gender: 'ช' },
  { name: 'Fenrir', desc: 'ตื่นเต้น', gender: 'ช' },
  { name: 'Orus', desc: 'หนักแน่น', gender: 'ช' },
  { name: 'Enceladus', desc: 'มีลมหายใจ นุ่ม', gender: 'ช' },
  { name: 'Iapetus', desc: 'ชัดเจน', gender: 'ช' },
  { name: 'Umbriel', desc: 'สบาย ๆ', gender: 'ช' },
  { name: 'Algieba', desc: 'ลื่นไหล', gender: 'ช' },
  { name: 'Algenib', desc: 'แหบ ทุ้ม', gender: 'ช' },
  { name: 'Rasalgethi', desc: 'ให้ข้อมูล', gender: 'ช' },
  { name: 'Alnilam', desc: 'หนักแน่น', gender: 'ช' },
  { name: 'Schedar', desc: 'สม่ำเสมอ', gender: 'ช' },
  { name: 'Achird', desc: 'เป็นมิตร', gender: 'ช' },
  { name: 'Zubenelgenubi', desc: 'เป็นกันเอง', gender: 'ช' },
  { name: 'Sadachbia', desc: 'มีชีวิตชีวา', gender: 'ช' },
  { name: 'Sadaltager', desc: 'รอบรู้', gender: 'ช' },
]

/** คำสั่งสไตล์การพูดของแต่ละรูปแบบเสียง (ภาษาอังกฤษ — โมเดลเข้าใจแม่นกว่า) */
export const GEMINI_STYLE: Record<string, string> = {
  normal: '',
  narrator: 'Read aloud as a calm, warm documentary narrator, at a slightly slow pace',
  news: 'Read aloud as a clear, confident TV news anchor',
  child: 'Read aloud in the voice of a cheerful young child',
  elderly: 'Read aloud in the slow, gentle voice of an elderly person',
  giant: 'Read aloud as a deep, menacing giant villain',
  cartoon: 'Read aloud as a squeaky, hyperactive cartoon character',
  robot: 'Read aloud as a flat, monotone robot',
  excited: 'Read aloud with great excitement and energy',
  soft: 'Whisper softly and sadly',
  listening: 'Read aloud very slowly and clearly, pausing between phrases, for language learners',
  fast: 'Read aloud quickly',
}

export interface GeminiSettings {
  geminiVoice?: string
  /** id ของรูปแบบเสียงสำเร็จรูป (จาก STYLE_PRESETS) */
  styleId?: string
  /** คำอธิบายสไตล์เพิ่มเติมที่ผู้ใช้พิมพ์เอง เช่น "พูดเหมือนครูใจดี" */
  styleNote?: string
}

export interface GeminiModel {
  id: string
  label: string
}

function buildPrompt(text: string, s: GeminiSettings) {
  const parts = [GEMINI_STYLE[s.styleId ?? ''] ?? '', s.styleNote?.trim() ? `Style: ${s.styleNote.trim()}` : ''].filter(
    Boolean,
  )
  return parts.length ? `${parts.join('. ')}:\n${text}` : text
}

interface ApiErrorBody {
  error?: {
    code?: number
    message?: string
    status?: string
    details?: { '@type'?: string; reason?: string; retryDelay?: string; violations?: { quotaId?: string }[] }[]
  }
}

class RetryableError extends GeminiError {
  retryAfterSec: number
  constructor(message: string, retryAfterSec: number) {
    super(message)
    this.retryAfterSec = retryAfterSec
  }
}

function explain(status: number, body: ApiErrorBody | null): GeminiError {
  const err = body?.error
  const msg = err?.message ?? ''
  const reason = err?.details?.find((d) => d.reason)?.reason ?? ''
  if (reason === 'API_KEY_INVALID' || /api key not valid/i.test(msg))
    return new GeminiError('API key ไม่ถูกต้อง — คัดลอกใหม่จาก aistudio.google.com/apikey')
  if (status === 429) {
    const perDay = err?.details?.some((d) => d.violations?.some((v) => /day/i.test(v.quotaId ?? '')))
    if (perDay)
      return new DailyQuotaError(
        `โควตาฟรีของวันนี้หมดแล้ว — ใช้ได้อีกครั้งเวลา ${formatResetTime()} น. ระหว่างนี้สลับไปใช้ "เสียงเบราว์เซอร์" (ฟรีไม่จำกัด) ได้`,
      )
    const delay = err?.details?.find((d) => d.retryDelay)?.retryDelay
    const sec = delay ? Math.ceil(parseFloat(delay)) : 30
    return new RetryableError(`ส่งคำขอถี่เกินโควตาฟรี ต้องรอ ${sec} วินาที`, sec)
  }
  if (status === 403) return new GeminiError(`ไม่มีสิทธิ์ใช้งาน: ${msg}`)
  if (status >= 500) return new RetryableError('เซิร์ฟเวอร์ของ Google ขัดข้องชั่วคราว', 5)
  return new GeminiError(`Gemini ตอบกลับข้อผิดพลาด (${status}): ${msg || 'ไม่ทราบสาเหตุ'}`)
}

async function call(path: string, key: string, init?: RequestInit) {
  let res: Response
  try {
    res = await fetch(`${API}/${path}`, { ...init, headers: { ...init?.headers, 'x-goog-api-key': key } })
  } catch {
    throw new GeminiError('เชื่อมต่อ Google ไม่ได้ — ตรวจสอบอินเทอร์เน็ต')
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) throw explain(res.status, body as ApiErrorBody | null)
  return body
}

/** ดึงรายชื่อโมเดลสร้างเสียง (ชื่อที่มีคำว่า tts) ที่ key นี้ใช้ได้ */
export async function fetchTtsModels(key: string): Promise<GeminiModel[]> {
  const body = (await call('models?pageSize=1000', key)) as {
    models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[]
  }
  const models = (body.models ?? [])
    .filter((m) => /tts/i.test(m.name) && (m.supportedGenerationMethods ?? ['generateContent']).includes('generateContent'))
    .map((m) => ({ id: m.name.replace(/^models\//, ''), label: m.displayName || m.name.replace(/^models\//, '') }))
  // แนะนำรุ่น flash ก่อน (โควตาฟรีมักสูงกว่ารุ่น pro)
  const score = (m: GeminiModel) => (/flash/i.test(m.id) ? 2 : 0) + (/pro/i.test(m.id) ? -1 : 0)
  return models.sort((a, b) => score(b) - score(a) || b.id.localeCompare(a.id))
}

function base64ToBytes(b64: string) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** แปลงเสียงที่ได้ (PCM 16-bit หรือ WAV) เป็น Float32 mono ที่ GEMINI_RATE */
export function decodeAudio(bytes: Uint8Array, mimeType: string): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let start = 0
  let length = bytes.length
  let rate = Number(mimeType.match(/rate=(\d+)/)?.[1] ?? GEMINI_RATE)
  let channels = 1
  if (/wav/i.test(mimeType) || String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF') {
    let o = 12
    while (o + 8 <= bytes.length) {
      const id = String.fromCharCode(...bytes.subarray(o, o + 4))
      const size = view.getUint32(o + 4, true)
      if (id === 'fmt ') {
        channels = view.getUint16(o + 10, true)
        rate = view.getUint32(o + 12, true)
      } else if (id === 'data') {
        start = o + 8
        length = Math.min(size, bytes.length - start)
        break
      }
      o += 8 + size + (size % 2)
    }
  }
  const frames = Math.floor(length / 2 / channels)
  const pcm = new Float32Array(frames)
  for (let i = 0; i < frames; i++) pcm[i] = view.getInt16(start + i * channels * 2, true) / 0x8000
  if (rate === GEMINI_RATE) return pcm
  const out = new Float32Array(Math.round((frames * GEMINI_RATE) / rate))
  for (let i = 0; i < out.length; i++) {
    const x = (i * rate) / GEMINI_RATE
    const i0 = Math.min(Math.floor(x), frames - 1)
    const i1 = Math.min(i0 + 1, frames - 1)
    out[i] = pcm[i0] + (pcm[i1] - pcm[i0]) * (x - i0)
  }
  return out
}

const cache = new Map<string, Promise<Float32Array>>()
const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms))

async function synthesizeChunk(
  key: string,
  model: string,
  text: string,
  s: GeminiSettings,
  onWait?: (sec: number) => void,
): Promise<Float32Array> {
  const request = async () => {
    const body = (await call(`models/${encodeURIComponent(model)}:generateContent`, key, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(text, s) }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: s.geminiVoice || 'Kore' } } },
        },
      }),
    })) as { candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[] }
    const parts = body.candidates?.[0]?.content?.parts ?? []
    const audio = parts.map((p) => p.inlineData).filter((d) => d?.data)
    if (audio.length === 0) throw new GeminiError('AI ไม่ได้ส่งเสียงกลับมา — ลองปรับข้อความหรือคำอธิบายสไตล์ใหม่')
    const pcms = audio.map((d) => decodeAudio(base64ToBytes(d!.data!), d!.mimeType ?? ''))
    updateUsage((u) => {
      u.counts[model] = (u.counts[model] ?? 0) + 1
      delete u.exhausted[model]
    })
    return concatFloat(pcms)
  }

  // ลองใหม่อัตโนมัติเมื่อติดโควตารายนาที (รอไม่เกิน 70 วินาที, สูงสุด 3 ครั้ง)
  for (let attempt = 0; ; attempt++) {
    try {
      return await request()
    } catch (e) {
      if (e instanceof DailyQuotaError)
        updateUsage((u) => {
          u.exhausted[model] = true
        })
      if (!(e instanceof RetryableError) || attempt >= 3 || e.retryAfterSec > 70) throw e
      onWait?.(e.retryAfterSec)
      await sleep(e.retryAfterSec * 1000 + 500)
      onWait?.(0)
    }
  }
}

const CHUNK_MAX = 2000

function chunkId(model: string, chunk: string, s: GeminiSettings) {
  return JSON.stringify([model, chunk, s.geminiVoice, s.styleId, s.styleNote?.trim()])
}

/** จำนวนคำขอที่ต้องส่งจริง (ไม่นับส่วนที่สร้างไว้แล้ว) — ใช้บอกว่าจะใช้โควตากี่ครั้ง */
export function pendingRequests(model: string, text: string, s: GeminiSettings) {
  return splitText(text, CHUNK_MAX).filter((chunk) => !cache.has(chunkId(model, chunk, s))).length
}

/** สร้างเสียงจากข้อความ (ข้อความซ้ำจะใช้ผลเดิม ไม่เปลืองโควตา) */
export async function geminiSpeak(
  key: string,
  model: string,
  text: string,
  s: GeminiSettings,
  onWait?: (sec: number) => void,
): Promise<Float32Array> {
  const parts: Float32Array[] = []
  for (const [i, chunk] of splitText(text, CHUNK_MAX).entries()) {
    if (i > 0) parts.push(new Float32Array(Math.round(GEMINI_RATE * 0.15)))
    const id = chunkId(model, chunk, s)
    let p = cache.get(id)
    if (!p) {
      p = synthesizeChunk(key, model, chunk, s, onWait)
      cache.set(id, p)
      p.catch(() => cache.delete(id))
    }
    parts.push(await p)
  }
  return concatFloat(parts)
}

export function concatFloat(parts: Float32Array[]) {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

export function silenceFloat(ms: number) {
  return new Float32Array(Math.round((GEMINI_RATE * ms) / 1000))
}

export function toWav(pcm: Float32Array) {
  return encodeWav(pcm, GEMINI_RATE)
}

/** ตรวจสอบ key และโหลดรายชื่อโมเดล */
export function useGeminiModels(key: string, enabled: boolean) {
  const [state, setState] = useState<{
    key: string
    status: 'idle' | 'loading' | 'ok' | 'error'
    models: GeminiModel[]
    error: string
  }>({ key: '', status: 'idle', models: [], error: '' })
  const [token, setToken] = useState(0)

  useEffect(() => {
    const k = key.trim()
    if (!enabled || k.length < 20) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      setState((s) => ({ ...s, key: k, status: 'loading', error: '' }))
      fetchTtsModels(k)
        .then((models) => {
          if (cancelled) return
          if (models.length === 0)
            setState({ key: k, status: 'error', models, error: 'key นี้ยังไม่มีโมเดลสร้างเสียง (TTS) ให้ใช้งาน' })
          else setState({ key: k, status: 'ok', models, error: '' })
        })
        .catch((e: Error) => !cancelled && setState({ key: k, status: 'error', models: [], error: e.message }))
    }, 400)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [key, enabled, token])

  const current = state.key === key.trim() && key.trim().length >= 20
  return {
    models: current ? state.models : [],
    status: current ? state.status : ('idle' as const),
    error: current ? state.error : '',
    reload: () => setToken((t) => t + 1),
  }
}
