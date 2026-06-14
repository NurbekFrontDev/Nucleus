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
  formatDateHuman,
  formatAmountInput,
  parseAmount,
  INCOME_SOURCE_PRESETS,
  loadCurrencies,
  rateOf,
  BASE_CURRENCY,
  type Currency,
} from '../lib/db'

type Income = {
  id: string
  amount: number
  date: string
  description: string | null
  source: string | null
  currency: string | null
  original_amount: number | null
  created_at: string
}

const INCOME_COLS = 'id, amount, date, description, source, currency, original_amount, created_at'

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

export default function Incomes() {
  const { user } = useAuth()
  const todayISO = new Date().toISOString().slice(0, 10)

  const [period, setPeriod] = useState<PeriodValue | null>(null)
  const [items, setItems] = useState<Income[]>([])
  const [currencies, setCurrencies] = useState<Currency[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortOrder, setSortOrder] = useState<'new' | 'old'>('new')

  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayISO)
  const [currency, setCurrency] = useState(BASE_CURRENCY)
  const [source, setSource] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  const [editId, setEditId] = useState<string | null>(null)
  const [editAmount, setEditAmount] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editCurrency, setEditCurrency] = useState(BASE_CURRENCY)
  const [editSource, setEditSource] = useState('')
  const [editDescription, setEditDescription] = useState('')

  // Справочник валют грузим один раз.
  useEffect(() => {
    if (!user) return
    loadCurrencies(user.id)
      .then(setCurrencies)
      .catch(() => {})
  }, [user])

  // Записи грузим по диапазону дат выбранного периода.
  useEffect(() => {
    if (!user || !period) return
    let active = true
    ;(async () => {
      try {
        setLoading(true)
        const { data, error } = await supabase
          .from('incomes')
          .select(INCOME_COLS)
          .eq('user_id', user.id)
          .gte('date', period.start)
          .lte('date', period.end)
          .order('date', { ascending: false })
        if (error) throw error
        if (active) setItems((data ?? []) as Income[])
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

  const total = items.reduce((s, i) => s + Number(i.amount), 0)

  const currencyOptions = currencies.map((c) => ({ value: c.code, label: curLabel(c) }))

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

  const usedSources = Array.from(
    new Set(items.map((i) => i.source).filter((s): s is string => !!s)),
  )
  const sourceOptions = Array.from(new Set([...usedSources, ...INCOME_SOURCE_PRESETS]))

  const inPeriod = (d: string) => !period || (d >= period.start && d <= period.end)

  const addIncome = async (e: FormEvent) => {
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
      .from('incomes')
      .insert({
        user_id: user.id,
        month_id: m.id,
        amount: base,
        original_amount: original,
        currency,
        date,
        source: source || null,
        description: description || null,
      })
      .select(INCOME_COLS)
      .single()
    setBusy(false)
    if (error || !data) {
      setError(error?.message ?? 'Не удалось сохранить')
      return
    }
    if (inPeriod((data as Income).date)) setItems([data as Income, ...items])
    setAmount('')
    setSource('')
    setDescription('')
  }

  const startEdit = (i: Income) => {
    setEditId(i.id)
    setEditAmount(formatAmountInput(String(i.original_amount ?? i.amount)))
    setEditDate(i.date)
    setEditCurrency(i.currency ?? BASE_CURRENCY)
    setEditSource(i.source ?? '')
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
      .from('incomes')
      .update({
        amount: base,
        original_amount: original,
        currency: editCurrency,
        date: editDate,
        source: editSource || null,
        description: editDescription || null,
      })
      .eq('id', id)
      .select(INCOME_COLS)
      .single()
    if (error || !data) {
      setError(error?.message ?? 'Не удалось изменить')
      return
    }
    if (inPeriod((data as Income).date)) {
      setItems(items.map((i) => (i.id === id ? (data as Income) : i)))
    } else {
      setItems(items.filter((i) => i.id !== id))
    }
    setEditId(null)
  }

  const removeIncome = async (id: string) => {
    const { error } = await supabase.from('incomes').delete().eq('id', id)
    if (error) {
      setError(error.message)
      return
    }
    setItems(items.filter((i) => i.id !== id))
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">💼 Доходы</h1>
        <span className="text-sm text-neutral-500 dark:text-neutral-400">
          Итого:{' '}
          <b className="text-emerald-600 dark:text-emerald-400">{formatSum(total)}</b>
        </span>
      </div>

      <PeriodFilter onChange={setPeriod} />

      <form
        onSubmit={addIncome}
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
        <Combobox
          value={source}
          onChange={setSource}
          options={sourceOptions}
          placeholder="Источник дохода (напр. Зарплата)"
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
          {busy ? 'Сохранение…' : 'Добавить доход'}
        </button>
      </form>

      {loading ? (
        <p className="text-neutral-500 dark:text-neutral-400">Загрузка…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-neutral-500">За этот период доходов нет.</p>
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
                <Combobox
                  value={editSource}
                  onChange={setEditSource}
                  options={sourceOptions}
                  placeholder="Источник дохода"
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
                    {formatDateHuman(i.date)}
                    {i.currency && i.currency !== BASE_CURRENCY && i.original_amount
                      ? ` · ${formatAmountInput(String(i.original_amount))} ${i.currency}`
                      : ''}
                    {i.source ? ` · ${i.source}` : ''}
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
                    onClick={() => removeIncome(i.id)}
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
