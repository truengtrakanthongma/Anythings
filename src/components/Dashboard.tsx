import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { ClassSelect } from './ClassSelect'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

export function Dashboard() {
  const {
    classes,
    students,
    attendance,
    gradeItems,
    assignments,
    lessonPlans,
    vocab,
  } = useStore()
  const [selectedClassId, setSelectedClassId] = useState(classes[0]?.id ?? '')

  const classStudents = students.filter((s) => s.classId === selectedClassId)

  const attendanceRate = useMemo(() => {
    const records = attendance.filter((a) => a.classId === selectedClassId)
    if (records.length === 0 || classStudents.length === 0) return null
    let present = 0
    let total = 0
    for (const r of records) {
      for (const s of classStudents) {
        const status = r.entries[s.id]
        if (!status) continue
        total += 1
        if (status === 'present') present += 1
      }
    }
    return total > 0 ? ((present / total) * 100).toFixed(1) : null
  }, [attendance, selectedClassId, classStudents])

  const upcomingAssignments = assignments
    .filter((a) => a.classId === selectedClassId && a.dueDate >= todayStr())
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 5)

  const classGradeItems = gradeItems.filter(
    (g) => g.classId === selectedClassId,
  )

  const avgScore = useMemo(() => {
    if (classGradeItems.length === 0 || classStudents.length === 0)
      return null
    let sum = 0
    let max = 0
    for (const item of classGradeItems) {
      max += item.maxScore * classStudents.length
      for (const s of classStudents) {
        sum += item.scores[s.id] ?? 0
      }
    }
    return max > 0 ? ((sum / max) * 100).toFixed(1) : null
  }, [classGradeItems, classStudents])

  const recentPlans = lessonPlans
    .filter((p) => p.classId === selectedClassId)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 3)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-slate-800">ภาพรวม</h2>
        <ClassSelect value={selectedClassId} onChange={setSelectedClassId} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="จำนวนนักเรียน" value={classStudents.length} />
        <StatCard
          label="อัตราการเข้าเรียน"
          value={attendanceRate ? `${attendanceRate}%` : '-'}
        />
        <StatCard
          label="คะแนนเฉลี่ยรวม"
          value={avgScore ? `${avgScore}%` : '-'}
        />
        <StatCard label="คำศัพท์ในคลัง" value={vocab.length} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">
            งานที่ใกล้ครบกำหนด
          </h3>
          <ul className="space-y-2">
            {upcomingAssignments.map((a) => (
              <li
                key={a.id}
                className="flex justify-between text-sm text-slate-600"
              >
                <span>{a.title}</span>
                <span className="text-slate-400">{a.dueDate}</span>
              </li>
            ))}
            {upcomingAssignments.length === 0 && (
              <p className="text-sm text-slate-400">ไม่มีงานที่ใกล้ครบกำหนด</p>
            )}
          </ul>
        </section>

        <section className="rounded-xl bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">
            แผนการสอนล่าสุด
          </h3>
          <ul className="space-y-2">
            {recentPlans.map((p) => (
              <li key={p.id} className="text-sm text-slate-600">
                <span className="text-slate-400">{p.date}</span> — {p.topic}
              </li>
            ))}
            {recentPlans.length === 0 && (
              <p className="text-sm text-slate-400">ยังไม่มีแผนการสอน</p>
            )}
          </ul>
        </section>
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-800">{value}</p>
    </div>
  )
}
