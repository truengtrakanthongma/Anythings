import { useMemo, useState } from 'react'
import { newId } from '../hooks/useLocalStorage'
import { useStore } from '../store'
import type { AttendanceStatus } from '../types'
import { ClassSelect } from './ClassSelect'

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: 'มา',
  absent: 'ขาด',
  late: 'สาย',
  leave: 'ลา',
}

const STATUS_COLOR: Record<AttendanceStatus, string> = {
  present: 'bg-emerald-100 text-emerald-700 border-emerald-300',
  absent: 'bg-red-100 text-red-700 border-red-300',
  late: 'bg-amber-100 text-amber-700 border-amber-300',
  leave: 'bg-sky-100 text-sky-700 border-sky-300',
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

export function Attendance() {
  const { classes, students, attendance, setAttendance } = useStore()
  const [selectedClassId, setSelectedClassId] = useState(classes[0]?.id ?? '')
  const [date, setDate] = useState(todayStr())

  const classStudents = students
    .filter((s) => s.classId === selectedClassId)
    .sort((a, b) => a.number - b.number)

  const record = useMemo(
    () =>
      attendance.find(
        (a) => a.classId === selectedClassId && a.date === date,
      ),
    [attendance, selectedClassId, date],
  )

  function setStatus(studentId: string, status: AttendanceStatus) {
    setAttendance((prev) => {
      const existing = prev.find(
        (a) => a.classId === selectedClassId && a.date === date,
      )
      if (existing) {
        return prev.map((a) =>
          a.id === existing.id
            ? { ...a, entries: { ...a.entries, [studentId]: status } }
            : a,
        )
      }
      return [
        ...prev,
        {
          id: newId(),
          classId: selectedClassId,
          date,
          entries: { [studentId]: status },
        },
      ]
    })
  }

  function markAll(status: AttendanceStatus) {
    setAttendance((prev) => {
      const existing = prev.find(
        (a) => a.classId === selectedClassId && a.date === date,
      )
      const entries = Object.fromEntries(
        classStudents.map((s) => [s.id, status]),
      )
      if (existing) {
        return prev.map((a) =>
          a.id === existing.id ? { ...a, entries } : a,
        )
      }
      return [
        ...prev,
        { id: newId(), classId: selectedClassId, date, entries },
      ]
    })
  }

  const summary = classStudents.reduce(
    (acc, s) => {
      const st = record?.entries[s.id]
      if (st) acc[st] += 1
      return acc
    },
    { present: 0, absent: 0, late: 0, leave: 0 } as Record<
      AttendanceStatus,
      number
    >,
  )

  return (
    <div className="rounded-xl bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-lg font-semibold text-slate-800">
        เช็คชื่อเข้าเรียน
      </h2>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <ClassSelect value={selectedClassId} onChange={setSelectedClassId} />
        <input
          type="date"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        {selectedClassId && (
          <div className="flex gap-2">
            <button
              onClick={() => markAll('present')}
              className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
            >
              มาทั้งหมด
            </button>
          </div>
        )}
      </div>

      {selectedClassId && classStudents.length > 0 && (
        <>
          <div className="mb-3 flex gap-3 text-xs text-slate-500">
            <span>มา: {summary.present}</span>
            <span>ขาด: {summary.absent}</span>
            <span>สาย: {summary.late}</span>
            <span>ลา: {summary.leave}</span>
          </div>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-slate-500">
                <th className="py-1 w-16">เลขที่</th>
                <th className="py-1">ชื่อ-นามสกุล</th>
                <th className="py-1">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {classStudents.map((s) => {
                const status = record?.entries[s.id]
                return (
                  <tr key={s.id}>
                    <td className="py-1.5">{s.number}</td>
                    <td className="py-1.5">{s.name}</td>
                    <td className="py-1.5">
                      <div className="flex gap-1.5">
                        {(Object.keys(STATUS_LABEL) as AttendanceStatus[]).map(
                          (key) => (
                            <button
                              key={key}
                              onClick={() => setStatus(s.id, key)}
                              className={`rounded-md border px-2 py-0.5 text-xs ${
                                status === key
                                  ? STATUS_COLOR[key]
                                  : 'border-slate-200 text-slate-400 hover:bg-slate-50'
                              }`}
                            >
                              {STATUS_LABEL[key]}
                            </button>
                          ),
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </>
      )}
      {selectedClassId && classStudents.length === 0 && (
        <p className="text-sm text-slate-400">ยังไม่มีนักเรียนในห้องนี้</p>
      )}
    </div>
  )
}
