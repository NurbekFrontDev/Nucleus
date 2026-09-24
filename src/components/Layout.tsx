import { Suspense, useEffect, useRef, useState } from 'react'
import ErrorBoundary from './ErrorBoundary'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import BackupReminder from './BackupReminder'
import AssistantWidget from './AssistantWidget'
import Toaster from './Toaster'
import OfflineBanner from './OfflineBanner'
import { useLang } from '../lib/i18n'
import { useAuth } from '../lib/AuthContext'
import { MODULES, moduleForPath } from '../lib/modules'
import { saveModulePath, loadModulePath } from '../lib/moduleNav'
import { isAdminEmail } from '../lib/installs'
import { useTheme } from '../lib/ThemeContext'
import SettingsModal from './SettingsModal'
import { FlagRu, FlagUs } from './FlagIcons'

export default function Layout() {
  const { t, lang, setLang } = useLang()
  const { user, signOut } = useAuth()
  const { theme, setTheme } = useTheme()
  const [profileOpen, setProfileOpen] = useState(false)
  const [settingsModalOpen, setSettingsModalOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const activeModule = moduleForPath(location.pathname)
  // Вкладка админ-панели видна только аккаунту администратора.
  const admin = isAdminEmail(user?.email)
  const visibleModules = MODULES.filter((m) => !m.adminOnly || admin)
  const navItems = activeModule.nav.filter((item) => !item.adminOnly || admin)
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
  }, [location.pathname, navItems, activeModule.nameKey, t])

  // Запоминаем последнюю подвкладку каждого модуля, чтобы при переключении
  // между FinLit, Планировщиком и Админ-панелью возвращаться туда, где был в этом модуле.
  useEffect(() => {
    saveModulePath(activeModule.id, location.pathname)
  }, [location.pathname, activeModule.id])

  // Desktop: всплывающее меню профиля над нижней кнопкой первичного рейла
  const renderDesktopProfilePopup = () => {
    if (!profileOpen) return null

    return (
      <>
        {/* Затемнение фона и перехват клика вне окна */}
        <div
          className="fixed inset-0 z-[99] hidden md:block"
          onClick={() => setProfileOpen(false)}
        />
        <div
          className="fixed bottom-16 left-3 z-[100] hidden w-64 rounded-2xl border border-neutral-200 bg-white/95 p-4 shadow-2xl backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-900/95 animate-pop md:block"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Email и шестерёнка настроек */}
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {user?.email || 'Nucleus'}
            </span>
            <button
              type="button"
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

          {/* Переключатель языка: Русский / English */}
          <div className="mb-2.5 flex items-center justify-between rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800/80">
            <button
              type="button"
              onClick={() => setLang('ru')}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs transition ${
                lang === 'ru'
                  ? 'bg-white shadow-sm dark:bg-neutral-700 text-emerald-600 dark:text-emerald-400 font-semibold'
                  : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 font-medium'
              }`}
            >
              <FlagRu className="h-3 w-4.5" />
              <span>Русский</span>
            </button>
            <button
              type="button"
              onClick={() => setLang('en')}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs transition ${
                lang === 'en'
                  ? 'bg-white shadow-sm dark:bg-neutral-700 text-emerald-600 dark:text-emerald-400 font-semibold'
                  : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 font-medium'
              }`}
            >
              <FlagUs className="h-3 w-4.5" />
              <span>English</span>
            </button>
          </div>

          {/* Переключатель темы: Система / Светлая / Тёмная */}
          <div className="mb-3 flex items-center justify-between rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800/80">
            <button
              type="button"
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
              type="button"
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
              type="button"
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
            type="button"
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

  // Mobile: плавно выезжающий правый сайдбар (Drawer) со всеми тремя модулями и профилем
  const renderMobileDrawer = () => {
    if (!profileOpen) return null

    return (
      <div className="fixed inset-0 z-[100] md:hidden">
        {/* Затемнение фона */}
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm animate-fade"
          onClick={() => setProfileOpen(false)}
        />
        {/* Выдвижная панель справа */}
        <aside
          className="fixed top-0 right-0 bottom-0 w-72 max-w-[85vw] bg-white/95 dark:bg-neutral-900/95 backdrop-blur-md border-l border-neutral-200 dark:border-neutral-800 p-5 shadow-2xl flex flex-col animate-slide-left"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Шапка шторки: профиль + крестик */}
          <div className="mb-5 flex items-center justify-between gap-3 border-b border-neutral-200/80 pb-4 dark:border-neutral-800">
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500 font-semibold text-neutral-950">
                {accountInitial}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {user?.email || 'Nucleus'}
                </p>
                <p className="text-[11px] text-neutral-400">Nucleus Account</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setProfileOpen(false)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            >
              ✕
            </button>
          </div>

          {/* Список 3 модулей (FinLit, Planner, Admin panel) */}
          <div className="mb-5 flex flex-col gap-1.5">
            <span className="px-1 text-[11px] font-bold uppercase tracking-wider text-neutral-400">
              {t('common.modules') || 'Модули'}
            </span>
            {visibleModules.map((m) => {
              const isActive = m.id === activeModule.id
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setProfileOpen(false)
                    navigate(loadModulePath(m.id, m.home))
                  }}
                  className={`flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                    isActive
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/30 font-semibold'
                      : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{m.icon}</span>
                    <span>{t(m.nameKey)}</span>
                  </div>
                  {isActive && <span className="text-xs text-emerald-500 font-bold">✓</span>}
                </button>
              )
            })}
          </div>

          <div className="mt-auto flex flex-col gap-2.5 pt-3 border-t border-neutral-200/80 dark:border-neutral-800">
            {/* Переключатель языка: Русский / English */}
            <div className="flex items-center justify-between rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800/80">
              <button
                type="button"
                onClick={() => setLang('ru')}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-1.5 text-xs transition ${
                  lang === 'ru'
                    ? 'bg-white shadow-sm dark:bg-neutral-700 text-emerald-600 dark:text-emerald-400 font-semibold'
                    : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 font-medium'
                }`}
              >
                <FlagRu className="h-3.5 w-5" />
                <span>Русский</span>
              </button>
              <button
                type="button"
                onClick={() => setLang('en')}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-1.5 text-xs transition ${
                  lang === 'en'
                    ? 'bg-white shadow-sm dark:bg-neutral-700 text-emerald-600 dark:text-emerald-400 font-semibold'
                    : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 font-medium'
                }`}
              >
                <FlagUs className="h-3.5 w-5" />
                <span>English</span>
              </button>
            </div>

            {/* Переключатель темы: Система / Светлая / Тёмная */}
            <div className="flex items-center justify-between rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800/80">
              <button
                type="button"
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
                type="button"
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
                type="button"
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

            {/* Настройки */}
            <button
              type="button"
              onClick={() => {
                setProfileOpen(false)
                setSettingsModalOpen(true)
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 py-2.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              <span>⚙️</span>
              <span>{t('profile.settings')}</span>
            </button>

            {/* Выход */}
            <button
              type="button"
              onClick={() => {
                setProfileOpen(false)
                if (signOut) signOut()
              }}
              className="w-full rounded-xl bg-red-50 py-2.5 text-center text-sm font-medium text-red-600 transition hover:bg-red-100 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-900/40"
            >
              {t('profile.logout')}
            </button>
          </div>
        </aside>
      </div>
    )
  }

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden md:flex-row">
      {/* Desktop Supabase-style Dual Navigation */}
      {/* 1. Primary Icon Rail (w-16) */}
      <aside className="hidden md:flex md:w-16 md:shrink-0 md:flex-col md:items-center md:py-3 md:border-r md:border-neutral-200 md:bg-neutral-50/70 dark:md:border-neutral-800 dark:md:bg-neutral-950/60 select-none">
        {/* Top: Nucleus Logo */}
        <div className="mb-6 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500 text-lg shadow-sm font-bold">
          ⚛️
        </div>

        {/* Vertical Icon Rail for Modules (FinLit, Planner, Admin) */}
        <div className="flex flex-col items-center gap-2.5 w-full">
          {visibleModules.map((m) => {
            const isActive = m.id === activeModule.id
            return (
              <div key={m.id} className="group relative flex w-full justify-center">
                <button
                  type="button"
                  onClick={() => navigate(loadModulePath(m.id, m.home))}
                  className={`relative flex h-10 w-10 items-center justify-center rounded-xl text-lg transition-all duration-150 ${
                    isActive
                      ? 'bg-emerald-500/15 text-emerald-600 shadow-sm dark:bg-emerald-500/25 dark:text-emerald-400'
                      : 'text-neutral-500 hover:bg-neutral-200/60 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-100'
                  }`}
                  aria-label={t(m.nameKey)}
                >
                  {isActive && (
                    <span className="absolute -left-3 top-1.5 bottom-1.5 w-1 rounded-r-full bg-emerald-500" />
                  )}
                  <span>{m.icon}</span>
                </button>
                {/* Tooltip on hover */}
                <div className="pointer-events-none absolute left-full ml-3 top-1/2 -translate-y-1/2 hidden rounded-md bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white shadow-xl whitespace-nowrap opacity-0 transition-opacity group-hover:opacity-100 group-hover:block dark:bg-neutral-100 dark:text-neutral-900 z-50">
                  {t(m.nameKey)}
                </div>
              </div>
            )
          })}
        </div>

        {/* Bottom: Account Circle */}
        <div className="mt-auto relative flex justify-center w-full">
          <button
            type="button"
            onClick={() => setProfileOpen((v) => !v)}
            title={accountLabel}
            aria-label={accountLabel}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500 font-semibold text-neutral-950 transition hover:ring-2 hover:ring-emerald-500/50"
          >
            {accountInitial}
          </button>
        </div>
      </aside>

      {/* 2. Secondary Sidebar (w-56) with Module Title and Subtabs */}
      <aside className="hidden md:flex md:w-56 md:shrink-0 md:flex-col md:overflow-y-auto md:border-r md:border-neutral-200 md:p-3 md:bg-white/80 dark:md:border-neutral-800 dark:md:bg-neutral-900/60 select-none">
        <div className="mb-3 px-2 pt-1 flex items-center gap-2">
          <span className="text-base">{activeModule.icon}</span>
          <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 truncate">
            {t(activeModule.nameKey)}
          </span>
        </div>
        <nav className="flex flex-col gap-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition ${
                  isActive
                    ? 'bg-emerald-500/15 font-medium text-emerald-700 dark:text-emerald-400'
                    : 'text-neutral-500 hover:bg-neutral-200/70 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-100'
                }`
              }
            >
              <span className="shrink-0">{item.icon}</span>
              <span className="truncate">{t(item.key)}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Mobile Top Bar */}
      <header className="z-20 flex shrink-0 items-center justify-between border-b border-neutral-200 bg-white/95 px-4 pt-[env(safe-area-inset-top)] pb-2 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/95 md:hidden">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500 text-sm font-bold">
            ⚛️
          </span>
          <span className="font-semibold text-sm">Nucleus</span>
          <span className="text-neutral-300 dark:text-neutral-700">/</span>
          <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400 truncate max-w-[140px]">
            {t(activeModule.nameKey)}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setProfileOpen(true)}
          title={accountLabel}
          aria-label={accountLabel}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-sm font-semibold text-neutral-950"
        >
          {accountInitial}
        </button>
      </header>

      {/* Content (scroll container) */}
      <main ref={mainRef} className="flex-1 overflow-y-auto pb-20 [scrollbar-gutter:stable_both-edges] md:pb-0">
        <div className="mx-auto max-w-3xl px-4 pb-6">
          <ErrorBoundary>
            <Suspense
              fallback={
                <div className="flex min-h-[40vh] items-center justify-center">
                  <span className="text-sm text-neutral-400 dark:text-neutral-500">Загрузка…</span>
                </div>
              }
            >
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </div>
      </main>

      {/* Bottom navigation (mobile) */}
      <nav className="no-scrollbar fixed inset-x-0 bottom-0 z-30 overflow-x-auto border-t border-neutral-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/95 md:hidden touch-pan-x" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="flex w-max min-w-full snap-x items-center justify-around px-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex shrink-0 snap-center flex-col items-center gap-0.5 px-3 py-2 text-[10px] transition ${
                  isActive ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-neutral-500 dark:text-neutral-400'
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

      {/* Всплывающее меню профиля (на десктопе). */}
      {renderDesktopProfilePopup()}

      {/* Мобильный сайдбар справа со списком модулей и профилем. */}
      {renderMobileDrawer()}

      {/* Глобальное модальное окно настроек (80% экрана). */}
      {settingsModalOpen && <SettingsModal onClose={() => setSettingsModalOpen(false)} />}
    </div>
  )
}
