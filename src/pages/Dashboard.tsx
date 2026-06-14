import { useEffect, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import { getOrCreateMonth, formatSum, MONTH_NAMES } from '../lib/db'

type Category = { id: string; name: string; percent: number; sort_order: number }
type Row = { id: string; name: string; percent: number; plan: number; fact: number }

function statusFor(plan: number, fact: number) {
  if (plan <= 0) return { bar: 'bg-neutral-600', emoji: '⚪', pct: 0 }
  const pct = (fact / plan) * 100
  if (pct <= 80) return { bar: 'bg-emerald-500', emoji: '🟢', pct }
  if (pct <= 100) return { bar: 'bg-amber-500', emoji: '🟡', pct }
  return { bar: 'bg-red-500', emoji: '🔴', pct }
}

function Card({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4">
      <p className="text-xs text-neutral-400">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${accent ?? ''}`}>{value}</p>
    </div>
  )
}

export default function Dashboard() {
  const { user } = useAuth()
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [plannedIncome, setPlannedIncome] = useState(0)
  const [actualIncome, setActualIncome] = useState(0)
  const [rows, setRows] = useState<Row[]>([])

  useEffect(() => {
    if (!user) return
    let active = true
    ;(async () => {
      try {
        setLoading(true)
        const m = await getOrCreateMonth(user.id, year, month)
        const [catRes, incRes, expRes] = await Promise.all([
          supabase
            .from('categories')
            .select('id, name, percent, sort_order')
            .eq('user_id', user.id)
            .order('sort_order'),
          supabase.from('incomes').select('amount').eq('month_id', m.id),
          supabase.from('expenses').select('amount, category_id').eq('month_id', m.id),
        ])
        if (!active) return
        if (catRes.error) throw catRes.error
        if (incRes.error) throw incRes.error
        if (expRes.error) throw expRes.error

        const cats = (catRes.data ?? []) as Category[]
        const incomeSum = (incRes.data ?? []).reduce(
          (s: number, r: { amount: number }) => s + Number(r.amount),
          0,
        )
        const factByCat: Record<string, number> = {}
        for (const e of (expRes.data ?? []) as { amount: number; category_id: string | null }[]) {
          if (!e.category_id) continue
          factByCat[e.category_id] = (factByCat[e.category_id] ?? 0) + Number(e.amount)
        }
        const planned = Number(m.planned_income) || 0
        setPlannedIncome(planned)
        setActualIncome(incomeSum)
        setRows(
          cats.map((c) => ({
            id: c.id,
            name: c.name,
            percent: Number(c.percent),
            plan: (planned * Number(c.percent)) / 100,
            fact: factByCat[c.id] ?? 0,
          })),
        )
      } catch (e) {
        if (active) setError((e as Error).message)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [user, year, month])

  const totalExpense = rows.reduce((s, r) => s + r.fact, 0)
  const saved = rows
    .filter((r) => r.name === 'Сбережения' || r.name === 'Инвестиции')
    .reduce((s, r) => s + r.fact, 0)

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold">🏠 Дашборд · {MONTH_NAMES[month - 1]}</h1>

      {loading ? (
        <p className="text-neutral-400">Загрузка…</p>
      ) : error ? (
        <p className="text-sm text-red-400">{error}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Card label="Плановый доход" value={formatSum(plannedIncome)} />
            <Card label="Доход (факт)" value={formatSum(actualIncome)} accent="text-emerald-400" />
            <Card label="Расходы (факт)" value={formatSum(totalExpense)} accent="text-red-400" />
            <Card label="Уже отложено" value={formatSum(saved)} accent="text-emerald-400" />
          </div>

          {plannedIncome <= 0 && (
            <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
              ⚠️ Задай плановый доход и проценты в разделе «Бюджет», чтобы увидеть план против факта.
            </p>
          )}

          <div className="flex flex-col gap-3">
            <span className="text-sm text-neutral-400">План против факта по категориям</span>
            {rows.map((r) => {
              const st = statusFor(r.plan, r.fact)
              const remainder = r.plan - r.fact
              return (
                <div
                  key={r.id}
                  className="flex flex-col gap-2 rounded-xl border border-neutral-800 bg-neutral-900/40 px-4 py-3"
                >
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">
                      {st.emoji} {r.name}{' '}
                      <span className="text-neutral-500">{r.percent}%</span>
                    </span>
                    <span className="text-neutral-400">
                      {formatSum(r.fact)} / {formatSum(r.plan)}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-800">
                    <div
                      className={`h-full rounded-full ${st.bar}`}
                      style={{ width: `${Math.min(st.pct, 100)}%` }}
                    />
                  </div>
                  <div className="text-right text-xs text-neutral-500">
                    {remainder >= 0
                      ? `Остаток: ${formatSum(remainder)}`
                      : `Превышение: ${formatSum(-remainder)}`}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
