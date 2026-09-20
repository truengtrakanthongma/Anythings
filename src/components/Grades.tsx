import { useState } from 'react'
import { newId } from '../hooks/useLocalStorage'
import { useStore } from '../store'
import { ClassSelect } from './ClassSelect'

export function Grades() {
  const { classes, students, gradeItems, setGradeItems } = useStore()
  const [selectedClassId, setSelectedClassId] = useState(classes[0]?.id ?? '')
  const [name, setName] = useState('')
  const [maxScore, setMaxScore] = useState('100')

  const classStudents = students
    .filter((s) => s.classId === selectedClassId)
    .sort((a, b) => a.number - b.number)

  const items = gradeItems.filter((g) => g.classId === selectedClassId)

  function addItem() {
    if (!selectedClassId || !name.trim()) return
    setGradeItems((prev) => [
      ...prev,
      {
        id: newId(),
        classId: selectedClassId,
        name: name.trim(),
        maxScore: Number(maxScore) || 100,
        scores: {},
      },
    ])
    setName('')
    setMaxScore('100')
  }

  function removeItem(id: string) {
    setGradeItems((prev) => prev.filter((g) => g.id !== id))
  }

  function setScore(itemId: string, studentId: string, value: string) {
    const num = value === '' ? undefined : Math.max(0, Number(value))
    setGradeItems((prev) =>
      prev.map((g) =>
        g.id === itemId
          ? { ...g, scores: { ...g.scores, [studentId]: num } }
          : g,
      ),
    )
  }

  function totalFor(studentId: string) {
    let sum = 0
    let max = 0
    for (const item of items) {
      max += item.maxScore
      sum += item.scores[studentId] ?? 0
    }
    return { sum, max }
  }

  return (
    <div className="rounded-xl bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-lg font-semibold text-slate-800">
        บันทึกคะแนน
      </h2>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ClassSelect value={selectedClassId} onChange={setSelectedClassId} />
        <input
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="ชื่อรายการคะแนน เช่น สอบกลางภาค"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          type="number"
          className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="คะแนนเต็ม"
          value={maxScore}
          onChange={(e) => setMaxScore(e.target.value)}
        />
        <button
          onClick={addItem}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          เพิ่มรายการ
        </button>
      </div>

      {selectedClassId && classStudents.length > 0 && items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-slate-500">
                <th className="py-1 sticky left-0 bg-white pr-2">
                  ชื่อ-นามสกุล
                </th>
                {items.map((item) => (
                  <th key={item.id} className="py-1 px-2 whitespace-nowrap">
                    {item.name}
                    <div className="text-[10px] font-normal text-slate-400">
                      เต็ม {item.maxScore}
                    </div>
                    <button
                      onClick={() => removeItem(item.id)}
                      className="text-[10px] text-red-400 hover:underline"
                    >
                      ลบ
                    </button>
                  </th>
                ))}
                <th className="py-1 px-2">รวม</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {classStudents.map((s) => {
                const { sum, max } = totalFor(s.id)
                return (
                  <tr key={s.id}>
                    <td className="py-1.5 sticky left-0 bg-white pr-2">
                      {s.number}. {s.name}
                    </td>
                    {items.map((item) => (
                      <td key={item.id} className="py-1.5 px-2">
                        <input
                          type="number"
                          min={0}
                          max={item.maxScore}
                          className="w-16 rounded border border-slate-200 px-2 py-1 text-sm"
                          value={item.scores[s.id] ?? ''}
                          onChange={(e) =>
                            setScore(item.id, s.id, e.target.value)
                          }
                        />
                      </td>
                    ))}
                    <td className="py-1.5 px-2 font-medium">
                      {sum}/{max}{' '}
                      <span className="text-slate-400">
                        ({max > 0 ? ((sum / max) * 100).toFixed(1) : '0'}%)
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {selectedClassId && items.length === 0 && (
        <p className="text-sm text-slate-400">
          ยังไม่มีรายการคะแนน กรุณาเพิ่มรายการด้านบน
        </p>
      )}
    </div>
  )
}
