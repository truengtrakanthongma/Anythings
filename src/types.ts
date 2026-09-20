export type AttendanceStatus = 'present' | 'absent' | 'late' | 'leave'

export interface ClassRoom {
  id: string
  name: string
  subject: string
}

export interface Student {
  id: string
  classId: string
  number: number
  name: string
  parentContact?: string
  note?: string
}

export interface AttendanceRecord {
  id: string
  classId: string
  date: string // YYYY-MM-DD
  entries: Record<string, AttendanceStatus> // studentId -> status
}

export interface GradeItem {
  id: string
  classId: string
  name: string
  maxScore: number
  scores: Record<string, number | undefined> // studentId -> score
}

export type AssignmentStatus = 'not_submitted' | 'submitted' | 'late'

export interface Assignment {
  id: string
  classId: string
  title: string
  description?: string
  dueDate: string // YYYY-MM-DD
  submissions: Record<string, AssignmentStatus>
}

export interface LessonPlan {
  id: string
  classId: string
  date: string // YYYY-MM-DD
  topic: string
  objectives?: string
  activities?: string
  materials?: string
}

export interface VocabWord {
  id: string
  word: string
  meaning: string
  example?: string
  tag?: string
}
