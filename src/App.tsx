import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from './lib/AuthContext'
import { supabase } from './lib/supabase'
import { initNativeAuth } from './lib/native'
import { Capacitor } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Incomes from './pages/Incomes'
import Expenses from './pages/Expenses'
import Budget from './pages/Budget'
import Goals from './pages/Goals'
import Investments from './pages/Investments'
import Charity from './pages/Charity'
import History from './pages/History'
import Settings from './pages/Settings'
import PlannerToday from './pages/PlannerToday'
import PlannerItems from './pages/PlannerItems'
import PlannerMatrix from './pages/PlannerMatrix'
import PlannerFocus from './pages/PlannerFocus'
import PlannerStats from './pages/PlannerStats'
import PlannerSettings from './pages/PlannerSettings'
import WaterTracker from './pages/WaterTracker'

function NotFoundRedirect({ fallback }: { fallback: string }) {
  const to = fallback && fallback !== '/login' ? fallback : '/'
  return <Navigate to={to} replace />
}

function App() {
  const { session, loading } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [lastPath, setLastPath] = useState('/')
  const [restored, setRestored] = useState(false)
  // Восстановление последней вкладки должно срабатывать ТОЛЬКО один раз при
  // загрузке. Иначе эффект перезапускается на каждой навигации (navigate из
  // react-router меняет идентичность при смене маршрута), и любой переход на '/'
  // (например клик по вкладке FinLit) мгновенно отбрасывает обратно на
  // сохранённый путь — из-за этого "не переключается".
  const didRestore = useRef(false)
  const userId = session?.user?.id

  // Восстановление последней открытой страницы — ИСТОЧНИК ПРАВДЫ ТОЛЬКО БАЗА
  // ДАННЫХ (app_settings.last_path). localStorage больше НЕ используется: это
  // даёт одинаковое поведение на телефоне и компьютере и убирает баг, когда
  // мобильный браузер очищает локальное хранилище и вкладка не восстанавливалась.
  useEffect(() => {
    if (!userId) return
    // Только один раз за загрузку (см. комментарий к didRestore выше).
    if (didRestore.current) return
    didRestore.current = true
    let active = true

    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('app_settings')
          .select('last_path')
          .eq('user_id', userId)
          .maybeSingle()
        if (error) {
          // Чаще всего это кеш схемы PostgREST: колонка last_path ещё не видна REST API.
          console.warn('[last_path] ошибка чтения из БД:', error.message)
        }
        const dbPath = (data as { last_path?: string } | null)?.last_path
        if (active && dbPath && dbPath !== '/login') {
          setLastPath(dbPath)
          // Восстанавливаем, только если пользователь ещё на корне и сам никуда
          // не перешёл — иначе не мешаем его текущей навигации.
          if (window.location.pathname === '/' && dbPath !== '/') {
            navigate(dbPath, { replace: true })
          }
        }
      } catch (e) {
        console.warn('[last_path] сбой восстановления:', e)
      } finally {
        if (active) setRestored(true)
      }
    })()

    return () => {
      active = false
    }
  }, [userId, navigate])

  // После восстановления сохраняем текущую страницу ТОЛЬКО в БД (синхрон между
  // устройствами). Локальное хранилище намеренно не трогаем.
  useEffect(() => {
    if (!restored || !userId) return
    const p = location.pathname
    if (p === '/login') return
    setLastPath(p)
    void (async () => {
      const { error } = await supabase.from('app_settings').upsert(
        { user_id: userId, last_path: p, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      )
      if (error) {
        console.warn('[last_path] ошибка сохранения в БД:', error.message)
      }
    })()
  }, [restored, userId, location.pathname])

  // Нативная авторизация: обновление токена при возврате в приложение и
  // обработка возврата из браузера после входа через Google (deep link).
  useEffect(() => {
    const cleanup = initNativeAuth()
    return cleanup
  }, [])

  // Аппаратная кнопка «назад» на Android: сначала уходим на предыдущий
  // экран внутри приложения, и только с «корневых» экранов модулей (FinLit/Планировщик)
  // сворачиваем приложение, а не закрываем его совсем.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let handle: { remove: () => void } | undefined
    CapacitorApp.addListener('backButton', () => {
      const path = window.location.pathname
      if (path === '/' || path === '/planner') {
        CapacitorApp.minimizeApp()
      } else {
        navigate(-1)
      }
    }).then((h) => {
      handle = h
    })
    return () => {
      handle?.remove()
    }
  }, [navigate])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-neutral-400">
        Загрузка…
      </div>
    )
  }

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/incomes" element={<Incomes />} />
        <Route path="/expenses" element={<Expenses />} />
        <Route path="/budget" element={<Budget />} />
        <Route path="/goals" element={<Goals />} />
        <Route path="/investments" element={<Investments />} />
        <Route path="/charity" element={<Charity />} />
        <Route path="/debts" element={<Navigate to="/expenses" replace />} />
        <Route path="/history" element={<History />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/planner" element={<PlannerToday />} />
        <Route path="/planner/items" element={<PlannerItems />} />
        <Route path="/planner/matrix" element={<PlannerMatrix />} />
        <Route path="/planner/habits" element={<Navigate to="/planner/items" replace />} />
        <Route path="/planner/calendar" element={<Navigate to="/planner" replace />} />
        <Route path="/planner/focus" element={<PlannerFocus />} />
        <Route path="/planner/stats" element={<PlannerStats />} />
        <Route path="/planner/settings" element={<PlannerSettings />} />
        <Route path="/planner/water" element={<WaterTracker />} />
        <Route path="*" element={<NotFoundRedirect fallback={lastPath} />} />
      </Route>
    </Routes>
  )
}

export default App
