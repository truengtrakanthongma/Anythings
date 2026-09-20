import { useMemo, useState } from 'react'
import { newId } from '../hooks/useLocalStorage'
import { useStore } from '../store'
import type { VocabWord } from '../types'

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function buildChoices(word: VocabWord, all: VocabWord[]) {
  const distractors = shuffle(all.filter((w) => w.id !== word.id))
    .slice(0, 3)
    .map((w) => w.meaning)
  return shuffle([word.meaning, ...distractors])
}

export function Vocabulary() {
  const { vocab, setVocab } = useStore()
  const [word, setWord] = useState('')
  const [meaning, setMeaning] = useState('')
  const [example, setExample] = useState('')
  const [tag, setTag] = useState('')
  const [filterTag, setFilterTag] = useState('')

  const [quizOn, setQuizOn] = useState(false)
  const [quizWords, setQuizWords] = useState<VocabWord[]>([])
  const [quizIndex, setQuizIndex] = useState(0)
  const [score, setScore] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)

  const tags = useMemo(
    () => Array.from(new Set(vocab.map((v) => v.tag).filter(Boolean))) as string[],
    [vocab],
  )

  const filtered = filterTag
    ? vocab.filter((v) => v.tag === filterTag)
    : vocab

  function addWord() {
    if (!word.trim() || !meaning.trim()) return
    setVocab((prev) => [
      ...prev,
      {
        id: newId(),
        word: word.trim(),
        meaning: meaning.trim(),
        example: example.trim() || undefined,
        tag: tag.trim() || undefined,
      },
    ])
    setWord('')
    setMeaning('')
    setExample('')
  }

  function removeWord(id: string) {
    setVocab((prev) => prev.filter((v) => v.id !== id))
  }

  function startQuiz() {
    const pool = filtered.length >= 4 ? filtered : vocab
    if (pool.length < 4) return
    setQuizWords(shuffle(pool).slice(0, Math.min(10, pool.length)))
    setQuizIndex(0)
    setScore(0)
    setSelected(null)
    setQuizOn(true)
  }

  const currentQuestion = quizWords[quizIndex]
  const choices = currentQuestion ? buildChoices(currentQuestion, vocab) : []

  function pickAnswer(choice: string) {
    if (selected) return
    setSelected(choice)
    if (choice === currentQuestion.meaning) setScore((s) => s + 1)
  }

  function nextQuestion() {
    if (quizIndex + 1 >= quizWords.length) {
      setQuizOn(false)
      return
    }
    setQuizIndex((i) => i + 1)
    setSelected(null)
  }

  if (quizOn && currentQuestion) {
    return (
      <div className="mx-auto max-w-lg rounded-xl bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between text-sm text-slate-500">
          <span>
            ข้อ {quizIndex + 1}/{quizWords.length}
          </span>
          <span>คะแนน: {score}</span>
        </div>
        <h2 className="mb-6 text-center text-2xl font-semibold text-slate-800">
          {currentQuestion.word}
        </h2>
        <div className="space-y-2">
          {choices.map((choice) => {
            const isCorrect = choice === currentQuestion.meaning
            const isPicked = choice === selected
            let cls =
              'w-full rounded-lg border px-4 py-2.5 text-left text-sm transition-colors '
            if (selected) {
              if (isCorrect) cls += 'border-emerald-400 bg-emerald-50 text-emerald-700'
              else if (isPicked) cls += 'border-red-400 bg-red-50 text-red-700'
              else cls += 'border-slate-200 text-slate-400'
            } else {
              cls += 'border-slate-200 hover:bg-slate-50 text-slate-700'
            }
            return (
              <button key={choice} className={cls} onClick={() => pickAnswer(choice)}>
                {choice}
              </button>
            )
          })}
        </div>
        {selected && (
          <button
            onClick={nextQuestion}
            className="mt-5 w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            {quizIndex + 1 >= quizWords.length ? 'ดูผลคะแนน' : 'ข้อถัดไป'}
          </button>
        )}
        <button
          onClick={() => setQuizOn(false)}
          className="mt-2 w-full text-xs text-slate-400 hover:underline"
        >
          ออกจากแบบทดสอบ
        </button>
      </div>
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-xl bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold text-slate-800">
          คลังคำศัพท์ภาษาอังกฤษ
        </h2>
        <div className="space-y-2">
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="คำศัพท์ (English word)"
            value={word}
            onChange={(e) => setWord(e.target.value)}
          />
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="คำแปล/ความหมาย"
            value={meaning}
            onChange={(e) => setMeaning(e.target.value)}
          />
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="ตัวอย่างประโยค (ถ้ามี)"
            value={example}
            onChange={(e) => setExample(e.target.value)}
          />
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="หมวดหมู่/บทเรียน เช่น Unit 1"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
          />
          <button
            onClick={addWord}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            เพิ่มคำศัพท์
          </button>
        </div>
      </section>

      <section className="rounded-xl bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">รายการคำศัพท์</h2>
          <div className="flex items-center gap-2">
            {tags.length > 0 && (
              <select
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                value={filterTag}
                onChange={(e) => setFilterTag(e.target.value)}
              >
                <option value="">ทั้งหมด</option>
                {tags.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={startQuiz}
              disabled={vocab.length < 4}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              เริ่มทำแบบทดสอบ
            </button>
          </div>
        </div>
        <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
          {filtered.map((v) => (
            <li key={v.id} className="flex items-start justify-between py-2">
              <div>
                <p className="text-sm font-medium text-slate-800">
                  {v.word}{' '}
                  <span className="font-normal text-slate-500">
                    - {v.meaning}
                  </span>
                </p>
                {v.example && (
                  <p className="text-xs italic text-slate-400">{v.example}</p>
                )}
                {v.tag && (
                  <span className="mt-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                    {v.tag}
                  </span>
                )}
              </div>
              <button
                onClick={() => removeWord(v.id)}
                className="text-xs text-red-500 hover:underline"
              >
                ลบ
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <p className="py-3 text-sm text-slate-400">ยังไม่มีคำศัพท์</p>
          )}
        </ul>
        {vocab.length < 4 && vocab.length > 0 && (
          <p className="mt-2 text-xs text-amber-500">
            เพิ่มคำศัพท์อย่างน้อย 4 คำเพื่อเริ่มทำแบบทดสอบ
          </p>
        )}
      </section>
    </div>
  )
}
