import { useState } from 'react'
import { newId } from '../hooks/useLocalStorage'
import { useStore } from '../store'
import { ClassSelect } from './ClassSelect'

export function Students() {
  const { classes, setClasses, students, setStudents } = useStore()
  const [selectedClassId, setSelectedClassId] = useState(classes[0]?.id ?? '')

  const [className, setClassName] = useState('')
  const [subject, setSubject] = useState('')

  const [studentName, setStudentName] = useState('')
  const [studentNumber, setStudentNumber] = useState('')
  const [parentContact, setParentContact] = useState('')

  const classStudents = students
    .filter((s) => s.classId === selectedClassId)
    .sort((a, b) => a.number - b.number)

  function addClass() {
    if (!className.trim()) return
    const id = newId()
    setClasses((prev) => [
      ...prev,
      { id, name: className.trim(), subject: subject.trim() || 'ทั่วไป' },
    ])
    setClassName('')
    setSubject('')
    setSelectedClassId(id)
  }

  function removeClass(id: string) {
    if (!confirm('ลบห้องเรียนนี้? ข้อมูลนักเรียนในห้องจะถูกลบไปด้วย')) return
    setClasses((prev) => prev.filter((c) => c.id !== id))
    setStudents((prev) => prev.filter((s) => s.classId !== id))
    if (selectedClassId === id) setSelectedClassId('')
  }

  function addStudent() {
    if (!selectedClassId || !studentName.trim() || !studentNumber.trim())
      return
    setStudents((prev) => [
      ...prev,
      {
        id: newId(),
        classId: selectedClassId,
        number: Number(studentNumber),
        name: studentName.trim(),
        parentContact: parentContact.trim() || undefined,
      },
    ])
    setStudentName('')
    setStudentNumber('')
    setParentContact('')
  }

  function removeStudent(id: string) {
    setStudents((prev) => prev.filter((s) => s.id !== id))
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-xl bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold text-slate-800">
          ห้องเรียน / วิชา
        </h2>
        <div className="mb-4 flex flex-wrap gap-2">
          <input
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="ชื่อห้อง เช่น ม.2/1"
            value={className}
            onChange={(e) => setClassName(e.target.value)}
          />
          <input
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="วิชา เช่น ภาษาอังกฤษ"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
          <button
            onClick={addClass}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            เพิ่มห้อง
          </button>
        </div>
        <ul className="divide-y divide-slate-100">
          {classes.map((c) => (
            <li
              key={c.id}
              className={`flex items-center justify-between py-2 px-2 rounded-lg cursor-pointer ${
                selectedClassId === c.id ? 'bg-indigo-50' : ''
              }`}
              onClick={() => setSelectedClassId(c.id)}
            >
              <span className="text-sm text-slate-700">
                {c.name}{' '}
                <span className="text-slate-400">({c.subject})</span>
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  removeClass(c.id)
                }}
                className="text-xs text-red-500 hover:underline"
              >
                ลบ
              </button>
            </li>
          ))}
          {classes.length === 0 && (
            <p className="py-2 text-sm text-slate-400">ยังไม่มีห้องเรียน</p>
          )}
        </ul>
      </section>

      <section className="rounded-xl bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold text-slate-800">
          รายชื่อนักเรียน
        </h2>
        <div className="mb-3">
          <ClassSelect
            value={selectedClassId}
            onChange={setSelectedClassId}
          />
        </div>

        {selectedClassId && (
          <>
            <div className="mb-4 flex flex-wrap gap-2">
              <input
                className="w-20 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="เลขที่"
                value={studentNumber}
                onChange={(e) => setStudentNumber(e.target.value)}
              />
              <input
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="ชื่อ-นามสกุล"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
              />
              <input
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="เบอร์ติดต่อผู้ปกครอง (ถ้ามี)"
                value={parentContact}
                onChange={(e) => setParentContact(e.target.value)}
              />
              <button
                onClick={addStudent}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                เพิ่มนักเรียน
              </button>
            </div>

            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-slate-500">
                  <th className="py-1">เลขที่</th>
                  <th className="py-1">ชื่อ-นามสกุล</th>
                  <th className="py-1">ผู้ปกครอง</th>
                  <th className="py-1"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {classStudents.map((s) => (
                  <tr key={s.id}>
                    <td className="py-1.5">{s.number}</td>
                    <td className="py-1.5">{s.name}</td>
                    <td className="py-1.5 text-slate-500">
                      {s.parentContact ?? '-'}
                    </td>
                    <td className="py-1.5 text-right">
                      <button
                        onClick={() => removeStudent(s.id)}
                        className="text-xs text-red-500 hover:underline"
                      >
                        ลบ
                      </button>
                    </td>
                  </tr>
                ))}
                {classStudents.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-3 text-center text-slate-400">
                      ยังไม่มีนักเรียนในห้องนี้
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}
      </section>
    </div>
  )
}
