import { Suspense, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import BackupReminder from './BackupReminder'
import AssistantWidget from './AssistantWidget'
import Toaster from './Toaster'
import OfflineBanner from './OfflineBanner'
import { useLang } from '../lib/i18n'
import { useAuth } from '../lib/AuthContext'
import { MODULES, moduleForPath } from '../lib/modules'
import { saveModulePath, loadModulePath } from '../lib/moduleNav'
import { useTheme } from '../lib/ThemeContext'
import SettingsModal from './SettingsModal'

export default function Layout() {
  const { t } = useLang()
  const { user, signOut } = useAuth()
  const { theme, setTheme } = useTheme()
  const [profileOpen, setProfileOpen] = useState(false)
  const [settingsModalOpen, setSettingsModalOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const activeModule = moduleForPath(location.pathname)
  const navItems = activeModule.nav
  const accountInitial = (user?.email?.trim()[0] || 'N').toUpperCase()
  const accountLabel = user?.email || 'Настройки'
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

  const renderProfilePopup = () => {
    if (!profileOpen) return null

    return (
      <>
        {/* Затемнение фона и перехват клика вне окна */}
        <div
          className="fixed inset-0 z-[99] bg-black/20 backdrop-blur-[1px] md:bg-transparent md:backdrop-blur-none"
          onClick={() => setProfileOpen(false)}
        />
        {/* Само всплывающее меню: на десктопе внизу слева над кнопкой профиля, на мобильном вверху справа под аватаром */}
        <div
          className="fixed z-[100] w-72 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-neutral-200 bg-white/95 p-4 shadow-2xl backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-900/95 top-[calc(env(safe-area-inset-top)+3.5rem)] right-3 md:top-auto md:right-auto md:left-4 md:bottom-20 md:w-64 animate-fade"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Email и шестерёнка настроек */}
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {user?.email || 'Nucleus'}
            </span>
            <button
              onClick={() => {
                setProfileOpen(false)
                setSettingsModalOpen(true)
              }}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
              title={t('profile.settings')}
            >
              ⚙️
            </button>
          </div>

          {/* Переключатель темы: Система / Светлая / Тёмная */}
          <div className="mb-3 flex items-center justify-between rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800/80">
            <button
              onClick={() => setTheme('system')}
              className={`flex flex-1 items-center justify-center rounded-lg py-1.5 text-sm transition ${
                theme === 'system'
                  ? 'bg-white shadow-sm dark:bg-neutral-700 text-emerald-500 font-medium'
                  : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200'
              }`}
              title={t('profile.themeSystem')}
            >
              💻
            </button>
            <button
              onClick={() => setTheme('light')}
              className={`flex flex-1 items-center justify-center rounded-lg py-1.5 text-sm transition ${
                theme === 'light'
                  ? 'bg-white shadow-sm dark:bg-neutral-700 text-emerald-500 font-medium'
                  : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200'
              }`}
              title={t('profile.themeLight')}
            >
              ☀️
            </button>
            <button
              onClick={() => setTheme('dark')}
              className={`flex flex-1 items-center justify-center rounded-lg py-1.5 text-sm transition ${
                theme === 'dark'
                  ? 'bg-white shadow-sm dark:bg-neutral-700 text-emerald-500 font-medium'
                  : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200'
              }`}
              title={t('profile.themeDark')}
            >
              🌙
            </button>
          </div>

          {/* Кнопка выхода */}
          <button
            onClick={() => {
              setProfileOpen(false)
              if (signOut) signOut()
            }}
            className="w-full rounded-xl bg-red-50 py-2 text-center text-sm font-medium text-red-600 transition hover:bg-red-100 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-900/40"
          >
            {t('profile.logout')}
          </button>
        </div>
      </>
    )
  }

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

        {/* Аккаунт всегда закреплён в левом нижнем углу сайдбара. */}
        <div className="relative mt-auto">
          <button
            type="button"
            onClick={() => setProfileOpen((v) => !v)}
            title={accountLabel}
            aria-label={accountLabel}
            className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500 font-semibold text-neutral-950">
              {accountInitial}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{user?.email || 'Nucleus'}</span>
              <span className="block text-xs text-neutral-500 dark:text-neutral-400">⚙️ {t('profile.settings')}</span>
            </span>
          </button>
        </div>
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
        <div className="relative flex shrink-0">
          <button
            type="button"
            onClick={() => setProfileOpen((v) => !v)}
            title={accountLabel}
            aria-label={accountLabel}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-sm font-semibold text-neutral-950"
          >
            {accountInitial}
          </button>
        </div>
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
        {/* w-max + snap-x: при большом системном шрифте вкладки не сжимаются и
            не пропадают, а список свободно тянется пальцем влево-вправо. */}
        <div className="flex w-max min-w-full snap-x items-center justify-around px-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex shrink-0 snap-center flex-col items-center gap-0.5 px-3 py-2 text-[10px] transition ${
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

      {/* Статус автономной работы и фоновой синхронизации. */}
      <OfflineBanner />

      {/* Всплывающие тосты (напр. «автобэкап сделан»). */}
      <Toaster />

      {/* Всплывающее меню профиля (поверх всего контента). */}
      {renderProfilePopup()}

      {/* Глобальное модальное окно настроек (80% экрана). */}
      {settingsModalOpen && <SettingsModal onClose={() => setSettingsModalOpen(false)} />}
    </div>
  )
}
