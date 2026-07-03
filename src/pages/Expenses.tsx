import { Fragment, useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import Combobox from '../components/Combobox'
import Select from '../components/Select'
import DatePicker from '../components/DatePicker'
import PeriodFilter, { type PeriodValue } from '../components/PeriodFilter'
import IconButton from '../components/IconButton'
import AmountInput from '../components/AmountInput'
import { useUsdRates, type EntryCurrency } from '../lib/rates'
import { loadLastCurrency, saveLastCurrency } from '../lib/lastCurrency'
import Debts from './Debts'
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
  isSavingsCategory,
  isCharityCategory,
} from '../lib/db'
import { readCache, writeCache } from '../lib/offlineCache'

type Category = { id: string; name: string; archived?: boolean }
type Expense = {
  id: string
  amount: number
  date: string
  description: string | null
  category_id: string | null
  subcategory: string | null
  paid_from_pot: 'cushion' | 'free' | 'charity' | 'goals' | null
  created_at: string
}

const EXPENSE_COLS =
  'id, amount, date, description, category_id, subcategory, paid_from_pot, created_at'

const inputCls =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950'

const chipCls = (active: boolean) =>
  `rounded-full border px-3 py-1 text-xs transition ${
    active
      ? 'border-emerald-500 bg-emerald-500 font-medium text-neutral-950'
      : 'border-neutral-300 text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800'
  }`

const tabCls = (active: boolean) =>
  `rounded-lg px-4 py-1.5 text-sm font-medium transition ${
    active
      ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100'
      : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200'
  }`

export default function Expenses() {
  const { user } = useAuth()
  const { t, tr } = useLang()
  const { toUsd } = useUsdRates()
  const todayISO = new Date().toISOString().slice(0, 10)

  const [view, setView] = useState<'expenses' | 'debts'>('expenses')
  const [period, setPeriod] = useState<PeriodValue | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [items, setItems] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortOrder, setSortOrder] = useState<'new' | 'old'>('new')
  const [filterCat, setFilterCat] = useState('')

  const [amount, setAmount] = useState('')
  // Валюта по умолчанию — последняя выбранная пользователем.
  const [currency, setCurrency] = useState<EntryCurrency>(() => loadLastCurrency())
  const [date, setDate] = useState(todayISO)
  const [categoryId, setCategoryId] = useState('')
  const [subcategory, setSubcategory] = useState('')
  const [description, setDescription] = useState('')
  const [fromPot, setFromPot] = useState<'' | 'cushion' | 'free' | 'charity'>('')
  const [busy, setBusy] = useState(false)
  // Форма добавления по умолчанию свёрнута; раскрывается по нажатию.
  const [formOpen, setFormOpen] = useState(false)

  const [editId, setEditId] = useState<string | null>(null)
  const [editAmount, setEditAmount] = useState('')
  const [editCurrency, setEditCurrency] = useState<EntryCurrency>('USD')
  const [editDate, setEditDate] = useState('')
  const [editCategoryId, setEditCategoryId] = useState('')
  const [editSubcategory, setEditSubcategory] = useState('')
  const [editDescription, setEditDescription] = useState('')
  // 'goals' ставится автоматически (покупка цели из вкладов) и не выбирается вручную,
  // но входит в тип, чтобы правка такого расхода не ломала сборку и сохраняла пометку.
  const [editFromPot, setEditFromPot] = useState<'' | 'cushion' | 'free' | 'charity' | 'goals'>('')

  // Категории грузим один раз.
  useEffect(() => {
    if (!user) return
    let active = true
    // Мгновенно показываем категории из кэша (без интернета), сеть обновляет в фоне.
    const catCk = `expcats:${user.id}`
    const cachedCats = readCache<Category[]>(catCk)
    if (cachedCats) {
      setCategories(cachedCats)
      setCategoryId((prev) => prev || (cachedCats[0]?.id ?? ''))
    }
    ;(async () => {
      const catRes = await supabase
        .from('categories')
        .select('id, name, archived')
        .order('sort_order')
      if (!active) return
      const cats = (catRes.data ?? []) as Category[]
      setCategories(cats)
      setCategoryId((prev) => prev || (cats[0]?.id ?? ''))
      writeCache(catCk, cats)
    })()
    return () => {
      active = false
    }
  }, [user])

  // Записи грузим по диапазону дат выбранного периода.
  useEffect(() => {
    if (!user || !period) return
    let active = true
    // Мгновенно показываем кэш (без спиннера и без интернета), сеть обновляет в фоне.
    const ck = `exp:${user.id}:${period.start}:${period.end}`
    const cached = readCache<Expense[]>(ck)
    if (cached) {
      setItems(cached)
      setLoading(false)
    } else {
      setLoading(true)
    }
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('expenses')
          .select(EXPENSE_COLS)
          .eq('user_id', user.id)
          .gte('date', period.start)
          .lte('date', period.end)
          .order('date', { ascending: false })
        if (error) throw error
        if (active) {
          setItems((data ?? []) as Expense[])
          writeCache(ck, (data ?? []) as Expense[])
        }
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

  // Если выбранной в фильтре категории нет среди расходов текущего периода — сбрасываем на «Все».
  useEffect(() => {
    if (filterCat && !items.some((i) => i.category_id === filterCat)) setFilterCat('')
  }, [items, filterCat])

  const catName = (id: string | null) => {
    const c = categories.find((x) => x.id === id)
    if (!c) return '—'
    return c.archived ? `${tr(c.name)} ${t('exp.deleted')}` : tr(c.name)
  }

  // «В копилки» — чистый поток денег в копилки за период (пополнения − снятия),
  // как и баланс копилок на дашборде. Пополнение копилки (Сбережения/Инвестиции/
  // Благотворительность без paid_from_pot) прибавляет; снятие/пожертвование из любой
  // копилки (paid_from_pot) вычитает. Поэтому «положил 3, отдал 3» даёт 0.
  const toSavings = items.reduce((s, i) => {
    // Снятие из копилок подушки/накоплений/благотворительности уменьшает «В копилки».
    // Покупка цели (paid_from_pot = 'goals') берётся из вкладов в цель, а не из этих
    // копилок, поэтому на «В копилки» не влияет.
    if (i.paid_from_pot && i.paid_from_pot !== 'goals') return s - Number(i.amount)
    const n = categories.find((c) => c.id === i.category_id)?.name
    if (isSavingsCategory(n) || isCharityCategory(n)) return s + Number(i.amount)
    return s
  }, 0)
  // «Расходы» — реальные траты на жизнь. Накопления и благотворительность
  // исключаем целиком, чтобы совпадало с карточкой «Расходы» на дашборде.
  const realTotal = items
    .filter((i) => {
      // Траты из копилок (paid_from_pot) — снятие ранее отложенных денег, а не расход
      // дохода этого месяца, поэтому в «Расходах» их не считаем (как и на дашборде).
      if (i.paid_from_pot) return false
      const n = categories.find((c) => c.id === i.category_id)?.name
      return !isSavingsCategory(n) && !isCharityCategory(n)
    })
    .reduce((s, i) => s + Number(i.amount), 0)

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

  // Фильтр по категории (чипы). Пустая строка = все категории.
  const shownItems = filterCat ? sortedItems.filter((i) => i.category_id === filterCat) : sortedItems

  // В фильтре показываем только те категории, по которым есть расходы в текущем периоде.
  const usedCategoryIds = new Set(
    items.map((i) => i.category_id).filter((id): id is string => !!id),
  )
  const filterCategoryOptions = categoryOptions.filter((c) => usedCategoryIds.has(c.value))

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
    const entered = parseAmount(amount)
    const original = Math.round(toUsd(entered, currency) * 100) / 100
    if (!original || original <= 0) {
      setError(t('common.enterPositive'))
      return
    }
    setBusy(true)
    setError(null)
    const d = new Date(date + 'T00:00:00')
    const m = await getOrCreateMonth(user.id, d.getFullYear(), d.getMonth() + 1)
    const selCatName = categories.find((c) => c.id === categoryId)?.name
    const pot = isSavingsCategory(selCatName) ? null : fromPot || null
    const { data, error } = await supabase
      .from('expenses')
      .insert({
        user_id: user.id,
        month_id: m.id,
        category_id: categoryId || null,
        subcategory: subcategory || null,
        amount: original,
        date,
        description: description || null,
        paid_from_pot: pot,
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
    setCurrency(loadLastCurrency())
    setSubcategory('')
    setDescription('')
    setFromPot('')
  }

  const startEdit = (i: Expense) => {
    setEditId(i.id)
    setEditAmount(formatAmountInput(String(i.amount)))
    setEditCurrency('USD')
    setEditDate(i.date)
    setEditCategoryId(i.category_id ?? '')
    setEditSubcategory(i.subcategory ?? '')
    setEditDescription(i.description ?? '')
    setEditFromPot(i.paid_from_pot ?? '')
    setError(null)
  }

  const saveEdit = async (id: string) => {
    const entered = parseAmount(editAmount)
    const original = Math.round(toUsd(entered, editCurrency) * 100) / 100
    if (!original || original <= 0) {
      setError(t('common.enterPositive'))
      return
    }
    const selCatName = categories.find((c) => c.id === editCategoryId)?.name
    const pot = isSavingsCategory(selCatName) ? null : editFromPot || null
    const { data, error } = await supabase
      .from('expenses')
      .update({
        amount: original,
        date: editDate,
        category_id: editCategoryId || null,
        subcategory: editSubcategory || null,
        description: editDescription || null,
        paid_from_pot: pot,
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
      <div className="sticky top-0 z-20 -mx-4 flex flex-col gap-3 border-b border-neutral-200/70 bg-white/85 px-4 py-3 backdrop-blur dark:border-neutral-800/70 dark:bg-neutral-950/85">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="inline-flex self-start rounded-xl border border-neutral-200 bg-neutral-100 p-1 dark:border-neutral-800 dark:bg-neutral-900/50">
            <button type="button" onClick={() => setView('expenses')} className={tabCls(view === 'expenses')}>
              🧾 {t('exp.title')}
            </button>
            <button type="button" onClick={() => setView('debts')} className={tabCls(view === 'debts')}>
              💳 {t('debts.title')}
            </button>
          </div>
          {view === 'expenses' && (
            <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
              <span className="text-sm text-neutral-500 dark:text-neutral-400">
                {t('exp.totalSpent')}{' '}
                <b className="text-red-500 dark:text-red-400">{formatSum(realTotal)}</b>
              </span>
              {toSavings > 0 && (
                <span className="text-sm text-neutral-500 dark:text-neutral-400">
                  {t('exp.totalToPots')}{' '}
                  <b className="text-emerald-600 dark:text-emerald-400">{formatSum(toSavings)}</b>
                </span>
              )}
            </div>
          )}
        </div>
        {view === 'expenses' && <PeriodFilter onChange={setPeriod} />}
      </div>

      {view === 'debts' ? (
        <Debts embedded />
      ) : (
        <>
          {!formOpen ? (
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              className="flex w-full items-center justify-between rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm font-medium transition hover:border-emerald-400 dark:border-neutral-800 dark:bg-neutral-900/50 dark:hover:border-emerald-600"
            >
              <span>＋ {t('exp.addBtn')}</span>
              <span className="text-neutral-400">▾</span>
            </button>
          ) : (
          <form
            onSubmit={addExpense}
            className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50"
          >
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="flex items-center justify-between text-sm font-medium text-neutral-500 transition hover:text-neutral-800 dark:hover:text-neutral-200"
            >
              <span>＋ {t('exp.addBtn')}</span>
              <span className="text-neutral-400">▴</span>
            </button>
            <AmountInput
              value={amount}
              currency={currency}
              onValueChange={setAmount}
              onCurrencyChange={(c) => {
                setCurrency(c)
                saveLastCurrency(c)
              }}
              placeholder={t('common.amount')}
              usdHint={
                currency !== 'USD' && parseAmount(amount) > 0
                  ? `≈ ${formatSum(toUsd(parseAmount(amount), currency))}`
                  : null
              }
            />
            <DatePicker value={date} onChange={setDate} />
            <Select
              value={categoryId}
              onChange={(v) => {
                setCategoryId(v)
                setFromPot('')
              }}
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
            {isCharityCategory(categories.find((c) => c.id === categoryId)?.name) ? (
              <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-700">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={fromPot === 'charity'}
                    onChange={(e) => setFromPot(e.target.checked ? 'charity' : '')}
                    className="h-4 w-4 accent-rose-500"
                  />
                  {t('exp.donate')}
                </label>
              </div>
            ) : !isSavingsCategory(categories.find((c) => c.id === categoryId)?.name) ? (
              <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-700">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={fromPot !== ''}
                    onChange={(e) => setFromPot(e.target.checked ? 'free' : '')}
                    className="h-4 w-4 accent-emerald-500"
                  />
                  {t('exp.fromPot')}
                </label>
                {fromPot !== '' && (
                  <>
                    <Select
                      value={fromPot}
                      onChange={(v) => setFromPot(v as 'cushion' | 'free')}
                      options={[
                        { value: 'free', label: t('savings.freeTitle') },
                        { value: 'cushion', label: t('cushion.title') },
                      ]}
                    />
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">{t('exp.fromPotHint')}</p>
                  </>
                )}
              </div>
            ) : null}
            {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-emerald-500 px-4 py-2.5 font-medium text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-60"
            >
              {busy ? t('common.saving') : t('exp.addBtn')}
            </button>
          </form>
          )}

          {loading ? (
            <p className="text-neutral-500 dark:text-neutral-400">{t('common.loading')}</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-neutral-500">{t('exp.empty')}</p>
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
              {filterCategoryOptions.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-neutral-500">{t('common.category')}:</span>
                  <button type="button" onClick={() => setFilterCat('')} className={chipCls(filterCat === '')}>
                    {t('common.all')}
                  </button>
                  {filterCategoryOptions.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setFilterCat(c.value)}
                      className={chipCls(filterCat === c.value)}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              )}
              {shownItems.length === 0 ? (
                <p className="text-sm text-neutral-500">{t('goals.nothingFound')}</p>
              ) : null}
              {shownItems.map((i, idx) => {
                const showMonthHeader =
                  period?.groupByMonth &&
                  (idx === 0 || shownItems[idx - 1].date.slice(0, 7) !== i.date.slice(0, 7))
                const dd = new Date(i.date + 'T00:00:00')
                const row =
                  editId === i.id ? (
                  <div
                    key={i.id}
                    className="flex flex-col gap-3 rounded-xl border border-emerald-500/40 bg-neutral-50 px-4 py-3 dark:bg-neutral-900/40"
                  >
                    <AmountInput
                      value={editAmount}
                      currency={editCurrency}
                      onValueChange={setEditAmount}
                      onCurrencyChange={setEditCurrency}
                      placeholder={t('common.amount')}
                      usdHint={
                        editCurrency !== 'USD' && parseAmount(editAmount) > 0
                          ? `≈ ${formatSum(toUsd(parseAmount(editAmount), editCurrency))}`
                          : null
                      }
                    />
                    <DatePicker value={editDate} onChange={setEditDate} />
                    <Select
                      value={editCategoryId}
                      onChange={(v) => {
                        setEditCategoryId(v)
                        setEditFromPot('')
                      }}
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
                    {isCharityCategory(categories.find((c) => c.id === editCategoryId)?.name) ? (
                      <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-700">
                        <label className="flex cursor-pointer items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={editFromPot === 'charity'}
                            onChange={(e) => setEditFromPot(e.target.checked ? 'charity' : '')}
                            className="h-4 w-4 accent-rose-500"
                          />
                          {t('exp.donate')}
                        </label>
                      </div>
                    ) : !isSavingsCategory(categories.find((c) => c.id === editCategoryId)?.name) ? (
                      <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-700">
                        <label className="flex cursor-pointer items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={editFromPot !== ''}
                            onChange={(e) => setEditFromPot(e.target.checked ? 'free' : '')}
                            className="h-4 w-4 accent-emerald-500"
                          />
                          {t('exp.fromPot')}
                        </label>
                        {editFromPot !== '' && (
                          <Select
                            value={editFromPot}
                            onChange={(v) => setEditFromPot(v as 'cushion' | 'free')}
                            options={[
                              { value: 'free', label: t('savings.freeTitle') },
                              { value: 'cushion', label: t('cushion.title') },
                            ]}
                          />
                        )}
                      </div>
                    ) : null}
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
                        {i.description ? ` · ${i.description}` : ''}
                        {i.paid_from_pot ? ` · ${i.paid_from_pot === 'cushion' ? t('exp.fromCushion') : i.paid_from_pot === 'charity' ? t('exp.fromCharity') : i.paid_from_pot === 'goals' ? t('exp.fromGoals') : t('exp.fromFree')}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <IconButton icon="edit" title={t('common.edit')} onClick={() => startEdit(i)} />
                      <IconButton icon="delete" title={t('common.delete')} onClick={() => removeExpense(i.id)} />
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
        </>
      )}
    </div>
  )
}
