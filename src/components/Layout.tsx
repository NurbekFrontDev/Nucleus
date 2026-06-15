import { NavLink, Outlet } from 'react-router-dom'
import BackupReminder from './BackupReminder'
import { useLang } from '../lib/i18n'

const navItems = [
  { to: '/', key: 'nav.dashboard', icon: '🏠' },
  { to: '/incomes', key: 'nav.incomes', icon: '💼' },
  { to: '/expenses', key: 'nav.expenses', icon: '🧾' },
  { to: '/budget', key: 'nav.budget', icon: '📊' },
  { to: '/goals', key: 'nav.goals', icon: '🎯' },
  { to: '/debts', key: 'nav.debts', icon: '💳' },
  { to: '/history', key: 'nav.history', icon: '🗓️' },
  { to: '/settings', key: 'nav.settings', icon: '⚙️' },
]

export default function Layout() {
  const { t } = useLang()
  return (
    <div className="min-h-screen md:flex">
      {/* Боковое меню (десктоп) */}
      <aside className="hidden md:flex md:w-60 md:flex-col md:border-r md:border-neutral-200 md:p-4 dark:md:border-neutral-800">
        <div className="mb-8 flex items-center gap-2 px-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500 text-lg">
            💰
          </span>
          <span className="text-lg font-semibold">FinLit</span>
        </div>
        <nav className="flex flex-col gap-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                  isActive
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                    : 'text-neutral-500 hover:bg-neutral-200/70 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-100'
                }`
              }
            >
              <span>{item.icon}</span>
              {t(item.key)}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Контент */}
      <main className="flex-1 pb-20 md:pb-0">
        <div className="mx-auto max-w-3xl px-4 py-6">
          <Outlet />
        </div>
      </main>

      {/* Нижняя навигация (мобильный) */}
      <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-neutral-200 bg-white/95 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/95 md:hidden">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] transition ${
                isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-neutral-500 dark:text-neutral-400'
              }`
            }
          >
            <span className="flex h-5 items-center justify-center text-base leading-none">{item.icon}</span>
            {t(item.key)}
          </NavLink>
        ))}
      </nav>

      <BackupReminder />
    </div>
  )
}
