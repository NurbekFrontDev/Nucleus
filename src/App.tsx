function App() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500 text-3xl shadow-lg shadow-emerald-500/30">
        💰
      </div>
      <h1 className="text-3xl font-semibold tracking-tight">FinLit</h1>
      <p className="max-w-sm text-neutral-400">
        Личный помощник по финансам. Tailwind подключён —
        изумрудный акцент работает. 🎉
      </p>
      <button className="rounded-lg bg-emerald-500 px-5 py-2.5 font-medium text-neutral-950 transition hover:bg-emerald-400">
        Проверка кнопки
      </button>
    </div>
  )
}

export default App
