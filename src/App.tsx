import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/AuthContext'
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
import PlannerStub from './pages/PlannerStub'
import PlannerToday from './pages/PlannerToday'

function App() {
  const { session, loading } = useAuth()

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
        <Route path="/planner/items" element={<PlannerStub titleKey="pnav.items" icon="🗂️" />} />
        <Route path="/planner/habits" element={<PlannerStub titleKey="pnav.habits" icon="⏰" />} />
        <Route path="/planner/calendar" element={<PlannerStub titleKey="pnav.calendar" icon="🗓️" />} />
        <Route path="/planner/focus" element={<PlannerStub titleKey="pnav.focus" icon="🍅" />} />
        <Route path="/planner/stats" element={<PlannerStub titleKey="pnav.stats" icon="📊" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default App
