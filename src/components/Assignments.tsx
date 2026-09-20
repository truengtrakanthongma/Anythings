import { useState } from 'react'
import { newId } from '../hooks/useLocalStorage'
import { useStore } from '../store'
import type { AssignmentStatus } from '../types'
import { ClassSelect } from './ClassSelect'

const STATUS_LABEL: Record<AssignmentStatus, string> = {
  not_submitted: 'ยังไม่ส่ง',
  submitted: 'ส่งแล้ว',
  late: 'ส่งช้า',
}

const STATUS_COLOR: Record<AssignmentStatus, string> = {
  not_submitted: 'bg-slate-100 text-slate-500 border-slate-300',
  submitted: 'bg-emerald-100 text-emerald-700 border-emerald-300',
  late: 'bg-amber-100 text-amber-700 border-amber-300',
}

export function Assignments() {
  const { classes, students, assignments, setAssignments } = useStore()
  const [selectedClassId, setSelectedClassId] = useState(classes[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const classStudents = students
    .filter((s) => s.classId === selectedClassId)
    .sort((a, b) => a.number - b.number)

  const classAssignments = assignments
    .filter((a) => a.classId === selectedClassId)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))

  function addAssignment() {
    if (!selectedClassId || !title.trim() || !dueDate) return
    setAssignments((prev) => [
      ...prev,
      {
        id: newId(),
        classId: selectedClassId,
        title: title.trim(),
        dueDate,
        submissions: {},
      },
    ])
    setTitle('')
    setDueDate('')
  }

  function removeAssignment(id: string) {
    setAssignments((prev) => prev.filter((a) => a.id !== id))
  }

  function setSubmission(
    assignmentId: string,
    studentId: string,
    status: AssignmentStatus,
  ) {
    setAssignments((prev) =>
      prev.map((a) =>
        a.id === assignmentId
          ? {
              ...a,
              submissions: { ...a.submissions, [studentId]: status },
            }
          : a,
      ),
    )
  }

  return (
    <div className="rounded-xl bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-lg font-semibold text-slate-800">
        งาน / การบ้าน
      </h2>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ClassSelect value={selectedClassId} onChange={setSelectedClassId} />
        <input
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="ชื่องาน เช่น ใบงานที่ 3"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          type="date"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
        <button
          onClick={addAssignment}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          เพิ่มงาน
        </button>
      </div>

      <div className="space-y-2">
        {classAssignments.map((a) => {
          const submittedCount = classStudents.filter(
            (s) => a.submissions[s.id] && a.submissions[s.id] !== 'not_submitted',
          ).length
          const isOpen = expandedId === a.id
          return (
            <div key={a.id} className="rounded-lg border border-slate-200">
              <button
                onClick={() => setExpandedId(isOpen ? null : a.id)}
                className="flex w-full items-center justify-between px-4 py-3 text-left"
              >
                <div>
                  <p className="text-sm font-medium text-slate-800">
                    {a.title}
                  </p>
                  <p className="text-xs text-slate-400">
                    กำหนดส่ง {a.dueDate} · ส่งแล้ว {submittedCount}/
                    {classStudents.length}
                  </p>
                </div>
                <span
                  onClick={(e) => {
                    e.stopPropagation()
                    removeAssignment(a.id)
                  }}
                  className="text-xs text-red-500 hover:underline"
                >
                  ลบ
                </span>
              </button>
              {isOpen && (
                <div className="border-t border-slate-100 px-4 py-3">
                  <table className="w-full text-left text-sm">
                    <tbody className="divide-y divide-slate-100">
                      {classStudents.map((s) => {
                        const status = a.submissions[s.id] ?? 'not_submitted'
                        return (
                          <tr key={s.id}>
                            <td className="py-1.5">
                              {s.number}. {s.name}
                            </td>
                            <td className="py-1.5 text-right">
                              <div className="inline-flex gap-1.5">
                                {(
                                  Object.keys(
                                    STATUS_LABEL,
                                  ) as AssignmentStatus[]
                                ).map((key) => (
                                  <button
                                    key={key}
                                    onClick={() =>
                                      setSubmission(a.id, s.id, key)
                                    }
                                    className={`rounded-md border px-2 py-0.5 text-xs ${
                                      status === key
                                        ? STATUS_COLOR[key]
                                        : 'border-slate-200 text-slate-400 hover:bg-slate-50'
                                    }`}
                                  >
                                    {STATUS_LABEL[key]}
                                  </button>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
        {selectedClassId && classAssignments.length === 0 && (
          <p className="text-sm text-slate-400">ยังไม่มีงานที่มอบหมาย</p>
        )}
      </div>
    </div>
  )
}
