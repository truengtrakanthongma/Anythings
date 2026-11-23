import { useEffect, useState } from 'react'
import { splitByLanguage, splitText } from './speech'

/** ตัวเชื่อมต่อ Google Cloud Text-to-Speech (REST v1) + เครื่องมือรวมไฟล์ WAV */

const API = 'https://texttospeech.googleapis.com/v1'
export const SAMPLE_RATE = 24000

export interface GoogleVoice {
  name: string
  languageCodes: string[]
  ssmlGender: 'MALE' | 'FEMALE' | 'NEUTRAL' | 'SSML_VOICE_GENDER_UNSPECIFIED'
  naturalSampleRateHertz: number
}

export interface GoogleVoiceSettings {
  /** ชื่อเสียงของ Google เช่น th-TH-Neural2-C, '' = อัตโนมัติตามภาษา */
  googleVoice?: string
  rate: number
  pitch: number
  volume: number
}

export class GoogleTtsError extends Error {}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** แปลงค่าจากแถบปรับ (แบบ Web Speech) เป็นค่าของ Google */
export function toGoogleAudioConfig(s: { rate: number; pitch: number; volume: number }) {
  return {
    speakingRate: clamp(s.rate, 0.25, 2),
    // pitch 1 = ปกติ, แต่ละ 0.1 ≈ 1.2 semitone
    pitch: Math.round(clamp((s.pitch - 1) * 12, -20, 20) * 10) / 10,
    volumeGainDb: s.volume <= 0 ? -96 : Math.round(clamp(20 * Math.log10(s.volume), -96, 16) * 10) / 10,
  }
}

function explainError(status: number, body: unknown): string {
  const err = (body as { error?: { message?: string; status?: string; details?: { reason?: string }[] } })?.error
  const reason = err?.details?.find((d) => d.reason)?.reason ?? ''
  const msg = err?.message ?? ''
  if (reason === 'API_KEY_INVALID' || /api key not valid/i.test(msg)) return 'API key ไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง'
  if (reason === 'SERVICE_DISABLED' || /has not been used|is disabled/i.test(msg))
    return 'ยังไม่ได้เปิดใช้ "Cloud Text-to-Speech API" ในโปรเจกต์ Google Cloud (ดูขั้นตอนที่ 3)'
  if (reason === 'BILLING_DISABLED' || /billing/i.test(msg))
    return 'โปรเจกต์ยังไม่ได้ผูกบัญชีชำระเงิน (Billing) — Google ต้องการแม้จะใช้ในโควตาฟรี'
  if (reason === 'API_KEY_HTTP_REFERRER_BLOCKED' || /referer|referrer/i.test(msg))
    return 'API key นี้ถูกจำกัดเว็บไซต์ไว้ และไม่อนุญาตเว็บนี้ — เพิ่มที่อยู่เว็บนี้ในการตั้งค่า key'
  if (reason === 'API_KEY_SERVICE_BLOCKED') return 'API key นี้ไม่ได้รับอนุญาตให้ใช้ Text-to-Speech API'
  if (status === 429) return 'ใช้งานเกินโควตาชั่วคราว กรุณารอสักครู่แล้วลองใหม่'
  return `Google ตอบกลับข้อผิดพลาด (${status}): ${msg || 'ไม่ทราบสาเหตุ'}`
}

async function call(path: string, key: string, init?: RequestInit) {
  let res: Response
  try {
    res = await fetch(`${API}/${path}${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}`, init)
  } catch {
    throw new GoogleTtsError('เชื่อมต่อ Google ไม่ได้ — ตรวจสอบอินเทอร์เน็ต')
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new GoogleTtsError(explainError(res.status, body))
  return body
}

export async function fetchGoogleVoices(key: string): Promise<GoogleVoice[]> {
  const body = (await call('voices', key)) as { voices?: GoogleVoice[] }
  // เก็บเฉพาะเสียงมาตรฐานที่ชื่อขึ้นต้นด้วยรหัสภาษา (เช่น th-TH-...) — เสียงพิเศษอื่นต้องใช้การตั้งค่าเพิ่ม
  return (body.voices ?? []).filter((v) => v.languageCodes?.some((l) => v.name.startsWith(`${l}-`)))
}

export function voiceLang(v: GoogleVoice) {
  return v.languageCodes.find((l) => v.name.startsWith(`${l}-`)) ?? v.languageCodes[0]
}

export function voiceTier(name: string) {
  const m = name.match(/-(Standard|Wavenet|Neural2|Chirp3-HD|Chirp-HD|Studio|Polyglot|News)-/i)
  return m ? m[1] : 'Other'
}

/** เลือกเสียงอัตโนมัติ: Neural2 > WaveNet > Chirp3-HD > Standard */
export function pickGoogleVoice(voices: GoogleVoice[], lang: 'th' | 'en'): GoogleVoice | null {
  const rank: Record<string, number> = { Neural2: 5, Wavenet: 4, 'Chirp3-HD': 3, Standard: 2 }
  const candidates = voices.filter((v) => voiceLang(v).toLowerCase().startsWith(lang))
  const score = (v: GoogleVoice) =>
    (rank[voiceTier(v.name)] ?? 1) * 10 + (lang === 'en' && voiceLang(v) === 'en-US' ? 5 : 0)
  return [...candidates].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name))[0] ?? null
}

export function groupGoogleVoices(voices: GoogleVoice[], showAll: boolean) {
  const th = voices.filter((v) => voiceLang(v).startsWith('th'))
  const en = voices.filter((v) => voiceLang(v).startsWith('en'))
  const other = showAll ? voices.filter((v) => !/^(th|en)/.test(voiceLang(v))) : []
  const sort = (list: GoogleVoice[]) => [...list].sort((a, b) => a.name.localeCompare(b.name))
  return [
    { label: 'ภาษาไทย', voices: sort(th) },
    { label: 'English', voices: sort(en) },
    { label: 'ภาษาอื่น ๆ', voices: sort(other) },
  ].filter((g) => g.voices.length > 0)
}

export const GENDER_TH: Record<string, string> = { MALE: 'ชาย', FEMALE: 'หญิง', NEUTRAL: 'กลาง' }

/* ---------- WAV ---------- */

function base64ToBytes(b64: string) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function resample(pcm: Int16Array, from: number, to: number) {
  if (from === to) return pcm
  const out = new Int16Array(Math.round((pcm.length * to) / from))
  const ratio = from / to
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio
    const i0 = Math.floor(x)
    const i1 = Math.min(i0 + 1, pcm.length - 1)
    out[i] = Math.round(pcm[i0] + (pcm[i1] - pcm[i0]) * (x - i0))
  }
  return out
}

/** อ่าน WAV (PCM 16-bit) แล้วคืนค่าเสียงแบบ mono ที่ SAMPLE_RATE */
export function parseWav(bytes: Uint8Array): Int16Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3])
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new GoogleTtsError('ไฟล์เสียงที่ได้รับไม่ใช่ WAV')
  let channels = 1
  let rate = SAMPLE_RATE
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const id = tag(offset)
    const size = view.getUint32(offset + 4, true)
    const start = offset + 8
    if (id === 'fmt ') {
      channels = view.getUint16(start + 2, true)
      rate = view.getUint32(start + 4, true)
    } else if (id === 'data') {
      const len = Math.floor(Math.min(size, bytes.length - start) / 2)
      const frames = Math.floor(len / channels)
      const pcm = new Int16Array(frames)
      for (let i = 0; i < frames; i++) pcm[i] = view.getInt16(start + i * channels * 2, true)
      return resample(pcm, rate, SAMPLE_RATE)
    }
    offset = start + size + (size % 2)
  }
  throw new GoogleTtsError('ไม่พบข้อมูลเสียงในไฟล์ WAV')
}

export function silence(ms: number) {
  return new Int16Array(Math.round((SAMPLE_RATE * ms) / 1000))
}

export function concatPcm(parts: Int16Array[]) {
  const out = new Int16Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

export function pcmSeconds(pcm: Int16Array) {
  return pcm.length / SAMPLE_RATE
}

export function encodeWav(pcm: Int16Array): Blob {
  const buf = new ArrayBuffer(44 + pcm.length * 2)
  const v = new DataView(buf)
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + pcm.length * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, SAMPLE_RATE, true)
  v.setUint32(28, SAMPLE_RATE * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, pcm.length * 2, true)
  new Int16Array(buf, 44).set(pcm)
  return new Blob([buf], { type: 'audio/wav' })
}

/* ---------- สังเคราะห์เสียง ---------- */

const cache = new Map<string, Promise<Int16Array>>()
/** เสียงที่ไม่รองรับการปรับ pitch (เช่น Chirp3-HD บางตัว) — จำไว้เพื่อไม่ต้องลองซ้ำ */
const noPitch = new Set<string>()

async function synthesizeChunk(key: string, text: string, voice: GoogleVoice | null, lang: string, s: GoogleVoiceSettings) {
  const audio = toGoogleAudioConfig(s)
  const voiceName = voice?.name
  const request = async (withPitch: boolean) => {
    const body = (await call('text:synthesize', key, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: voiceName ? { languageCode: voiceLang(voice!), name: voiceName } : { languageCode: lang },
        audioConfig: {
          audioEncoding: 'LINEAR16',
          sampleRateHertz: SAMPLE_RATE,
          speakingRate: audio.speakingRate,
          volumeGainDb: audio.volumeGainDb,
          ...(withPitch && audio.pitch !== 0 ? { pitch: audio.pitch } : {}),
        },
      }),
    })) as { audioContent?: string }
    if (!body.audioContent) throw new GoogleTtsError('Google ไม่ได้ส่งเสียงกลับมา')
    return parseWav(base64ToBytes(body.audioContent))
  }

  const tryPitch = !(voiceName && noPitch.has(voiceName))
  try {
    return await request(tryPitch)
  } catch (e) {
    // บางเสียงไม่รองรับ pitch → ลองใหม่โดยไม่ส่ง pitch
    if (tryPitch && audio.pitch !== 0 && e instanceof GoogleTtsError && /pitch|not supported/i.test(e.message)) {
      if (voiceName) noPitch.add(voiceName)
      return request(false)
    }
    throw e
  }
}

function synthesizeCached(key: string, text: string, voice: GoogleVoice | null, lang: string, s: GoogleVoiceSettings) {
  const id = JSON.stringify([text, voice?.name ?? lang, s.rate, s.pitch, s.volume])
  let p = cache.get(id)
  if (!p) {
    p = synthesizeChunk(key, text, voice, lang, s)
    cache.set(id, p)
    p.catch(() => cache.delete(id))
  }
  return p
}

/** สร้างเสียงของข้อความหนึ่งชิ้น (แบ่งชิ้น/แยกภาษาให้อัตโนมัติ) */
export async function renderText(
  key: string,
  text: string,
  settings: GoogleVoiceSettings,
  voices: GoogleVoice[],
): Promise<Int16Array> {
  const chosen = settings.googleVoice ? voices.find((v) => v.name === settings.googleVoice) ?? null : null
  // Google รับได้ไม่เกิน 5000 ไบต์/ครั้ง (ภาษาไทย 1 ตัว = 3 ไบต์) จึงแบ่งชิ้นละไม่เกิน 1200 ตัวอักษร
  const jobs = chosen
    ? splitText(text, 1200).map((t) => ({ t, voice: chosen, lang: voiceLang(chosen) }))
    : splitByLanguage(text).flatMap((run) => {
        const voice = pickGoogleVoice(voices, run.lang)
        const lang = voice ? voiceLang(voice) : run.lang === 'th' ? 'th-TH' : 'en-US'
        return splitText(run.text, 1200).map((t) => ({ t, voice, lang }))
      })
  const parts: Int16Array[] = []
  for (const [i, job] of jobs.entries()) {
    if (i > 0) parts.push(silence(120))
    parts.push(await synthesizeCached(key, job.t, job.voice, job.lang, settings))
  }
  return concatPcm(parts)
}

/** โหลดรายชื่อเสียงของ Google เมื่อมี API key */
export function useGoogleVoices(key: string, enabled: boolean) {
  const [state, setState] = useState<{
    key: string
    status: 'idle' | 'loading' | 'ok' | 'error'
    voices: GoogleVoice[]
    error: string
  }>({ key: '', status: 'idle', voices: [], error: '' })
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    const k = key.trim()
    if (!enabled || k.length < 20) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      setState((s) => ({ ...s, key: k, status: 'loading', error: '' }))
      fetchGoogleVoices(k)
        .then((voices) => !cancelled && setState({ key: k, status: 'ok', voices, error: '' }))
        .catch((e: Error) => !cancelled && setState({ key: k, status: 'error', voices: [], error: e.message }))
    }, 400)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [key, enabled, reloadToken])

  const current = state.key === key.trim() && key.trim().length >= 20
  return {
    voices: current ? state.voices : [],
    status: current ? state.status : 'idle',
    error: current ? state.error : '',
    reload: () => setReloadToken((t) => t + 1),
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function timestamp() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}
