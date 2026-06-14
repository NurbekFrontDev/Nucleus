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

type IncomeRow = { amount: number; month_id: string | null; source: string | null }
type ExpenseRow = {
  amount: number
  month_id: string | null
  subcategory: string | null
  category_id: string | null
}

type Breakdown = { label: string; amount: number }
type Detail = {
  income: number
  expense: number
  incomeBySource: Breakdown[]
  expenseBySub: Breakdown[]
}

// Сворачиваем мапу {label: sum} в отсортированный по убыванию массив.
function toBreakdown(map: Record<string, number>): Breakdown[] {
  return Object.entries(map)
    .map(([label, amount]) => ({ label, amount }))
    .sort((a, b) => b.amount - a.amount)
}

export default function History() {
  const { user } = useAuth()
  const [months, setMonths] = useState<MonthRow[]>([])
  const [details, setDetails] = useState<Record<string, Detail>>({})
  const [openId, setOpenId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    let active = true
    ;(async () => {
      try {
        setLoading(true)
        const [mRes, incRes, expRes, catRes] = await Promise.all([
          supabase
            .from('months')
            .select('id, year, month, planned_income')
            .eq('user_id', user.id)
            .order('year', { ascending: false })
            .order('month', { ascending: false }),
          supabase.from('incomes').select('amount, month_id, source').eq('user_id', user.id),
          supabase
            .from('expenses')
            .select('amount, month_id, subcategory, category_id')
            .eq('user_id', user.id),
          supabase.from('categories').select('id, name, archived').eq('user_id', user.id),
        ])
        if (!active) return
        if (mRes.error) throw mRes.error
        if (incRes.error) throw incRes.error
        if (expRes.error) throw expRes.error
        if (catRes.error) throw catRes.error

        const catName: Record<string, string> = {}
        for (const c of (catRes.data ?? []) as { id: string; name: string; archived?: boolean }[])
          catName[c.id] = c.archived ? `${c.name} (удалена)` : c.name

        const map: Record<string, Detail> = {}
        const ensure = (id: string) => {
          map[id] = map[id] ?? { income: 0, expense: 0, incomeBySource: [], expenseBySub: [] }
          return map[id]
        }
        const incSrc: Record<string, Record<string, number>> = {}
        const expSub: Record<string, Record<string, number>> = {}

        for (const r of (incRes.data ?? []) as IncomeRow[]) {
          if (!r.month_id) continue
          ensure(r.month_id).income += Number(r.amount)
          const key = (r.source ?? '').trim() || 'Без источника'
          incSrc[r.month_id] = incSrc[r.month_id] ?? {}
          incSrc[r.month_id][key] = (incSrc[r.month_id][key] ?? 0) + Number(r.amount)
        }
        for (const r of (expRes.data ?? []) as ExpenseRow[]) {
          if (!r.month_id) continue
          ensure(r.month_id).expense += Number(r.amount)
          const sub = (r.subcategory ?? '').trim()
          const cat = r.category_id ? catName[r.category_id] : ''
          const key = sub || cat || 'Прочее'
          expSub[r.month_id] = expSub[r.month_id] ?? {}
          expSub[r.month_id][key] = (expSub[r.month_id][key] ?? 0) + Number(r.amount)
        }
        for (const id of Object.keys(map)) {
          map[id].incomeBySource = toBreakdown(incSrc[id] ?? {})
          map[id].expenseBySub = toBreakdown(expSub[id] ?? {})
        }

        setMonths((mRes.data ?? []) as MonthRow[])
        setDetails(map)
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
      <p className="-mt-2 text-sm text-neutral-500 dark:text-neutral-400">
        Нажми на месяц, чтобы увидеть детализацию доходов и расходов.
      </p>

      {loading ? (
        <p className="text-neutral-500 dark:text-neutral-400">Загрузка…</p>
      ) : error ? (
        <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
      ) : months.length === 0 ? (
        <p className="text-sm text-neutral-500">Пока нет данных. Добавь доходы и расходы — месяцы появятся здесь.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {months.map((m) => {
            const d = details[m.id] ?? {
              income: 0,
              expense: 0,
              incomeBySource: [] as Breakdown[],
              expenseBySub: [] as Breakdown[],
            }
            const balance = d.income - d.expense
            const open = openId === m.id
            const planPct =
              Number(m.planned_income) > 0 ? Math.round((d.income / Number(m.planned_income)) * 100) : 0
            return (
              <div
                key={m.id}
                className="overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/40"
              >
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : m.id)}
                  className="flex w-full flex-col gap-2 px-4 py-3 text-left transition hover:bg-neutral-100 dark:hover:bg-neutral-800/40"
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 font-medium">
                      <span className={`text-neutral-400 transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
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
                      <span className="font-medium text-emerald-600 dark:text-emerald-400">{formatSum(d.income)}</span>
                    </span>
                    <span className="flex justify-between gap-2 sm:flex-col sm:justify-start sm:gap-0.5">
                      <span className="text-neutral-500">Расход</span>
                      <span className="font-medium text-red-500 dark:text-red-400">{formatSum(d.expense)}</span>
                    </span>
                  </div>
                </button>

                {open && (
                  <div className="flex flex-col gap-4 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
                    {Number(m.planned_income) > 0 && (
                      <p className="text-xs text-neutral-500">
                        План выполнен на <span className="font-medium text-neutral-700 dark:text-neutral-300">{planPct}%</span>
                      </p>
                    )}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="flex flex-col gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                          💰 Доходы по источникам
                        </p>
                        {d.incomeBySource.length === 0 ? (
                          <p className="text-xs text-neutral-500">Нет доходов</p>
                        ) : (
                          d.incomeBySource.map((b) => (
                            <div key={b.label} className="flex items-center justify-between gap-2 text-sm">
                              <span className="truncate text-neutral-700 dark:text-neutral-300">{b.label}</span>
                              <span className="shrink-0 font-medium">{formatSum(b.amount)}</span>
                            </div>
                          ))
                        )}
                      </div>
                      <div className="flex flex-col gap-2 border-t border-neutral-200 pt-4 dark:border-neutral-800 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
                        <p className="text-xs font-semibold uppercase tracking-wide text-red-500 dark:text-red-400">
                          🛒 Расходы по подкатегориям
                        </p>
                        {d.expenseBySub.length === 0 ? (
                          <p className="text-xs text-neutral-500">Нет расходов</p>
                        ) : (
                          d.expenseBySub.map((b) => {
                            const pct = d.expense > 0 ? Math.round((b.amount / d.expense) * 100) : 0
                            return (
                              <div key={b.label} className="flex flex-col gap-1">
                                <div className="flex items-center justify-between gap-2 text-sm">
                                  <span className="truncate text-neutral-700 dark:text-neutral-300">{b.label}</span>
                                  <span className="shrink-0 font-medium">
                                    {formatSum(b.amount)} <span className="text-xs text-neutral-400">({pct}%)</span>
                                  </span>
                                </div>
                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                                  <div className="h-full rounded-full bg-red-400/70" style={ { width: `${pct}%` } } />
                                </div>
                              </div>
                            )
                          })
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
