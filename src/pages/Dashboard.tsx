import { useEffect, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import { useLang } from '../lib/i18n'
import {
  getOrCreateMonth,
  formatSum,
  monthName,
  loadCushionStats,
  loadCushionMonths,
  saveCushionMonths,
  loadSavingsPots,
  isSavingsCategory,
  isCharityCategory,
  DEFAULT_CUSHION_MONTHS,
  type CushionStats,
  type SavingsPotsStats,
} from '../lib/db'

type Category = { id: string; name: string; percent: number; sort_order: number }
type Row = { id: string; name: string; percent: number; plan: number; fact: number }

function statusFor(plan: number, fact: number) {
  if (plan <= 0) return { bar: 'bg-neutral-400 dark:bg-neutral-600', emoji: '⚪', pct: 0 }
  const pct = (fact / plan) * 100
  if (pct <= 80) return { bar: 'bg-emerald-500', emoji: '🟢', pct }
  if (pct <= 100) return { bar: 'bg-amber-500', emoji: '🟡', pct }
  return { bar: 'bg-red-500', emoji: '🔴', pct }
}

function Card({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50">
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${accent ?? ''}`}>{value}</p>
    </div>
  )
}

export default function Dashboard() {
  const { user } = useAuth()
  const { t, tr } = useLang()
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [plannedIncome, setPlannedIncome] = useState(0)
  const [actualIncome, setActualIncome] = useState(0)
  const [totalSpent, setTotalSpent] = useState(0)
  const [rows, setRows] = useState<Row[]>([])
  const [cushionMonths, setCushionMonths] = useState(DEFAULT_CUSHION_MONTHS)
  const [cushion, setCushion] = useState<CushionStats | null>(null)
  const [pots, setPots] = useState<SavingsPotsStats>({ cushion: 0, free: 0, charity: 0, total: 0 })

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
            .eq('archived', false)
            .order('sort_order'),
          supabase.from('incomes').select('amount').eq('month_id', m.id),
          supabase.from('expenses').select('amount, category_id, paid_from_pot').eq('month_id', m.id),
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
        // Накопительные категории (Сбережения/Инвестиции): отложенное туда — не трата,
        // поэтому исключаем их из карточки «Расходы» (но в «План против факта» они остаются).
        const savingsCatIds = new Set(
          cats.filter((c) => isSavingsCategory(c.name)).map((c) => c.id),
        )
        // Благотворительность тоже исключаем из карточки «Расходы»: это «не мои» деньги
        // (отложенные 5% и пожертвования из копилки), а не личные траты на жизнь.
        const charityCatIds = new Set(
          cats.filter((c) => isCharityCategory(c.name)).map((c) => c.id),
        )
        const factByCat: Record<string, number> = {}
        for (const e of (expRes.data ?? []) as { amount: number; category_id: string | null; paid_from_pot: string | null }[]) {
          if (!e.category_id) continue
          if (e.paid_from_pot === 'charity') continue // пожертвование из копилки — не пополнение бюджета «Благотворительность»
          factByCat[e.category_id] = (factByCat[e.category_id] ?? 0) + Number(e.amount)
        }
        const expenseSum = ((expRes.data ?? []) as { amount: number; category_id: string | null }[])
          .filter((e) => !e.category_id || (!savingsCatIds.has(e.category_id) && !charityCatIds.has(e.category_id)))
          .reduce((s, e) => s + Number(e.amount), 0)
        const planned = Number(m.planned_income) || 0
        setPlannedIncome(planned)
        setActualIncome(incomeSum)
        setTotalSpent(expenseSum)
        setRows(
          cats.map((c) => ({
            id: c.id,
            name: c.name,
            percent: Number(c.percent),
            plan: (incomeSum * Number(c.percent)) / 100,
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

  useEffect(() => {
    if (!user) return
    let active = true
    ;(async () => {
      const n = await loadCushionMonths(user.id)
      if (active) setCushionMonths(n)
    })()
    return () => {
      active = false
    }
  }, [user])

  useEffect(() => {
    if (!user) return
    let active = true
    ;(async () => {
      try {
        const stats = await loadCushionStats(user.id, cushionMonths)
        if (active) setCushion(stats)
      } catch {
        if (active) setCushion(null)
      }
    })()
    return () => {
      active = false
    }
  }, [user, cushionMonths])

  useEffect(() => {
    if (!user) return
    let active = true
    ;(async () => {
      try {
        const p = await loadSavingsPots(user.id)
        if (active) setPots(p)
      } catch {
        if (active) setPots({ cushion: 0, free: 0, charity: 0, total: 0 })
      }
    })()
    return () => {
      active = false
    }
  }, [user])

  // «Уже отложено» теперь берём из реального баланса копилок (loadSavingsPots).

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold">🏠 {t('dash.title')} · {monthName(month - 1)}</h1>

      {loading ? (
        <p className="text-neutral-500 dark:text-neutral-400">{t('common.loading')}</p>
      ) : error ? (
        <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Card label={t('dash.incomeGoal')} value={formatSum(plannedIncome)} />
            <Card label={t('dash.incomeFact')} value={formatSum(actualIncome)} accent="text-emerald-600 dark:text-emerald-400" />
            <Card label={t('dash.expenseFact')} value={formatSum(totalSpent)} accent="text-red-500 dark:text-red-400" />
            <Card label={t('dash.saved')} value={formatSum(pots.total)} accent="text-emerald-600 dark:text-emerald-400" />
          </div>

          {actualIncome <= 0 && (
            <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
              {t('dash.addIncomeHint')}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3 items-stretch">
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 dark:border-emerald-500/20">
              <p className="text-sm font-medium">{t('cushion.title')}</p>
              <p className="mt-1 text-2xl font-semibold text-emerald-600 dark:text-emerald-400">
                {formatSum(pots.cushion)}
              </p>
              <div className="mt-2 flex gap-1">
                {[3, 6, 12].map((n) => (
                  <button
                    key={n}
                    onClick={() => {
                      setCushionMonths(n)
                      if (user) saveCushionMonths(user.id, n)
                    }}
                    className={`flex-1 rounded-lg py-1 text-xs ${
                      cushionMonths === n
                        ? 'bg-emerald-500 text-white'
                        : 'bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
                    }`}
                  >
                    {t('cushion.months', { n })}
                  </button>
                ))}
              </div>
              {cushion && cushion.recommended > 0 ? (
                <>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={ { width: `${Math.min((pots.cushion / cushion.recommended) * 100, 100)}%` } }
                    />
                  </div>
                  <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                    {t('cushion.progress', { n: cushionMonths, rec: formatSum(cushion.recommended) })}
                  </p>
                </>
              ) : (
                <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">{t('cushion.noData')}</p>
              )}
            </div>

            <div className="flex h-full flex-col gap-3">
              <div className="flex flex-1 flex-col justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 dark:border-emerald-500/20">
                <p className="text-sm font-medium">{t('savings.freeTitle')}</p>
                <p className="mt-1 text-2xl font-semibold text-emerald-600 dark:text-emerald-400">
                  {formatSum(pots.free)}
                </p>
              </div>

              <div className="flex flex-1 flex-col justify-center rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4 dark:border-rose-500/20">
                <p className="text-sm font-medium">{t('charity.title')}</p>
                <p className="mt-1 text-2xl font-semibold text-rose-600 dark:text-rose-400">
                  {formatSum(pots.charity)}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <span className="text-sm text-neutral-500 dark:text-neutral-400">{t('dash.planVsFact')}</span>
            {rows.map((r) => {
              const st = statusFor(r.plan, r.fact)
              const remainder = r.plan - r.fact
              return (
                <div
                  key={r.id}
                  className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900/40"
                >
                  <div className="flex flex-col gap-0.5 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <span className="font-medium">
                      {st.emoji} {tr(r.name)}{' '}
                      <span className="text-neutral-500">{r.percent}%</span>
                    </span>
                    <span className="text-neutral-500 dark:text-neutral-400">
                      {formatSum(r.fact)} / {formatSum(r.plan)}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                    <div
                      className={`h-full rounded-full ${st.bar}`}
                      style={ { width: `${Math.min(st.pct, 100)}%` } }
                    />
                  </div>
                  <div className="text-right text-xs text-neutral-500">
                    {remainder >= 0
                      ? t('dash.remainder', { v: formatSum(remainder) })
                      : t('dash.overspent', { v: formatSum(-remainder) })}
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
