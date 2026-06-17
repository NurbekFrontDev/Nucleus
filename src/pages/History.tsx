import { useEffect, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import PeriodFilter, { type PeriodValue } from '../components/PeriodFilter'
import { useLang } from '../lib/i18n'
import { formatSum, monthName, isCharityCategory } from '../lib/db'

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
  paid_from_pot: string | null
}

// label — сырое значение из БД (либо служебный sentinel), переводим при отрисовке.
type Breakdown = { label: string; amount: number; archived?: boolean }
type Detail = {
  income: number
  expense: number
  incomeBySource: Breakdown[]
  expenseBySub: Breakdown[]
}
type Acc = Record<string, { amount: number; archived: boolean }>

// Сворачиваем мапу в отсортированный по убыванию массив.
function toBreakdown(map: Acc): Breakdown[] {
  return Object.entries(map)
    .map(([label, v]) => ({ label, amount: v.amount, archived: v.archived }))
    .sort((a, b) => b.amount - a.amount)
}

const pad = (n: number) => String(n).padStart(2, '0')

const chipCls = (active: boolean) =>
  'rounded-full border px-3 py-1 text-xs transition ' +
  (active
    ? 'border-emerald-500 bg-emerald-500 font-medium text-neutral-950'
    : 'border-neutral-300 text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800')

export default function History() {
  const { user } = useAuth()
  const { t, tr } = useLang()
  const [months, setMonths] = useState<MonthRow[]>([])
  const [details, setDetails] = useState<Record<string, Detail>>({})
  const [openId, setOpenId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState<PeriodValue | null>(null)
  const [sortOrder, setSortOrder] = useState<'new' | 'old'>('new')

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
            .select('amount, month_id, subcategory, category_id, paid_from_pot')
            .eq('user_id', user.id),
          supabase.from('categories').select('id, name, archived').eq('user_id', user.id),
        ])
        if (!active) return
        if (mRes.error) throw mRes.error
        if (incRes.error) throw incRes.error
        if (expRes.error) throw expRes.error
        if (catRes.error) throw catRes.error

        const catName: Record<string, string> = {}
        const catArchived: Record<string, boolean> = {}
        for (const c of (catRes.data ?? []) as { id: string; name: string; archived?: boolean }[]) {
          catName[c.id] = c.name
          catArchived[c.id] = !!c.archived
        }

        const map: Record<string, Detail> = {}
        const ensure = (id: string) => {
          map[id] = map[id] ?? { income: 0, expense: 0, incomeBySource: [], expenseBySub: [] }
          return map[id]
        }
        const incSrc: Record<string, Acc> = {}
        const expSub: Record<string, Acc> = {}

        for (const r of (incRes.data ?? []) as IncomeRow[]) {
          if (!r.month_id) continue
          ensure(r.month_id).income += Number(r.amount)
          const key = (r.source ?? '').trim() || '__NO_SOURCE__'
          incSrc[r.month_id] = incSrc[r.month_id] ?? {}
          const cur = incSrc[r.month_id][key] ?? { amount: 0, archived: false }
          cur.amount += Number(r.amount)
          incSrc[r.month_id][key] = cur
        }
        for (const r of (expRes.data ?? []) as ExpenseRow[]) {
          if (!r.month_id) continue
          // Копилка благотворительности считается как чистый остаток:
          // пополнение (paid_from_pot === null) прибавляет, а пожертвование из копилки
          // (paid_from_pot === 'charity') вычитает. Так цифра в истории совпадает
          // с дашбордом и строкой «в копилки» во вкладке расходов.
          const isCharity = !!r.category_id && isCharityCategory(catName[r.category_id])
          const value = isCharity && r.paid_from_pot === 'charity' ? -Number(r.amount) : Number(r.amount)
          ensure(r.month_id).expense += value
          const sub = (r.subcategory ?? '').trim()
          let key: string
          let archived = false
          if (sub) key = sub
          else if (r.category_id && catName[r.category_id]) {
            key = catName[r.category_id]
            archived = catArchived[r.category_id]
          } else key = '__OTHER__'
          expSub[r.month_id] = expSub[r.month_id] ?? {}
          const cur = expSub[r.month_id][key] ?? { amount: 0, archived }
          cur.amount += value
          cur.archived = cur.archived || archived
          expSub[r.month_id][key] = cur
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

  // Перевод метки: sentinel → локаль, иначе tr() + маркер удалённой категории.
  const labelText = (b: Breakdown) => {
    if (b.label === '__NO_SOURCE__') return t('hist.noSource')
    if (b.label === '__OTHER__') return t('hist.other')
    return tr(b.label) + (b.archived ? ` ${t('exp.deleted')}` : '')
  }

  // Фильтруем месяцы по выбранному периоду (по пересечению с диапазоном) и сортируем.
  const visibleMonths = months
    .filter((m) => {
      if (!period) return true
      const mStart = m.year + '-' + pad(m.month) + '-01'
      const mEnd = m.year + '-' + pad(m.month) + '-31'
      return mEnd >= period.start && mStart <= period.end
    })
    .sort((a, b) => {
      const cmp = a.year !== b.year ? a.year - b.year : a.month - b.month
      return sortOrder === 'new' ? -cmp : cmp
    })

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold">🗓️ {t('hist.title')}</h1>

      <PeriodFilter onChange={setPeriod} modes={['month', 'year', 'all', 'range']} modesAlign="center" />

      {loading ? (
        <p className="text-neutral-500 dark:text-neutral-400">{t('common.loading')}</p>
      ) : error ? (
        <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
      ) : months.length === 0 ? (
        <p className="text-sm text-neutral-500">{t('hist.empty')}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-500">{t('common.sort')}</span>
            <button type="button" onClick={() => setSortOrder('new')} className={chipCls(sortOrder === 'new')}>
              {t('common.sortNew')}
            </button>
            <button type="button" onClick={() => setSortOrder('old')} className={chipCls(sortOrder === 'old')}>
              {t('common.sortOld')}
            </button>
          </div>
          {visibleMonths.length === 0 ? (
            <p className="text-sm text-neutral-500">{t('hist.noPeriod')}</p>
          ) : (
            visibleMonths.map((m) => {
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
                      {monthName(m.month - 1)} {m.year}
                    </span>
                    <span
                      className={`text-sm ${
                        balance >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'
                      }`}
                    >
                      {balance >= 0 ? '+' : '-'}
                      {formatSum(Math.abs(balance))}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-1 text-xs text-neutral-500 dark:text-neutral-400 sm:grid-cols-3 sm:gap-3">
                    <span className="flex justify-between gap-2 sm:flex-col sm:justify-start sm:gap-0.5">
                      <span className="text-neutral-500">{t('hist.plan')}</span>
                      <span className="font-medium text-neutral-700 dark:text-neutral-300">{formatSum(Number(m.planned_income))}</span>
                    </span>
                    <span className="flex justify-between gap-2 sm:flex-col sm:justify-start sm:gap-0.5">
                      <span className="text-neutral-500">{t('hist.income')}</span>
                      <span className="font-medium text-emerald-600 dark:text-emerald-400">{formatSum(d.income)}</span>
                    </span>
                    <span className="flex justify-between gap-2 sm:flex-col sm:justify-start sm:gap-0.5">
                      <span className="text-neutral-500">{t('hist.expense')}</span>
                      <span className="font-medium text-red-500 dark:text-red-400">{formatSum(d.expense)}</span>
                    </span>
                  </div>
                </button>

                {open && (
                  <div className="animate-pop flex flex-col gap-4 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
                    {Number(m.planned_income) > 0 && (
                      <p className="text-xs text-neutral-500">
                        {t('hist.planDone', { p: planPct })}
                      </p>
                    )}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="flex flex-col gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                          {t('hist.incomeBySource')}
                        </p>
                        {d.incomeBySource.length === 0 ? (
                          <p className="text-xs text-neutral-500">{t('hist.noIncome')}</p>
                        ) : (
                          d.incomeBySource.map((b) => (
                            <div key={b.label} className="flex items-center justify-between gap-2 text-sm">
                              <span className="truncate text-neutral-700 dark:text-neutral-300">{labelText(b)}</span>
                              <span className="shrink-0 font-medium">{formatSum(b.amount)}</span>
                            </div>
                          ))
                        )}
                      </div>
                      <div className="flex flex-col gap-2 border-t border-neutral-200 pt-4 dark:border-neutral-800 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
                        <p className="text-xs font-semibold uppercase tracking-wide text-red-500 dark:text-red-400">
                          {t('hist.expenseBySub')}
                        </p>
                        {d.expenseBySub.length === 0 ? (
                          <p className="text-xs text-neutral-500">{t('hist.noExpense')}</p>
                        ) : (
                          d.expenseBySub.map((b) => {
                            const pct = d.expense > 0 ? Math.round((b.amount / d.expense) * 100) : 0
                            return (
                              <div key={b.label} className="flex flex-col gap-1">
                                <div className="flex items-start justify-between gap-2 text-sm">
                                  <span className="min-w-0 break-words text-neutral-700 dark:text-neutral-300">{labelText(b)}</span>
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
          })
          )}
        </div>
      )}
    </div>
  )
}
