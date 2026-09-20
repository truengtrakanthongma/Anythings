import { createContext, useContext, type ReactNode } from 'react'
import { useLocalStorage } from './hooks/useLocalStorage'
import type {
  Assignment,
  AttendanceRecord,
  ClassRoom,
  GradeItem,
  LessonPlan,
  Student,
  VocabWord,
} from './types'

interface StoreValue {
  classes: ClassRoom[]
  setClasses: React.Dispatch<React.SetStateAction<ClassRoom[]>>
  students: Student[]
  setStudents: React.Dispatch<React.SetStateAction<Student[]>>
  attendance: AttendanceRecord[]
  setAttendance: React.Dispatch<React.SetStateAction<AttendanceRecord[]>>
  gradeItems: GradeItem[]
  setGradeItems: React.Dispatch<React.SetStateAction<GradeItem[]>>
  assignments: Assignment[]
  setAssignments: React.Dispatch<React.SetStateAction<Assignment[]>>
  lessonPlans: LessonPlan[]
  setLessonPlans: React.Dispatch<React.SetStateAction<LessonPlan[]>>
  vocab: VocabWord[]
  setVocab: React.Dispatch<React.SetStateAction<VocabWord[]>>
}

const StoreContext = createContext<StoreValue | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [classes, setClasses] = useLocalStorage<ClassRoom[]>('ta_classes', [])
  const [students, setStudents] = useLocalStorage<Student[]>('ta_students', [])
  const [attendance, setAttendance] = useLocalStorage<AttendanceRecord[]>(
    'ta_attendance',
    [],
  )
  const [gradeItems, setGradeItems] = useLocalStorage<GradeItem[]>(
    'ta_grades',
    [],
  )
  const [assignments, setAssignments] = useLocalStorage<Assignment[]>(
    'ta_assignments',
    [],
  )
  const [lessonPlans, setLessonPlans] = useLocalStorage<LessonPlan[]>(
    'ta_lesson_plans',
    [],
  )
  const [vocab, setVocab] = useLocalStorage<VocabWord[]>('ta_vocab', [])

  const value: StoreValue = {
    classes,
    setClasses,
    students,
    setStudents,
    attendance,
    setAttendance,
    gradeItems,
    setGradeItems,
    assignments,
    setAssignments,
    lessonPlans,
    setLessonPlans,
    vocab,
    setVocab,
  }

  return (
    <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
  )
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}
