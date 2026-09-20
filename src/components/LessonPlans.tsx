import { useState } from 'react'
import { newId } from '../hooks/useLocalStorage'
import { useStore } from '../store'
import { ClassSelect } from './ClassSelect'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

export function LessonPlans() {
  const { classes, lessonPlans, setLessonPlans } = useStore()
  const [selectedClassId, setSelectedClassId] = useState(classes[0]?.id ?? '')
  const [date, setDate] = useState(todayStr())
  const [topic, setTopic] = useState('')
  const [objectives, setObjectives] = useState('')
  const [activities, setActivities] = useState('')
  const [materials, setMaterials] = useState('')

  const plans = lessonPlans
    .filter((p) => p.classId === selectedClassId)
    .sort((a, b) => b.date.localeCompare(a.date))

  function addPlan() {
    if (!selectedClassId || !topic.trim()) return
    setLessonPlans((prev) => [
      ...prev,
      {
        id: newId(),
        classId: selectedClassId,
        date,
        topic: topic.trim(),
        objectives: objectives.trim() || undefined,
        activities: activities.trim() || undefined,
        materials: materials.trim() || undefined,
      },
    ])
    setTopic('')
    setObjectives('')
    setActivities('')
    setMaterials('')
  }

  function removePlan(id: string) {
    setLessonPlans((prev) => prev.filter((p) => p.id !== id))
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-xl bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold text-slate-800">
          เพิ่มแผนการสอน
        </h2>
        <div className="space-y-2">
          <ClassSelect value={selectedClassId} onChange={setSelectedClassId} />
          <input
            type="date"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="หัวข้อการสอน"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
          <textarea
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="จุดประสงค์การเรียนรู้"
            rows={2}
            value={objectives}
            onChange={(e) => setObjectives(e.target.value)}
          />
          <textarea
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="กิจกรรมการเรียนการสอน"
            rows={3}
            value={activities}
            onChange={(e) => setActivities(e.target.value)}
          />
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="สื่อ/อุปกรณ์"
            value={materials}
            onChange={(e) => setMaterials(e.target.value)}
          />
          <button
            onClick={addPlan}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            บันทึกแผนการสอน
          </button>
        </div>
      </section>

      <section className="rounded-xl bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold text-slate-800">
          ประวัติแผนการสอน
        </h2>
        <div className="space-y-3">
          {plans.map((p) => (
            <div key={p.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-800">
                    {p.topic}
                  </p>
                  <p className="text-xs text-slate-400">{p.date}</p>
                </div>
                <button
                  onClick={() => removePlan(p.id)}
                  className="text-xs text-red-500 hover:underline"
                >
                  ลบ
                </button>
              </div>
              {p.objectives && (
                <p className="mt-2 text-xs text-slate-600">
                  <span className="font-medium">จุดประสงค์:</span>{' '}
                  {p.objectives}
                </p>
              )}
              {p.activities && (
                <p className="mt-1 text-xs text-slate-600">
                  <span className="font-medium">กิจกรรม:</span>{' '}
                  {p.activities}
                </p>
              )}
              {p.materials && (
                <p className="mt-1 text-xs text-slate-600">
                  <span className="font-medium">สื่อ/อุปกรณ์:</span>{' '}
                  {p.materials}
                </p>
              )}
            </div>
          ))}
          {selectedClassId && plans.length === 0 && (
            <p className="text-sm text-slate-400">ยังไม่มีแผนการสอน</p>
          )}
        </div>
      </section>
    </div>
  )
}
