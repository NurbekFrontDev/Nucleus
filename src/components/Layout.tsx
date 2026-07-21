import { Suspense, useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import BackupReminder from './BackupReminder'
import AssistantWidget from './AssistantWidget'
import Toaster from './Toaster'
import { useLang } from '../lib/i18n'
import { MODULES, moduleForPath } from '../lib/modules'
import { saveModulePath, loadModulePath } from '../lib/moduleNav'

export default function Layout() {
  const { t } = useLang()
  const location = useLocation()
  const navigate = useNavigate()
  const activeModule = moduleForPath(location.pathname)
  const navItems = activeModule.nav
  // Контент скроллится внутри <main>, а не в окне — это позволяет закреплять
  // (sticky) шапки внутри каждой страницы, не перекрывая мобильную верхнюю панель.
  const mainRef = useRef<HTMLElement>(null)

  // Dynamic document title + scroll-to-top on route change.
  useEffect(() => {
    const path = location.pathname
    let titleKey = activeModule.nameKey
    for (const item of navItems) {
      const isActive = item.end ? path === item.to : path.startsWith(item.to)
      if (isActive) {
        titleKey = item.key
        break
      }
    }
    document.title = `${t(titleKey)} - Nucleus`
    mainRef.current?.scrollTo(0, 0)
    window.scrollTo(0, 0)
  }, [location.pathname, navItems])

  // Запоминаем последнюю подвкладку каждого модуля, чтобы при переключении
  // между FinLit и Планировщиком возвращаться туда, где был в этом модуле.
  useEffect(() => {
    saveModulePath(activeModule.id, location.pathname)
  }, [location.pathname, activeModule.id])

  const moduleSwitcher = (
    <div className="flex w-full gap-1 rounded-xl bg-neutral-200/60 p-1 dark:bg-neutral-800/60">
      {MODULES.map((m) => {
        const isActive = m.id === activeModule.id
        return (
          <button
            key={m.id}
            onClick={() => navigate(loadModulePath(m.id, m.home))}
            className={`flex min-w-0 flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium transition ${
              isActive
                ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
                : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200'
            }`}
          >
            <span className="shrink-0">{m.icon}</span>
            <span className="truncate">{t(m.nameKey)}</span>
          </button>
        )
      })}
    </div>
  )

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden md:flex-row">
      {/* Sidebar (desktop) */}
      <aside className="hidden md:flex md:w-72 md:shrink-0 md:flex-col md:overflow-y-auto md:border-r md:border-neutral-200 md:p-4 dark:md:border-neutral-800">
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

      {/* Top bar (mobile): brand + module switcher. Не скроллится — main скроллится сам. */}
      <header className="z-20 flex shrink-0 items-center gap-3 border-b border-neutral-200 bg-white/95 px-4 pt-[env(safe-area-inset-top)] pb-2 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/95 md:hidden">
        <span className="flex shrink-0 items-center gap-1.5 font-semibold">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500 text-sm">
            ⚛️
          </span>
          Nucleus
        </span>
        <div className="ml-auto min-w-0 flex-1">{moduleSwitcher}</div>
      </header>

      {/* Content (scroll container) */}
      <main ref={mainRef} className="flex-1 overflow-y-auto pb-20 [scrollbar-gutter:stable_both-edges] md:pb-0">
        <div className="mx-auto max-w-3xl px-4 pb-6">
          {/* Оболочка (шапка + нижняя навигация) видна мгновенно; тело страницы
              подгружается ленивым чанком под Suspense. fallback={null} — без
              спиннера: пустое тело на доли секунды, пока грузится чанк. */}
          <Suspense fallback={null}>
            <Outlet />
          </Suspense>
        </div>
      </main>

      {/* Bottom navigation (mobile) */}
      <nav className="no-scrollbar fixed inset-x-0 bottom-0 z-30 overflow-x-auto border-t border-neutral-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/95 md:hidden touch-pan-x" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="flex w-max min-w-full items-center justify-around px-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex shrink-0 flex-col items-center gap-0.5 px-3 py-2 text-[10px] transition ${
                  isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-neutral-500 dark:text-neutral-400'
                }`
              }
            >
              <span className="flex h-5 items-center justify-center text-base leading-none">{item.icon}</span>
              <span className="whitespace-nowrap">{t(item.key)}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      {/* Floating assistant (bubble button + window). */}
      <AssistantWidget />

      <BackupReminder />

      {/* Всплывающие тосты (напр. «автобэкап сделан»). */}
      <Toaster />
    </div>
  )
}
