import { useStore } from '../store'

interface Props {
  value: string
  onChange: (classId: string) => void
}

export function ClassSelect({ value, onChange }: Props) {
  const { classes } = useStore()

  if (classes.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        ยังไม่มีห้องเรียน กรุณาเพิ่มห้องเรียนที่แท็บ "นักเรียน" ก่อน
      </p>
    )
  }

  return (
    <select
      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {classes.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name} ({c.subject})
        </option>
      ))}
    </select>
  )
}
