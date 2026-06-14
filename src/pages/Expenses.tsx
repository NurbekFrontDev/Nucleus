import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import { getOrCreateMonth, formatSum, MONTH_NAMES } from '../lib/db'

type Category = { id: string; name: string }
type Expense = {
  id: string
  amount: number
  date: string
  description: string | null
  category_id: string | null
}

const inputCls =
  'rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950'

export default function Expenses() {
  const { user } = useAuth()
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1

  const [monthId, setMonthId] = useState<string | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [items, setItems] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(now.toISOString().slice(0, 10))
  const [categoryId, setCategoryId] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!user) return
    let active = true
    ;(async () => {
      try {
        setLoading(true)
        const [m, catRes] = await Promise.all([
          getOrCreateMonth(user.id, year, month),
          supabase.from('categories').select('id, name').order('sort_order'),
        ])
        if (!active) return
        if (catRes.error) throw catRes.error
        setMonthId(m.id)
        const cats = (catRes.data ?? []) as Category[]
        setCategories(cats)
        setCategoryId((prev) => prev || (cats[0]?.id ?? ''))
        const { data, error } = await supabase
          .from('expenses')
          .select('id, amount, date, description, category_id')
          .eq('month_id', m.id)
          .order('date', { ascending: false })
        if (error) throw error
        if (active) setItems(data ?? [])
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

  const catName = (id: string | null) =>
    categories.find((c) => c.id === id)?.name ?? '—'

  const total = items.reduce((s, i) => s + Number(i.amount), 0)

  const addExpense = async (e: FormEvent) => {
    e.preventDefault()
    if (!user || !monthId) return
    const value = Number(amount)
    if (!value || value <= 0) {
      setError('Введите сумму больше нуля')
      return
    }
    setBusy(true)
    setError(null)
    const { data, error } = await supabase
      .from('expenses')
      .insert({
        user_id: user.id,
        month_id: monthId,
        category_id: categoryId || null,
        amount: value,
        date,
        description: description || null,
      })
      .select('id, amount, date, description, category_id')
      .single()
    setBusy(false)
    if (error || !data) {
      setError(error?.message ?? 'Не удалось сохранить')
      return
    }
    setItems([data, ...items])
    setAmount('')
    setDescription('')
  }

  const removeExpense = async (id: string) => {
    const { error } = await supabase.from('expenses').delete().eq('id', id)
    if (error) {
      setError(error.message)
      return
    }
    setItems(items.filter((i) => i.id !== id))
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">🧾 Расходы</h1>
        <span className="text-sm text-neutral-500 dark:text-neutral-400">
          {MONTH_NAMES[month - 1]} · итого:{' '}
          <b className="text-red-500 dark:text-red-400">{formatSum(total)}</b>
        </span>
      </div>

      <form
        onSubmit={addExpense}
        className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50"
      >
        <div className="grid grid-cols-2 gap-3">
          <input
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Сумма"
            className={inputCls}
          />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputCls}
          />
        </div>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className={inputCls}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Описание (необязательно)"
          className={inputCls}
        />
        {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-emerald-500 px-4 py-2.5 font-medium text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-60"
        >
          {busy ? 'Сохранение…' : 'Добавить расход'}
        </button>
      </form>

      {loading ? (
        <p className="text-neutral-500 dark:text-neutral-400">Загрузка…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-neutral-500">Пока нет расходов за этот месяц.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((i) => (
            <div
              key={i.id}
              className="flex items-center justify-between rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900/40"
            >
              <div>
                <p className="font-medium">{formatSum(Number(i.amount))}</p>
                <p className="text-xs text-neutral-500">
                  {catName(i.category_id)} · {i.date}
                  {i.description ? ` · ${i.description}` : ''}
                </p>
              </div>
              <button
                onClick={() => removeExpense(i.id)}
                className="text-sm text-neutral-500 transition hover:text-red-500 dark:hover:text-red-400"
              >
                Удалить
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
