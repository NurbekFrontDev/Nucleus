import { Fragment, useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import Combobox from '../components/Combobox'
import Select from '../components/Select'
import DatePicker from '../components/DatePicker'
import PeriodFilter, { type PeriodValue } from '../components/PeriodFilter'
import { useLang } from '../lib/i18n'
import {
  getOrCreateMonth,
  formatSum,
  formatAmountInput,
  parseAmount,
  monthName,
  SUBCATEGORY_PRESETS,
  effectivePresets,
  renamePreset,
  deletePreset,
  formatDateHuman,
  loadCurrencies,
  rateOf,
  BASE_CURRENCY,
  type Currency,
} from '../lib/db'

type Category = { id: string; name: string; archived?: boolean }
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

const chipCls = (active: boolean) =>
  `rounded-full border px-3 py-1 text-xs transition ${
    active
      ? 'border-emerald-500 bg-emerald-500 font-medium text-neutral-950'
      : 'border-neutral-300 text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800'
  }`

export default function Expenses() {
  const { user } = useAuth()
  const { t, tr } = useLang()
  const todayISO = new Date().toISOString().slice(0, 10)

  // В списке показываем только валюту (курс — серой строкой ниже).
  const curLabel = (c: Currency) =>
    c.code === BASE_CURRENCY ? `${tr('Сум')} (UZS)` : `${c.code}${c.symbol ? ' ' + c.symbol : ''}`

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
        supabase.from('categories').select('id, name, archived').order('sort_order'),
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

  const catName = (id: string | null) => {
    const c = categories.find((x) => x.id === id)
    if (!c) return '—'
    return c.archived ? `${tr(c.name)} ${t('exp.deleted')}` : tr(c.name)
  }

  const total = items.reduce((s, i) => s + Number(i.amount), 0)

  const currencyOptions = currencies.map((c) => ({ value: c.code, label: curLabel(c) }))
  const categoryOptions = categories.filter((c) => !c.archived).map((c) => ({ value: c.id, label: tr(c.name) }))

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
    const presets = effectivePresets('sub:' + name, SUBCATEGORY_PRESETS[name] ?? [])
    const used = items
      .filter((e) => e.category_id === catId)
      .map((e) => e.subcategory)
      .filter((s): s is string => !!s)
    return Array.from(new Set([...used, ...presets]))
  }

  // Переименовать подкатегорию: меняем подсказку (в рамках категории) и все записи.
  const renameSub = async (catId: string, oldV: string, newV: string) => {
    const v = newV.trim()
    if (!user || !v || v === oldV) return
    const name = categories.find((c) => c.id === catId)?.name ?? ''
    renamePreset('sub:' + name, SUBCATEGORY_PRESETS[name] ?? [], oldV, v)
    await supabase
      .from('expenses')
      .update({ subcategory: v })
      .eq('user_id', user.id)
      .eq('category_id', catId)
      .eq('subcategory', oldV)
    setItems((prev) =>
      prev.map((i) =>
        i.category_id === catId && i.subcategory === oldV ? { ...i, subcategory: v } : i,
      ),
    )
    if (subcategory === oldV) setSubcategory(v)
    if (editSubcategory === oldV) setEditSubcategory(v)
  }

  // Удалить подкатегорию: убираем подсказку и очищаем её у записей (суммы остаются).
  const deleteSub = async (catId: string, v: string) => {
    if (!user) return
    const name = categories.find((c) => c.id === catId)?.name ?? ''
    deletePreset('sub:' + name, SUBCATEGORY_PRESETS[name] ?? [], v)
    await supabase
      .from('expenses')
      .update({ subcategory: null })
      .eq('user_id', user.id)
      .eq('category_id', catId)
      .eq('subcategory', v)
    setItems((prev) =>
      prev.map((i) =>
        i.category_id === catId && i.subcategory === v ? { ...i, subcategory: null } : i,
      ),
    )
    if (subcategory === v) setSubcategory('')
    if (editSubcategory === v) setEditSubcategory('')
  }

  const inPeriod = (d: string) => !period || (d >= period.start && d <= period.end)

  const addExpense = async (e: FormEvent) => {
    e.preventDefault()
    if (!user) return
    const original = parseAmount(amount)
    if (!original || original <= 0) {
      setError(t('common.enterPositive'))
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
      setError(error?.message ?? t('common.saveFailed'))
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
      setError(t('common.enterPositive'))
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
      setError(error?.message ?? t('common.editFailed'))
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
        <h1 className="text-2xl font-semibold">🧾 {t('exp.title')}</h1>
        <span className="text-sm text-neutral-500 dark:text-neutral-400">
          {t('inc.total')}:{' '}
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
            placeholder={t('common.amount')}
            className={inputCls}
          />
          <Select value={currency} onChange={setCurrency} options={currencyOptions} />
        </div>
        {currency !== BASE_CURRENCY && (
          <p className="text-xs text-neutral-500">
            {t('inc.rate', { c: currency, v: formatSum(rateOf(currencies, currency)) })}
          </p>
        )}
        <DatePicker value={date} onChange={setDate} />
        <Select
          value={categoryId}
          onChange={setCategoryId}
          options={categoryOptions}
          placeholder={t('common.category')}
        />
        <Combobox
          value={subcategory}
          onChange={setSubcategory}
          options={subOptions(categoryId)}
          placeholder={t('exp.sub')}
          onRenameOption={(o, n) => renameSub(categoryId, o, n)}
          onDeleteOption={(o) => deleteSub(categoryId, o)}
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('common.descOptional')}
          className={inputCls}
        />
        {currency !== BASE_CURRENCY && amount && (
          <p className="text-xs text-neutral-500">
            {t('inc.convApprox', { v: formatSum(parseAmount(amount) * rateOf(currencies, currency)), by: t('common.byRate') })}
          </p>
        )}
        {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-emerald-500 px-4 py-2.5 font-medium text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-60"
        >
          {busy ? t('common.saving') : t('exp.addBtn')}
        </button>
      </form>

      {loading ? (
        <p className="text-neutral-500 dark:text-neutral-400">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-neutral-500">{t('exp.empty')}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-500">{t('common.sort')}:</span>
            <button type="button" onClick={() => setSortOrder('new')} className={chipCls(sortOrder === 'new')}>
              {t('common.sortNew')}
            </button>
            <button type="button" onClick={() => setSortOrder('old')} className={chipCls(sortOrder === 'old')}>
              {t('common.sortOld')}
            </button>
          </div>
          {sortedItems.map((i, idx) => {
            const showMonthHeader =
              period?.groupByMonth &&
              (idx === 0 || sortedItems[idx - 1].date.slice(0, 7) !== i.date.slice(0, 7))
            const dd = new Date(i.date + 'T00:00:00')
            const row =
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
                    placeholder={t('common.amount')}
                    className={inputCls}
                  />
                  <Select value={editCurrency} onChange={setEditCurrency} options={currencyOptions} />
                </div>
                <DatePicker value={editDate} onChange={setEditDate} />
                <Select
                  value={editCategoryId}
                  onChange={setEditCategoryId}
                  options={categoryOptions}
                  placeholder={t('common.category')}
                />
                <Combobox
                  value={editSubcategory}
                  onChange={setEditSubcategory}
                  options={subOptions(editCategoryId)}
                  placeholder={t('exp.subShort')}
                  onRenameOption={(o, n) => renameSub(editCategoryId, o, n)}
                  onDeleteOption={(o) => deleteSub(editCategoryId, o)}
                />
                <input
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder={t('common.desc')}
                  className={inputCls}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => saveEdit(i.id)}
                    className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950 transition hover:bg-emerald-400"
                  >
                    {t('common.save')}
                  </button>
                  <button
                    onClick={() => setEditId(null)}
                    className="rounded-lg border border-neutral-300 px-4 py-2 text-sm transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                  >
                    {t('common.cancel')}
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
                    {i.subcategory ? ` · ${tr(i.subcategory)}` : ''} · {formatDateHuman(i.date)}
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
                    {t('common.edit')}
                  </button>
                  <button
                    onClick={() => removeExpense(i.id)}
                    className="text-red-500 transition hover:text-red-600 dark:text-red-400 dark:hover:text-red-300"
                  >
                    {t('common.delete')}
                  </button>
                </div>
              </div>
              )
            return (
              <Fragment key={i.id}>
                {showMonthHeader && (
                  <div className="mt-3 flex items-center gap-3 first:mt-0">
                    <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                      {monthName(dd.getMonth())} {dd.getFullYear()}
                    </span>
                    <hr className="flex-1 border-neutral-200 dark:border-neutral-800" />
                  </div>
                )}
                {row}
              </Fragment>
            )
          })}
        </div>
      )}
    </div>
  )
}
