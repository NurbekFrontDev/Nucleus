import { useAuth } from '../lib/AuthContext'

export default function Settings() {
  const { user, signOut } = useAuth()
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">⚙️ Настройки</h1>
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6">
        <p className="text-sm text-neutral-400">Вошёл как</p>
        <p className="mt-1 font-medium break-all">{user?.email}</p>
      </div>
      <button
        onClick={() => signOut()}
        className="self-start rounded-lg border border-red-500/40 px-4 py-2 text-sm text-red-400 transition hover:bg-red-500/10"
      >
        Выйти
      </button>
    </div>
  )
}
