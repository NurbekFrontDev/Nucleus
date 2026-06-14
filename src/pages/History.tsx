import { useEffect, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import { formatSum, MONTH_NAMES } from '../lib/db'

type MonthRow = {
  id: string
  year: number
  month: number
  planned_income: number
}

type Stat = { income: number; expense: number }

export default function History() {
  const { user } = useAuth()
  const [months, setMonths] = useState<MonthRow[]>([])
  const [stats, setStats] = useState<Record<string, Stat>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    let active = true
    ;(async () => {
      try {
        setLoading(true)
        const [mRes, incRes, expRes] = await Promise.all([
          supabase
            .from('months')
            .select('id, year, month, planned_income')
            .eq('user_id', user.id)
            .order('year', { ascending: false })
            .order('month', { ascending: false }),
          supabase.from('incomes').select('amount, month_id').eq('user_id', user.id),
          supabase.from('expenses').select('amount, month_id').eq('user_id', user.id),
        ])
        if (!active) return
        if (mRes.error) throw mRes.error
        if (incRes.error) throw incRes.error
        if (expRes.error) throw expRes.error

        const map: Record<string, Stat> = {}
        for (const r of (incRes.data ?? []) as { amount: number; month_id: string | null }[]) {
          if (!r.month_id) continue
          map[r.month_id] = map[r.month_id] ?? { income: 0, expense: 0 }
          map[r.month_id].income += Number(r.amount)
        }
        for (const r of (expRes.data ?? []) as { amount: number; month_id: string | null }[]) {
          if (!r.month_id) continue
          map[r.month_id] = map[r.month_id] ?? { income: 0, expense: 0 }
          map[r.month_id].expense += Number(r.amount)
        }
        setMonths((mRes.data ?? []) as MonthRow[])
        setStats(map)
      } catch (e) {
        if (active) setError((e as Error).message)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [user])

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold">🗓️ История</h1>

      {loading ? (
        <p className="text-neutral-500 dark:text-neutral-400">Загрузка…</p>
      ) : error ? (
        <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
      ) : months.length === 0 ? (
        <p className="text-sm text-neutral-500">Пока нет данных. Добавь доходы и расходы — месяцы появятся здесь.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {months.map((m) => {
            const s = stats[m.id] ?? { income: 0, expense: 0 }
            const balance = s.income - s.expense
            return (
              <div
                key={m.id}
                className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900/40"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {MONTH_NAMES[m.month - 1]} {m.year}
                  </span>
                  <span
                    className={`text-sm ${
                      balance >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'
                    }`}
                  >
                    {balance >= 0 ? '+' : ''}
                    {formatSum(balance)}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-1 text-xs text-neutral-500 dark:text-neutral-400 sm:grid-cols-3 sm:gap-3">
                  <span className="flex justify-between gap-2 sm:flex-col sm:justify-start sm:gap-0.5">
                    <span className="text-neutral-500">План</span>
                    <span className="font-medium text-neutral-700 dark:text-neutral-300">{formatSum(Number(m.planned_income))}</span>
                  </span>
                  <span className="flex justify-between gap-2 sm:flex-col sm:justify-start sm:gap-0.5">
                    <span className="text-neutral-500">Доход</span>
                    <span className="font-medium text-emerald-600 dark:text-emerald-400">{formatSum(s.income)}</span>
                  </span>
                  <span className="flex justify-between gap-2 sm:flex-col sm:justify-start sm:gap-0.5">
                    <span className="text-neutral-500">Расход</span>
                    <span className="font-medium text-red-500 dark:text-red-400">{formatSum(s.expense)}</span>
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
