import { useAuth } from '../lib/AuthContext'
import { useTheme } from '../lib/ThemeContext'

export default function Settings() {
  const { user, signOut } = useAuth()
  const { theme, toggle } = useTheme()
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">⚙️ Настройки</h1>

      <div className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900/50">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Вошёл как</p>
        <p className="mt-1 font-medium break-all">{user?.email}</p>
      </div>

      <div className="flex items-center justify-between rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900/50">
        <div>
          <p className="font-medium">Тема оформления</p>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Сейчас: {theme === 'dark' ? 'тёмная' : 'светлая'}
          </p>
        </div>
        <button
          onClick={toggle}
          className="rounded-lg border border-neutral-300 px-4 py-2 text-sm transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          {theme === 'dark' ? '☀️ Светлая' : '🌙 Тёмная'}
        </button>
      </div>

      <button
        onClick={() => signOut()}
        className="self-start rounded-lg border border-red-500/40 px-4 py-2 text-sm text-red-500 transition hover:bg-red-500/10 dark:text-red-400"
      >
        Выйти
      </button>
    </div>
  )
}
