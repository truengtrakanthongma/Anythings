import { useCallback, useEffect, useRef, useState } from 'react'

/** รูปแบบเสียง (สไตล์การพากย์) — ปรับจากความเร็ว ระดับเสียง และความดัง */
export interface StylePreset {
  id: string
  label: string
  icon: string
  rate: number
  pitch: number
  volume: number
  hint: string
}

export const STYLE_PRESETS: StylePreset[] = [
  { id: 'normal', label: 'ปกติ', icon: '🙂', rate: 1, pitch: 1, volume: 1, hint: 'เสียงพูดทั่วไป' },
  { id: 'narrator', label: 'ผู้บรรยาย / สารคดี', icon: '🎙️', rate: 0.9, pitch: 0.85, volume: 1, hint: 'นุ่ม ทุ้ม ช้าเล็กน้อย' },
  { id: 'news', label: 'ผู้ประกาศข่าว', icon: '📺', rate: 1.1, pitch: 1, volume: 1, hint: 'ชัด กระฉับกระเฉง' },
  { id: 'child', label: 'เด็ก', icon: '🧒', rate: 1.1, pitch: 1.6, volume: 1, hint: 'เสียงสูง สดใส' },
  { id: 'elderly', label: 'คนชรา', icon: '👴', rate: 0.75, pitch: 0.7, volume: 0.9, hint: 'ช้า ทุ้ม' },
  { id: 'giant', label: 'ยักษ์ / ตัวร้าย', icon: '👹', rate: 0.8, pitch: 0.3, volume: 1, hint: 'ทุ้มต่ำมาก' },
  { id: 'cartoon', label: 'ตัวการ์ตูน', icon: '🐿️', rate: 1.35, pitch: 2, volume: 1, hint: 'เสียงแหลม เร็ว' },
  { id: 'robot', label: 'หุ่นยนต์', icon: '🤖', rate: 0.85, pitch: 0.1, volume: 1, hint: 'ราบเรียบ ต่ำ' },
  { id: 'excited', label: 'ตื่นเต้น', icon: '🤩', rate: 1.3, pitch: 1.3, volume: 1, hint: 'เร็ว เสียงสูง' },
  { id: 'soft', label: 'กระซิบ / เศร้า', icon: '🤫', rate: 0.8, pitch: 0.8, volume: 0.4, hint: 'เบา ช้า' },
  { id: 'listening', label: 'ช้า (ฝึกฟัง)', icon: '🐢', rate: 0.6, pitch: 1, volume: 1, hint: 'เหมาะกับการฝึกฟัง/เขียนตามคำบอก' },
  { id: 'fast', label: 'เร็ว', icon: '⚡', rate: 1.6, pitch: 1, volume: 1, hint: 'อ่านเร็ว' },
]

export function findPreset(rate: number, pitch: number, volume: number) {
  return STYLE_PRESETS.find(
    (p) => p.rate === rate && p.pitch === pitch && p.volume === volume,
  )
}

export interface VoiceSettings {
  /** voiceURI ของเสียงที่เลือก, '' = อัตโนมัติ (เลือกเสียงไทย/อังกฤษตามข้อความ) */
  voiceURI: string
  rate: number
  pitch: number
  volume: number
}

export interface Segment {
  text: string
  voice: SpeechSynthesisVoice | null
  lang: string
  rate: number
  pitch: number
  volume: number
  /** ใช้ระบุว่าส่วนนี้มาจากบรรทัด/ชิ้นไหน เพื่อไฮไลต์ */
  tag: number
  /** ถ้ากำหนด = ช่วงเงียบ (มิลลิวินาที) แทนการพูด */
  pauseMs?: number
}

export const isSpeechSupported =
  typeof window !== 'undefined' && 'speechSynthesis' in window

/** โหลดรายชื่อเสียงที่มีในเครื่อง/เบราว์เซอร์ (Chrome โหลดแบบ async) */
export function useVoices() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() =>
    isSpeechSupported ? window.speechSynthesis.getVoices() : [],
  )

  useEffect(() => {
    if (!isSpeechSupported) return
    const synth = window.speechSynthesis
    const update = () => setVoices(synth.getVoices())
    update()
    synth.addEventListener('voiceschanged', update)
    return () => synth.removeEventListener('voiceschanged', update)
  }, [])

  return voices
}

const THAI = /[฀-๿]/
const LETTER = /[\p{L}]/u

function langOf(v: SpeechSynthesisVoice) {
  return v.lang.toLowerCase().replace('_', '-')
}

/** เลือกเสียงที่ดีที่สุดสำหรับภาษา (ให้ความสำคัญกับเสียง Natural/Online/Google) */
export function pickVoiceForLang(
  voices: SpeechSynthesisVoice[],
  lang: 'th' | 'en',
): SpeechSynthesisVoice | null {
  const candidates = voices.filter((v) => langOf(v).startsWith(lang))
  const score = (v: SpeechSynthesisVoice) =>
    (/natural|online|google/i.test(v.name) ? 4 : 0) +
    (lang === 'en' && langOf(v) === 'en-us' ? 2 : 0) +
    (v.default ? 1 : 0)
  return [...candidates].sort((a, b) => score(b) - score(a))[0] ?? null
}

/**
 * แบ่งข้อความยาวเป็นชิ้นสั้น ๆ — Chrome มักตัดเสียงเมื่อพูดเกิน ~15 วินาที
 * และภาษาไทยไม่มีจุดจบประโยค จึงแบ่งตามบรรทัด เครื่องหมายวรรคตอน และช่องว่าง
 */
export function splitText(text: string, max = 160): string[] {
  const sentences = text
    .split(/\n+|(?<=[.!?।。！？…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)

  const out: string[] = []
  for (const sentence of sentences) {
    if (sentence.length <= max) {
      out.push(sentence)
      continue
    }
    let buf = ''
    for (const word of sentence.split(/\s+/)) {
      if (buf && buf.length + word.length + 1 > max) {
        out.push(buf)
        buf = ''
      }
      if (word.length > max) {
        for (let i = 0; i < word.length; i += max) out.push(word.slice(i, i + max))
        continue
      }
      buf = buf ? `${buf} ${word}` : word
    }
    if (buf) out.push(buf)
  }

  // รวมประโยคสั้น ๆ ที่อยู่ติดกันเข้าด้วยกัน เพื่อให้เสียงต่อเนื่อง ไม่สะดุด
  const merged: string[] = []
  for (const piece of out) {
    const last = merged[merged.length - 1]
    if (last !== undefined && last.length + piece.length + 1 <= max) merged[merged.length - 1] = `${last} ${piece}`
    else merged.push(piece)
  }
  return merged
}

/** แยกข้อความที่ผสมไทย-อังกฤษเป็นช่วง ๆ ตามภาษา */
export function splitByLanguage(text: string): { text: string; lang: 'th' | 'en' }[] {
  const runs = text.match(/[฀-๿][฀-๿\s\d.,!?…"'()\-:;]*|[^฀-๿]+/g) ?? []
  const out: { text: string; lang: 'th' | 'en' }[] = []
  for (const raw of runs) {
    const t = raw.trim()
    if (!t) continue
    const lang = THAI.test(t) ? 'th' : 'en'
    const prev = out[out.length - 1]
    // ช่วงที่มีแต่ตัวเลข/สัญลักษณ์ ให้รวมกับช่วงก่อนหน้า
    if (prev && (!LETTER.test(t) || prev.lang === lang)) {
      prev.text += ` ${t}`
      continue
    }
    out.push({ text: t, lang })
  }
  return out
}

/** แปลงข้อความ + การตั้งค่าเสียง เป็นลำดับ segment ที่พร้อมพูด */
export function buildSegments(
  text: string,
  settings: VoiceSettings,
  voices: SpeechSynthesisVoice[],
  tag: number,
): Segment[] {
  const base = { rate: settings.rate, pitch: settings.pitch, volume: settings.volume, tag }
  const chosen = settings.voiceURI
    ? voices.find((v) => v.voiceURI === settings.voiceURI) ?? null
    : null

  if (chosen) {
    return splitText(text).map((t) => ({ ...base, text: t, voice: chosen, lang: chosen.lang }))
  }

  // โหมดอัตโนมัติ: ไทยใช้เสียงไทย อังกฤษใช้เสียงอังกฤษ
  return splitByLanguage(text).flatMap((run) => {
    const voice = pickVoiceForLang(voices, run.lang)
    const lang = voice?.lang ?? (run.lang === 'th' ? 'th-TH' : 'en-US')
    return splitText(run.text).map((t) => ({ ...base, text: t, voice, lang }))
  })
}

export type PlayerStatus = 'idle' | 'playing' | 'paused'

/** ตัวเล่นเสียงแบบคิว: พูดทีละ segment, หยุดชั่วคราว/เล่นต่อ/หยุดได้ */
export function useSpeechPlayer() {
  const [status, setStatus] = useState<PlayerStatus>('idle')
  const [activeTag, setActiveTag] = useState<number | null>(null)
  const runRef = useRef(0)
  const timerRef = useRef<number | undefined>(undefined)
  const pausedRef = useRef(false)
  const pendingRef = useRef<(() => void) | null>(null)
  // เก็บ reference ของ utterance ไว้ ป้องกัน Chrome เก็บกวาดทิ้งก่อน onend ทำงาน
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null)

  const stop = useCallback(() => {
    runRef.current++
    window.clearTimeout(timerRef.current)
    pausedRef.current = false
    pendingRef.current = null
    if (isSpeechSupported) window.speechSynthesis.cancel()
    setStatus('idle')
    setActiveTag(null)
  }, [])

  const play = useCallback(
    (segments: Segment[], gapMs = 0) => {
      if (!isSpeechSupported) return
      stop()
      if (segments.length === 0) return
      const run = runRef.current
      const synth = window.speechSynthesis
      let i = 0
      setStatus('playing')

      const schedule = (fn: () => void, ms: number) => {
        timerRef.current = window.setTimeout(() => {
          if (run !== runRef.current) return
          if (pausedRef.current) pendingRef.current = fn
          else fn()
        }, ms)
      }

      const next = () => {
        if (run !== runRef.current) return
        if (i >= segments.length) {
          setStatus('idle')
          setActiveTag(null)
          return
        }
        const seg = segments[i++]
        const nextGap = segments[i] && segments[i].tag !== seg.tag ? gapMs : 0
        setActiveTag(seg.tag)

        if (seg.pauseMs !== undefined) {
          schedule(next, seg.pauseMs)
          return
        }

        const u = new SpeechSynthesisUtterance(seg.text)
        if (seg.voice) u.voice = seg.voice
        u.lang = seg.lang
        u.rate = seg.rate
        u.pitch = seg.pitch
        u.volume = seg.volume
        u.onend = () => schedule(next, nextGap)
        u.onerror = (e) => {
          if (e.error === 'interrupted' || e.error === 'canceled') return
          schedule(next, 0)
        }
        utterRef.current = u
        synth.speak(u)
      }

      // หน่วงเล็กน้อยหลัง cancel() เพราะบางเบราว์เซอร์จะไม่พูดถ้าเรียก speak ทันที
      schedule(next, 60)
    },
    [stop],
  )

  const pause = useCallback(() => {
    if (!isSpeechSupported) return
    pausedRef.current = true
    window.speechSynthesis.pause()
    setStatus('paused')
  }, [])

  const resume = useCallback(() => {
    if (!isSpeechSupported) return
    pausedRef.current = false
    window.speechSynthesis.resume()
    setStatus('playing')
    const pending = pendingRef.current
    pendingRef.current = null
    pending?.()
  }, [])

  useEffect(() => stop, [stop])

  return { status, activeTag, play, pause, resume, stop }
}

/** จัดกลุ่มเสียงสำหรับ dropdown: ไทย, อังกฤษ, ภาษาอื่น */
export function groupVoices(voices: SpeechSynthesisVoice[]) {
  const th: SpeechSynthesisVoice[] = []
  const en: SpeechSynthesisVoice[] = []
  const other: SpeechSynthesisVoice[] = []
  for (const v of voices) {
    const l = langOf(v)
    if (l.startsWith('th')) th.push(v)
    else if (l.startsWith('en')) en.push(v)
    else other.push(v)
  }
  const byName = (a: SpeechSynthesisVoice, b: SpeechSynthesisVoice) =>
    a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name)
  return [
    { label: 'ภาษาไทย', voices: th.sort(byName) },
    { label: 'English', voices: en.sort(byName) },
    { label: 'ภาษาอื่น ๆ', voices: other.sort(byName) },
  ].filter((g) => g.voices.length > 0)
}
