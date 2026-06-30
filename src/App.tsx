import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useAuth } from './lib/AuthContext'
import { supabase } from './lib/supabase'
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
  const userId = session?.user?.id

  // При входе восстанавливаем последнюю открытую страницу из БД.
  // База — единый источник правды, поэтому телефон и компьютер
  // открываются на одной и той же странице.
  useEffect(() => {
    if (!userId) return
    let active = true
    ;(async () => {
      try {
        const { data } = await supabase
          .from('app_settings')
          .select('last_path')
          .eq('user_id', userId)
          .maybeSingle()
        const dbPath = (data as { last_path?: string } | null)?.last_path
        if (active && dbPath && dbPath !== '/login') {
          setLastPath(dbPath)
          if (dbPath !== window.location.pathname && window.location.pathname === '/') {
            navigate(dbPath, { replace: true })
          }
        }
      } catch {
        /* игнорируем — останемся на текущей странице */
      } finally {
        if (active) setRestored(true)
      }
    })()

    return () => {
      active = false
    }
  }, [userId, navigate])

  // После восстановления сразу сохраняем текущую страницу в БД
  // (синхронизация между устройствами).
  useEffect(() => {
    if (!restored || !userId) return
    const p = location.pathname
    if (p === '/login') return
    setLastPath(p)
    void supabase.from('app_settings').upsert(
      { user_id: userId, last_path: p, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
  }, [restored, userId, location.pathname])

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
