import { VoiceOver } from './components/VoiceOver'

function App() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-4">
          <h1 className="text-xl font-bold text-indigo-700">
            🎙️ พากย์เสียง <span className="text-sm font-normal text-slate-400">Voice-over Studio</span>
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <VoiceOver />
      </main>

      <footer className="mx-auto max-w-6xl px-4 py-6 text-center text-xs text-slate-400">
        การตั้งค่าและบทพากย์ถูกบันทึกไว้ในเบราว์เซอร์ของเครื่องนี้ (localStorage)
      </footer>
    </div>
  )
}

export default App
