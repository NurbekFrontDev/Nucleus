import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import { getOrCreateMonth, formatSum, MONTH_NAMES } from '../lib/db'

type Category = { id: string; name: string; percent: number; sort_order: number }

const inputCls =
  'rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-emerald-500'

export default function Budget() {
  const { user } = useAuth()
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1

  const [monthId, setMonthId] = useState<string | null>(null)
  const [plannedIncome, setPlannedIncome] = useState('')
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!user) return
    let active = true
    ;(async () => {
      try {
        setLoading(true)
        const [m, catRes] = await Promise.all([
          getOrCreateMonth(user.id, year, month),
          supabase
            .from('categories')
            .select('id, name, percent, sort_order')
            .eq('user_id', user.id)
            .order('sort_order'),
        ])
        if (!active) return
        if (catRes.error) throw catRes.error
        setMonthId(m.id)
        setPlannedIncome(String(m.planned_income ?? 0))
        setCategories(
          ((catRes.data ?? []) as Category[]).map((c) => ({
            ...c,
            percent: Number(c.percent),
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

  const income = Number(plannedIncome) || 0
  const totalPercent = categories.reduce((s, c) => s + Number(c.percent), 0)

  const setPercent = (id: string, val: string) => {
    setCategories((cs) =>
      cs.map((c) => (c.id === id ? { ...c, percent: Number(val) || 0 } : c)),
    )
    setSaved(false)
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!user || !monthId) return
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const { error: mErr } = await supabase
        .from('months')
        .update({ planned_income: income })
        .eq('id', monthId)
      if (mErr) throw mErr
      for (const c of categories) {
        const { error: cErr } = await supabase
          .from('categories')
          .update({ percent: Number(c.percent) })
          .eq('id', c.id)
        if (cErr) throw cErr
      }
      setSaved(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold">📊 Бюджет / План · {MONTH_NAMES[month - 1]}</h1>

      {loading ? (
        <p className="text-neutral-400">Загрузка…</p>
      ) : (
        <form onSubmit={save} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4">
            <label className="text-sm text-neutral-400">Плановый доход на месяц</label>
            <input
              inputMode="numeric"
              value={plannedIncome}
              onChange={(e) => {
                setPlannedIncome(e.target.value)
                setSaved(false)
              }}
              placeholder="Например, 10000000"
              className={inputCls}
            />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-neutral-400">Категории и проценты</span>
              <span
                className={`text-sm ${
                  totalPercent === 100 ? 'text-emerald-400' : 'text-amber-400'
                }`}
              >
                Сумма: {totalPercent}%
              </span>
            </div>

            {categories.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900/40 px-4 py-3"
              >
                <span className="flex-1 font-medium">{c.name}</span>
                <input
                  inputMode="numeric"
                  value={String(c.percent)}
                  onChange={(e) => setPercent(c.id, e.target.value)}
                  className="w-16 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-center text-sm outline-none focus:border-emerald-500"
                />
                <span className="text-neutral-500">%</span>
                <span className="w-36 text-right text-sm text-emerald-400">
                  {formatSum((income * Number(c.percent)) / 100)}
                </span>
              </div>
            ))}
          </div>

          {totalPercent !== 100 && (
            <p className="text-sm text-amber-400">
              ⚠️ Сумма процентов = {totalPercent}%. Рекомендуется ровно 100%.
            </p>
          )}
          {error && <p className="text-sm text-red-400">{error}</p>}
          {saved && <p className="text-sm text-emerald-400">✅ Сохранено!</p>}

          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-emerald-500 px-4 py-2.5 font-medium text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-60"
          >
            {busy ? 'Сохранение…' : 'Сохранить'}
          </button>
        </form>
      )}
    </div>
  )
}
