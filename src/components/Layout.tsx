import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import BackupReminder from './BackupReminder'
import AssistantWidget from './AssistantWidget'
import { useLang } from '../lib/i18n'
import { MODULES, moduleForPath } from '../lib/modules'

export default function Layout() {
  const { t } = useLang()
  const location = useLocation()
  const navigate = useNavigate()
  const activeModule = moduleForPath(location.pathname)
  const navItems = activeModule.nav

  const moduleSwitcher = (
    <div className="flex w-full gap-1 rounded-xl bg-neutral-200/60 p-1 dark:bg-neutral-800/60">
      {MODULES.map((m) => {
        const isActive = m.id === activeModule.id
        return (
          <button
            key={m.id}
            onClick={() => navigate(m.home)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition ${
              isActive
                ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
                : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200'
            }`}
          >
            <span>{m.icon}</span>
            <span>{t(m.nameKey)}</span>
          </button>
        )
      })}
    </div>
  )

  return (
    <div className="min-h-screen md:flex">
      {/* Sidebar (desktop) */}
      <aside className="hidden md:flex md:w-60 md:flex-col md:border-r md:border-neutral-200 md:p-4 dark:md:border-neutral-800">
        <div className="mb-4 flex items-center gap-2 px-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500 text-lg">
            ⚛️
          </span>
          <span className="text-lg font-semibold">Nucleus</span>
        </div>
        <div className="mb-4">{moduleSwitcher}</div>
        <nav className="flex flex-col gap-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
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

      {/* Top bar (mobile): brand + module switcher */}
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-neutral-200 bg-white/95 px-4 py-2 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/95 md:hidden">
        <span className="flex items-center gap-1.5 font-semibold">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500 text-sm">
            ⚛️
          </span>
          Nucleus
        </span>
        <div className="ml-auto w-44">{moduleSwitcher}</div>
      </header>

      {/* Content */}
      <main className="flex-1 pb-20 md:pb-0">
        <div className="mx-auto max-w-3xl px-4 py-6">
          <Outlet />
        </div>
      </main>

      {/* Bottom navigation (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-neutral-200 bg-white/95 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/95 md:hidden">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
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

      {/* Floating assistant (bubble button + window). */}
      <AssistantWidget />

      <BackupReminder />
    </div>
  )
}
