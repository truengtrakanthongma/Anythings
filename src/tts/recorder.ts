/**
 * บันทึกเสียงที่เครื่องพูดออกมา (ฟรี ไม่ต้องใช้บริการภายนอก)
 *
 * เบราว์เซอร์ไม่มีช่องทางดึงเสียงจาก speechSynthesis โดยตรง จึงใช้การแชร์หน้าจอ
 * พร้อม "เสียงของระบบ" (getDisplayMedia) แล้วอัดด้วย MediaRecorder
 * — ใช้ได้กับ Chrome / Edge บน Windows และ ChromeOS
 */

export class RecordError extends Error {}

export const isRecordingSupported =
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices?.getDisplayMedia &&
  typeof MediaRecorder !== 'undefined'

export interface DecodedAudio {
  samples: Float32Array
  sampleRate: number
}

export interface Capture {
  /** วินาทีที่ผ่านไปตั้งแต่เริ่มอัด */
  elapsed(): number
  /** หยุดอัดแล้วแปลงเป็นเสียง mono */
  stop(): Promise<DecodedAudio>
  /** ยกเลิกโดยไม่เก็บเสียง */
  cancel(): void
}

/** เริ่มอัดเสียงระบบ — เบราว์เซอร์จะถามผู้ใช้ให้เลือกหน้าจอที่จะแชร์ */
export async function startCapture(onSharingEnded: () => void): Promise<Capture> {
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      // ตัวเลือกเพิ่มเติมของ Chrome/Edge: ให้มีตัวเลือก "แชร์เสียงของระบบ" ในหน้าต่างเลือกจอ
      systemAudio: 'include',
      selfBrowserSurface: 'include',
      monitorTypeSurfaces: 'include',
    } as DisplayMediaStreamOptions)
  } catch (e) {
    if ((e as Error).name === 'NotAllowedError') throw new RecordError('ยกเลิกการแชร์หน้าจอ — ยังไม่ได้เริ่มบันทึก')
    throw new RecordError('เปิดการบันทึกเสียงไม่ได้ในเบราว์เซอร์นี้ (แนะนำ Chrome หรือ Edge บน Windows)')
  }

  const release = () => stream.getTracks().forEach((t) => t.stop())
  const audioTracks = stream.getAudioTracks()
  if (audioTracks.length === 0) {
    release()
    throw new RecordError(
      'ไม่ได้แชร์เสียง — ตอนเลือกหน้าจอให้เลือก "ทั้งหน้าจอ (Entire screen)" และติ๊ก "แชร์เสียงของระบบด้วย (Also share system audio)"',
    )
  }
  audioTracks[0].addEventListener('ended', onSharingEnded)

  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((m) =>
    MediaRecorder.isTypeSupported(m),
  )
  const recorder = new MediaRecorder(new MediaStream(audioTracks), mime ? { mimeType: mime } : undefined)
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  recorder.start(250)
  const t0 = performance.now()

  return {
    elapsed: () => (performance.now() - t0) / 1000,
    cancel() {
      audioTracks[0].removeEventListener('ended', onSharingEnded)
      if (recorder.state !== 'inactive') recorder.stop()
      release()
    },
    stop: () =>
      new Promise<DecodedAudio>((resolve, reject) => {
        audioTracks[0].removeEventListener('ended', onSharingEnded)
        const finish = async () => {
          release()
          try {
            const blob = new Blob(chunks, { type: recorder.mimeType })
            resolve(await decodeToMono(blob))
          } catch {
            reject(new RecordError('แปลงเสียงที่บันทึกไม่สำเร็จ กรุณาลองใหม่'))
          }
        }
        if (recorder.state === 'inactive') void finish()
        else {
          recorder.onstop = () => void finish()
          recorder.stop()
        }
      }),
  }
}

async function decodeToMono(blob: Blob): Promise<DecodedAudio> {
  const ctx = new AudioContext()
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
    const mono = new Float32Array(buf.length)
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const data = buf.getChannelData(c)
      for (let i = 0; i < data.length; i++) mono[i] += data[i] / buf.numberOfChannels
    }
    return { samples: mono, sampleRate: buf.sampleRate }
  } finally {
    void ctx.close()
  }
}

/* ---------- เครื่องมือจัดการเสียง ---------- */

export function peak(samples: Float32Array) {
  let p = 0
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i])
    if (v > p) p = v
  }
  return p
}

/** ตัดช่วงเงียบหัว-ท้าย (เหลือขอบไว้เล็กน้อย) */
export function trimSilence(samples: Float32Array, sampleRate: number, threshold = 0.01, padSec = 0.12) {
  let start = 0
  let end = samples.length - 1
  while (start < samples.length && Math.abs(samples[start]) < threshold) start++
  while (end > start && Math.abs(samples[end]) < threshold) end--
  if (start >= end) return new Float32Array(0)
  const pad = Math.round(padSec * sampleRate)
  return samples.subarray(Math.max(0, start - pad), Math.min(samples.length, end + pad + 1))
}

export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buf)
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([buf], { type: 'audio/wav' })
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

export interface Recording {
  url: string
  blob: Blob
  seconds: number
  /** ไฟล์เสียงแยกตาม tag (เช่น หมายเลขบรรทัด) */
  clips: Map<number, Blob>
}

/**
 * สร้างผลลัพธ์จากเสียงที่อัดได้ + เวลาเริ่มของแต่ละ tag
 * คืนค่า null ถ้าไม่มีเสียงถูกบันทึก (เช่น ไม่ได้ติ๊กแชร์เสียง หรือเลือกแชร์แท็บที่ไม่มีเสียง)
 */
export function buildRecording(audio: DecodedAudio, marks: { tag: number; t: number }[]): Recording | null {
  const { samples, sampleRate } = audio
  if (peak(samples) < 0.01) return null

  const clips = new Map<number, Blob>()
  marks.forEach((m, i) => {
    const from = Math.max(0, Math.round((m.t - 0.15) * sampleRate))
    const to = i + 1 < marks.length ? Math.round((marks[i + 1].t - 0.05) * sampleRate) : samples.length
    const clip = trimSilence(samples.subarray(from, Math.max(from, to)), sampleRate)
    if (clip.length > 0) clips.set(m.tag, encodeWav(clip, sampleRate))
  })

  const whole = trimSilence(samples, sampleRate, 0.01, 0.25)
  const blob = encodeWav(whole, sampleRate)
  return { url: URL.createObjectURL(blob), blob, seconds: whole.length / sampleRate, clips }
}
