import { useState } from 'react'
import { Assignments } from './components/Assignments'
import { Attendance } from './components/Attendance'
import { Dashboard } from './components/Dashboard'
import { Grades } from './components/Grades'
import { LessonPlans } from './components/LessonPlans'
import { Students } from './components/Students'
import { Vocabulary } from './components/Vocabulary'
import { VoiceOver } from './components/VoiceOver'
import { StoreProvider } from './store'

const TABS = [
  { key: 'dashboard', label: 'ภาพรวม', component: Dashboard },
  { key: 'students', label: 'นักเรียน', component: Students },
  { key: 'attendance', label: 'เช็คชื่อ', component: Attendance },
  { key: 'grades', label: 'คะแนน', component: Grades },
  { key: 'assignments', label: 'งาน/การบ้าน', component: Assignments },
  { key: 'lessons', label: 'แผนการสอน', component: LessonPlans },
  { key: 'vocab', label: 'คำศัพท์ & แบบทดสอบ', component: Vocabulary },
  { key: 'voice', label: 'พากย์เสียง', component: VoiceOver },
] as const

function App() {
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]['key']>(
    'dashboard',
  )

  const ActiveComponent =
    TABS.find((t) => t.key === activeTab)?.component ?? Dashboard

  return (
    <StoreProvider>
      <div className="min-h-screen bg-slate-50">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-6xl px-4 py-4">
            <h1 className="text-xl font-bold text-indigo-700">
              ผู้ช่วยครู <span className="text-slate-400 font-normal text-sm">Teacher Assistant</span>
            </h1>
          </div>
          <nav className="mx-auto max-w-6xl overflow-x-auto px-4">
            <div className="flex gap-1 pb-2">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={`whitespace-nowrap rounded-t-lg px-4 py-2 text-sm font-medium transition-colors ${
                    activeTab === t.key
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-500 hover:bg-slate-100'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </nav>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-6">
          <ActiveComponent />
        </main>

        <footer className="mx-auto max-w-6xl px-4 py-6 text-center text-xs text-slate-400">
          ข้อมูลทั้งหมดถูกบันทึกไว้ในเบราว์เซอร์ของคุณ (localStorage)
        </footer>
      </div>
    </StoreProvider>
  )
}

export default App
