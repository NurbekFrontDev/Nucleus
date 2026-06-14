import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import Combobox from '../components/Combobox'
import Select from '../components/Select'
import DatePicker from '../components/DatePicker'
import PeriodFilter, { type PeriodValue } from '../components/PeriodFilter'
import {
  getOrCreateMonth,
  formatSum,
  formatAmountInput,
  parseAmount,
  SUBCATEGORY_PRESETS,
  formatDateHuman,
  loadCurrencies,
  rateOf,
  BASE_CURRENCY,
  type Currency,
} from '../lib/db'

type Category = { id: string; name: string }
type Expense = {
  id: string
  amount: number
  date: string
  description: string | null
  category_id: string | null
  subcategory: string | null
  currency: string | null
  original_amount: number | null
  created_at: string
}

const EXPENSE_COLS =
  'id, amount, date, description, category_id, subcategory, currency, original_amount, created_at'

const inputCls =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950'

// В списке показываем только валюту (курс — серой строкой ниже).
const curLabel = (c: Currency) =>
  c.code === BASE_CURRENCY ? 'Сум (UZS)' : `${c.code}${c.symbol ? ' ' + c.symbol : ''}`

const chipCls = (active: boolean) =>
  `rounded-full border px-3 py-1 text-xs transition ${
    active
      ? 'border-emerald-500 bg-emerald-500 font-medium text-neutral-950'
      : 'border-neutral-300 text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800'
  }`

export default function Expenses() {
  const { user } = useAuth()
  const todayISO = new Date().toISOString().slice(0, 10)

  const [period, setPeriod] = useState<PeriodValue | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [items, setItems] = useState<Expense[]>([])
  const [currencies, setCurrencies] = useState<Currency[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortOrder, setSortOrder] = useState<'new' | 'old'>('new')

  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayISO)
  const [categoryId, setCategoryId] = useState('')
  const [currency, setCurrency] = useState(BASE_CURRENCY)
  const [subcategory, setSubcategory] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  const [editId, setEditId] = useState<string | null>(null)
  const [editAmount, setEditAmount] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editCategoryId, setEditCategoryId] = useState('')
  const [editCurrency, setEditCurrency] = useState(BASE_CURRENCY)
  const [editSubcategory, setEditSubcategory] = useState('')
  const [editDescription, setEditDescription] = useState('')

  // Категории и валюты грузим один раз.
  useEffect(() => {
    if (!user) return
    let active = true
    ;(async () => {
      const [catRes, curList] = await Promise.all([
        supabase.from('categories').select('id, name').order('sort_order'),
        loadCurrencies(user.id),
      ])
      if (!active) return
      if (curList) setCurrencies(curList)
      const cats = (catRes.data ?? []) as Category[]
      setCategories(cats)
      setCategoryId((prev) => prev || (cats[0]?.id ?? ''))
    })()
    return () => {
      active = false
    }
  }, [user])

  // Записи грузим по диапазону дат выбранного периода.
  useEffect(() => {
    if (!user || !period) return
    let active = true
    ;(async () => {
      try {
        setLoading(true)
        const { data, error } = await supabase
          .from('expenses')
          .select(EXPENSE_COLS)
          .eq('user_id', user.id)
          .gte('date', period.start)
          .lte('date', period.end)
          .order('date', { ascending: false })
        if (error) throw error
        if (active) setItems((data ?? []) as Expense[])
      } catch (e) {
        if (active) setError((e as Error).message)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [user, period?.start, period?.end])

  const catName = (id: string | null) =>
    categories.find((c) => c.id === id)?.name ?? '—'

  const total = items.reduce((s, i) => s + Number(i.amount), 0)

  const currencyOptions = currencies.map((c) => ({ value: c.code, label: curLabel(c) }))
  const categoryOptions = categories.map((c) => ({ value: c.id, label: c.name }))

  const sortedItems = [...items].sort((a, b) => {
    const cmp =
      a.date < b.date
        ? -1
        : a.date > b.date
          ? 1
          : (a.created_at ?? '') < (b.created_at ?? '')
            ? -1
            : (a.created_at ?? '') > (b.created_at ?? '')
              ? 1
              : 0
    return sortOrder === 'new' ? -cmp : cmp
  })

  const subOptions = (catId: string): string[] => {
    const name = categories.find((c) => c.id === catId)?.name ?? ''
    const presets = SUBCATEGORY_PRESETS[name] ?? []
    const used = items
      .filter((e) => e.category_id === catId)
      .map((e) => e.subcategory)
      .filter((s): s is string => !!s)
    return Array.from(new Set([...used, ...presets]))
  }

  const inPeriod = (d: string) => !period || (d >= period.start && d <= period.end)

  const addExpense = async (e: FormEvent) => {
    e.preventDefault()
    if (!user) return
    const original = parseAmount(amount)
    if (!original || original <= 0) {
      setError('Введите сумму больше нуля')
      return
    }
    const base = Math.round(original * rateOf(currencies, currency))
    setBusy(true)
    setError(null)
    const d = new Date(date + 'T00:00:00')
    const m = await getOrCreateMonth(user.id, d.getFullYear(), d.getMonth() + 1)
    const { data, error } = await supabase
      .from('expenses')
      .insert({
        user_id: user.id,
        month_id: m.id,
        category_id: categoryId || null,
        subcategory: subcategory || null,
        amount: base,
        original_amount: original,
        currency,
        date,
        description: description || null,
      })
      .select(EXPENSE_COLS)
      .single()
    setBusy(false)
    if (error || !data) {
      setError(error?.message ?? 'Не удалось сохранить')
      return
    }
    if (inPeriod((data as Expense).date)) setItems([data as Expense, ...items])
    setAmount('')
    setSubcategory('')
    setDescription('')
  }

  const startEdit = (i: Expense) => {
    setEditId(i.id)
    setEditAmount(formatAmountInput(String(i.original_amount ?? i.amount)))
    setEditDate(i.date)
    setEditCategoryId(i.category_id ?? '')
    setEditCurrency(i.currency ?? BASE_CURRENCY)
    setEditSubcategory(i.subcategory ?? '')
    setEditDescription(i.description ?? '')
    setError(null)
  }

  const saveEdit = async (id: string) => {
    const original = parseAmount(editAmount)
    if (!original || original <= 0) {
      setError('Введите сумму больше нуля')
      return
    }
    const base = Math.round(original * rateOf(currencies, editCurrency))
    const { data, error } = await supabase
      .from('expenses')
      .update({
        amount: base,
        original_amount: original,
        currency: editCurrency,
        date: editDate,
        category_id: editCategoryId || null,
        subcategory: editSubcategory || null,
        description: editDescription || null,
      })
      .eq('id', id)
      .select(EXPENSE_COLS)
      .single()
    if (error || !data) {
      setError(error?.message ?? 'Не удалось изменить')
      return
    }
    if (inPeriod((data as Expense).date)) {
      setItems(items.map((i) => (i.id === id ? (data as Expense) : i)))
    } else {
      setItems(items.filter((i) => i.id !== id))
    }
    setEditId(null)
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
          Итого:{' '}
          <b className="text-red-500 dark:text-red-400">{formatSum(total)}</b>
        </span>
      </div>

      <PeriodFilter onChange={setPeriod} />

      <form
        onSubmit={addExpense}
        className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(formatAmountInput(e.target.value))}
            placeholder="Сумма"
            className={inputCls}
          />
          <Select value={currency} onChange={setCurrency} options={currencyOptions} />
        </div>
        {currency !== BASE_CURRENCY && (
          <p className="text-xs text-neutral-500">
            Курс: 1 {currency} ≈ {formatSum(rateOf(currencies, currency))}
          </p>
        )}
        <DatePicker value={date} onChange={setDate} />
        <Select
          value={categoryId}
          onChange={setCategoryId}
          options={categoryOptions}
          placeholder="Категория"
        />
        <Combobox
          value={subcategory}
          onChange={setSubcategory}
          options={subOptions(categoryId)}
          placeholder="Подкатегория (напр. Интернет)"
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Описание (необязательно)"
          className={inputCls}
        />
        {currency !== BASE_CURRENCY && amount && (
          <p className="text-xs text-neutral-500">
            ≈ {formatSum(parseAmount(amount) * rateOf(currencies, currency))} (по курсу)
          </p>
        )}
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
        <p className="text-sm text-neutral-500">За этот период расходов нет.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-500">Сортировка:</span>
            <button type="button" onClick={() => setSortOrder('new')} className={chipCls(sortOrder === 'new')}>
              Сначала новые
            </button>
            <button type="button" onClick={() => setSortOrder('old')} className={chipCls(sortOrder === 'old')}>
              Сначала старые
            </button>
          </div>
          {sortedItems.map((i) =>
            editId === i.id ? (
              <div
                key={i.id}
                className="flex flex-col gap-3 rounded-xl border border-emerald-500/40 bg-neutral-50 px-4 py-3 dark:bg-neutral-900/40"
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <input
                    inputMode="numeric"
                    value={editAmount}
                    onChange={(e) => setEditAmount(formatAmountInput(e.target.value))}
                    placeholder="Сумма"
                    className={inputCls}
                  />
                  <Select value={editCurrency} onChange={setEditCurrency} options={currencyOptions} />
                </div>
                <DatePicker value={editDate} onChange={setEditDate} />
                <Select
                  value={editCategoryId}
                  onChange={setEditCategoryId}
                  options={categoryOptions}
                  placeholder="Категория"
                />
                <Combobox
                  value={editSubcategory}
                  onChange={setEditSubcategory}
                  options={subOptions(editCategoryId)}
                  placeholder="Подкатегория"
                />
                <input
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Описание"
                  className={inputCls}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => saveEdit(i.id)}
                    className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950 transition hover:bg-emerald-400"
                  >
                    Сохранить
                  </button>
                  <button
                    onClick={() => setEditId(null)}
                    className="rounded-lg border border-neutral-300 px-4 py-2 text-sm transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                  >
                    Отмена
                  </button>
                </div>
              </div>
            ) : (
              <div
                key={i.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900/40"
              >
                <div className="min-w-0">
                  <p className="font-medium">{formatSum(Number(i.amount))}</p>
                  <p className="text-xs text-neutral-500">
                    {catName(i.category_id)}
                    {i.subcategory ? ` · ${i.subcategory}` : ''} · {formatDateHuman(i.date)}
                    {i.currency && i.currency !== BASE_CURRENCY && i.original_amount
                      ? ` · ${formatAmountInput(String(i.original_amount))} ${i.currency}`
                      : ''}
                    {i.description ? ` · ${i.description}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 gap-3 text-sm">
                  <button
                    onClick={() => startEdit(i)}
                    className="text-neutral-500 transition hover:text-emerald-600 dark:hover:text-emerald-400"
                  >
                    Изменить
                  </button>
                  <button
                    onClick={() => removeExpense(i.id)}
                    className="text-neutral-500 transition hover:text-red-500 dark:hover:text-red-400"
                  >
                    Удалить
                  </button>
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  )
}
