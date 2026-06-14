import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import Select from '../components/Select'
import Combobox from '../components/Combobox'
import DatePicker from '../components/DatePicker'
import { useLang } from '../lib/i18n'
import {
  formatSum,
  formatAmountInput,
  parseAmount,
  monthsUntil,
  formatDateHuman,
  loadCurrencies,
  fetchRate,
  getOrCreateMonth,
  SUBCATEGORY_PRESETS,
  effectivePresets,
  renamePreset,
  deletePreset,
  BASE_CURRENCY,
  WISH_CATEGORIES,
} from '../lib/db'

type Goal = {
  id: string
  name: string
  note: string | null
  target_amount: number
  target_date: string | null
  is_goal: boolean
  done: boolean
  category: string | null
  expense_id: string | null
  created_at: string
}
type Contribution = { id: string; goal_id: string; amount: number; date: string }
type Category = { id: string; name: string; archived?: boolean }

const GOAL_COLS =
  'id, name, note, target_amount, target_date, is_goal, done, category, expense_id, created_at'

// Валюты для ввода цены желания/цели (всё пересчитывается в сум).
const PRICE_CURRENCIES = ['UZS', 'USD', 'RUB'] as const

// Базовый стиль поля без ширины (чтобы не конфликтовало с flex-1 в строках).
const fieldBase =
  'rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950'
const inputCls = 'w-full ' + fieldBase
const btnPrimary =
  'rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-medium text-neutral-950 transition hover:bg-emerald-400'
const btnGhost =
  'rounded-lg border border-neutral-300 px-3 py-1.5 text-sm transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
const btnMuted =
  'text-sm text-red-500 transition hover:text-red-600 dark:text-red-400 dark:hover:text-red-300'
const sectionTitle = 'text-xl font-semibold'

const chipCls = (active: boolean) =>
  `rounded-full border px-3 py-1 text-xs transition ${
    active
      ? 'border-emerald-500 bg-emerald-500 font-medium text-neutral-950'
      : 'border-neutral-300 text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800'
  }`

const catBadgeCls = (c: string | null) => {
  if (c === 'Обязательные') return 'bg-red-500/15 text-red-600 dark:text-red-400'
  if (c === 'Свободные') return 'bg-sky-500/15 text-sky-600 dark:text-sky-400'
  return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
}
const catPriority = (c: string | null) => {
  const idx = WISH_CATEGORIES.indexOf((c ?? '') as never)
  return idx === -1 ? WISH_CATEGORIES.length : idx
}

export default function Goals() {
  const { user } = useAuth()
  const { t, tr } = useLang()
  const priceCurLabel = (c: string) => (c === 'UZS' ? tr('Сум') : c === 'USD' ? 'USD $' : 'RUB ₽')
  const priceCurrencyOptions = PRICE_CURRENCIES.map((c) => ({ value: c, label: priceCurLabel(c) }))
  const wishCategoryOptions = WISH_CATEGORIES.map((c) => ({ value: c, label: tr(c) }))

  const [goals, setGoals] = useState<Goal[]>([])
  const [contribs, setContribs] = useState<Contribution[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rates, setRates] = useState<Record<string, number>>({ UZS: 1 })

  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [priceCurrency, setPriceCurrency] = useState<string>('UZS')
  const [note, setNote] = useState('')
  const [wishCategory, setWishCategory] = useState<string>('Цели и хотелки')
  const [busy, setBusy] = useState(false)

  // Мульти-сортировка: «по важности» можно совмещать с направлением по дате.
  const [byPriority, setByPriority] = useState(true)
  const [dateDir, setDateDir] = useState<'new' | 'old'>('new')

  const [goalFormId, setGoalFormId] = useState<string | null>(null)
  const [goalTarget, setGoalTarget] = useState('')
  const [goalTargetCurrency, setGoalTargetCurrency] = useState<string>('UZS')
  const [goalDate, setGoalDate] = useState('')

  const [contribFormId, setContribFormId] = useState<string | null>(null)
  const [contribAmount, setContribAmount] = useState('')
  const [contribDate, setContribDate] = useState(new Date().toISOString().slice(0, 10))

  const [editContribId, setEditContribId] = useState<string | null>(null)
  const [editContribAmount, setEditContribAmount] = useState('')
  const [editContribDate, setEditContribDate] = useState('')

  // Форма «Куплено → записать в расходы».
  const [buyFormId, setBuyFormId] = useState<string | null>(null)
  const [buyAmount, setBuyAmount] = useState('')
  const [buyCategory, setBuyCategory] = useState<string>('')
  const [buySub, setBuySub] = useState('')
  const [buyDate, setBuyDate] = useState(new Date().toISOString().slice(0, 10))

  useEffect(() => {
    if (!user) return
    let active = true
    ;(async () => {
      try {
        setLoading(true)
        const [gRes, cRes, catRes, curList] = await Promise.all([
          supabase
            .from('goals')
            .select(GOAL_COLS)
            .eq('user_id', user.id)
            .order('created_at', { ascending: false }),
          supabase
            .from('goal_contributions')
            .select('id, goal_id, amount, date')
            .eq('user_id', user.id),
          supabase.from('categories').select('id, name, archived').eq('user_id', user.id).order('sort_order'),
          loadCurrencies(user.id),
        ])
        if (!active) return
        if (gRes.error) throw gRes.error
        if (cRes.error) throw cRes.error
        if (catRes.error) throw catRes.error
        setGoals((gRes.data ?? []) as Goal[])
        setContribs((cRes.data ?? []) as Contribution[])
        setCategories((catRes.data ?? []) as Category[])
        // Курсы для USD/RUB: берём из валют пользователя, иначе подтягиваем автоматически.
        const map: Record<string, number> = { UZS: 1 }
        for (const code of ['USD', 'RUB']) {
          const found = curList.find((c) => c.code === code)
          if (found) map[code] = Number(found.rate_to_base)
          else {
            const r = await fetchRate(code)
            if (r) map[code] = r
          }
        }
        if (active) setRates(map)
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

  const rateFor = (code: string) => rates[code] ?? 1
  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? ''
  const categoryOptions = categories.filter((c) => !c.archived).map((c) => ({ value: c.id, label: tr(c.name) }))
  // Подсказки подкатегорий для выбранной категории (с учётом локальных правок).
  const subOptions = (catId: string) =>
    effectivePresets('sub:' + catName(catId), SUBCATEGORY_PRESETS[catName(catId)] ?? [])

  // Переименовать подкатегорию: меняем подсказку и все записи расходов этой категории.
  const renameSub = async (catId: string, oldV: string, newV: string) => {
    const v = newV.trim()
    if (!user || !v || v === oldV) return
    const name = catName(catId)
    renamePreset('sub:' + name, SUBCATEGORY_PRESETS[name] ?? [], oldV, v)
    await supabase
      .from('expenses')
      .update({ subcategory: v })
      .eq('user_id', user.id)
      .eq('category_id', catId)
      .eq('subcategory', oldV)
    if (buySub === oldV) setBuySub(v)
  }

  // Удалить подкатегорию: убираем подсказку и очищаем её у записей (суммы остаются).
  const deleteSub = async (catId: string, v: string) => {
    if (!user) return
    const name = catName(catId)
    deletePreset('sub:' + name, SUBCATEGORY_PRESETS[name] ?? [], v)
    await supabase
      .from('expenses')
      .update({ subcategory: null })
      .eq('user_id', user.id)
      .eq('category_id', catId)
      .eq('subcategory', v)
    if (buySub === v) setBuySub('')
  }

  const savedFor = (goalId: string) =>
    contribs.filter((c) => c.goal_id === goalId).reduce((s, c) => s + Number(c.amount), 0)

  const addWish = async (e: FormEvent) => {
    e.preventDefault()
    if (!user || !name.trim()) return
    setBusy(true)
    setError(null)
    const targetBase = Math.round(parseAmount(price) * rateFor(priceCurrency))
    const { data, error } = await supabase
      .from('goals')
      .insert({
        user_id: user.id,
        name: name.trim(),
        note: note.trim() || null,
        target_amount: targetBase,
        category: wishCategory,
        is_goal: false,
        done: false,
      })
      .select(GOAL_COLS)
      .single()
    setBusy(false)
    if (error || !data) {
      setError(error?.message ?? t('goals.errAdd'))
      return
    }
    setGoals([data as Goal, ...goals])
    setName('')
    setPrice('')
    setNote('')
    setPriceCurrency('UZS')
  }

  const openGoalForm = (g: Goal) => {
    setGoalFormId(g.id)
    setGoalTarget(g.target_amount ? formatAmountInput(String(g.target_amount)) : '')
    setGoalTargetCurrency('UZS')
    setGoalDate(g.target_date ?? '')
    setError(null)
  }

  const makeGoal = async (id: string) => {
    const target = Math.round(parseAmount(goalTarget) * rateFor(goalTargetCurrency))
    if (!target) {
      setError(t('goals.errGoalAmount'))
      return
    }
    const { data, error } = await supabase
      .from('goals')
      .update({ target_amount: target, target_date: goalDate || null, is_goal: true })
      .eq('id', id)
      .select(GOAL_COLS)
      .single()
    if (error || !data) {
      setError(error?.message ?? t('common.error'))
      return
    }
    setGoals(goals.map((g) => (g.id === id ? (data as Goal) : g)))
    setGoalFormId(null)
  }

  const addContribution = async (goalId: string) => {
    if (!user) return
    const value = parseAmount(contribAmount)
    if (!value) {
      setError(t('goals.errAmount'))
      return
    }
    const { data, error } = await supabase
      .from('goal_contributions')
      .insert({ user_id: user.id, goal_id: goalId, amount: value, date: contribDate })
      .select('id, goal_id, amount, date')
      .single()
    if (error || !data) {
      setError(error?.message ?? t('common.error'))
      return
    }
    setContribs([...contribs, data as Contribution])
    setContribFormId(null)
    setContribAmount('')
  }

  const startEditContrib = (c: Contribution) => {
    setEditContribId(c.id)
    setEditContribAmount(formatAmountInput(String(c.amount)))
    setEditContribDate(c.date)
    setError(null)
  }

  const saveContribution = async (id: string) => {
    const value = parseAmount(editContribAmount)
    if (!value) {
      setError(t('goals.errAmount'))
      return
    }
    const { data, error } = await supabase
      .from('goal_contributions')
      .update({ amount: value, date: editContribDate })
      .eq('id', id)
      .select('id, goal_id, amount, date')
      .single()
    if (error || !data) {
      setError(error?.message ?? t('common.error'))
      return
    }
    setContribs(contribs.map((c) => (c.id === id ? (data as Contribution) : c)))
    setEditContribId(null)
  }

  const removeContribution = async (id: string) => {
    const { error } = await supabase.from('goal_contributions').delete().eq('id', id)
    if (error) {
      setError(error.message)
      return
    }
    setContribs(contribs.filter((c) => c.id !== id))
  }

  // Отметить выполненным БЕЗ записи в расходы.
  const setDone = async (g: Goal, done: boolean) => {
    const { data, error } = await supabase
      .from('goals')
      .update({ done })
      .eq('id', g.id)
      .select(GOAL_COLS)
      .single()
    if (error || !data) {
      setError(error?.message ?? t('common.error'))
      return
    }
    setGoals(goals.map((x) => (x.id === g.id ? (data as Goal) : x)))
  }

  // Открыть форму «Куплено»: предзаполняем сумму, категорию и дату.
  const openBuyForm = (g: Goal) => {
    setBuyFormId(g.id)
    const saved = savedFor(g.id)
    const amount = g.target_amount > 0 ? g.target_amount : saved
    setBuyAmount(amount > 0 ? formatAmountInput(String(amount)) : '')
    const guess =
      categories.find((c) => c.name === g.category) ??
      categories.find((c) => c.name.startsWith('Цели')) ??
      categories[0]
    setBuyCategory(guess?.id ?? '')
    setBuySub('')
    setBuyDate(new Date().toISOString().slice(0, 10))
    setError(null)
  }

  // Записать покупку в расходы и связать с желанием/целью.
  const confirmBuy = async (g: Goal) => {
    if (!user) return
    const value = parseAmount(buyAmount)
    if (!value) {
      setError(t('goals.errBuyAmount'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const d = new Date(buyDate + 'T00:00:00')
      const month = await getOrCreateMonth(user.id, d.getFullYear(), d.getMonth() + 1)
      const { data: exp, error: expErr } = await supabase
        .from('expenses')
        .insert({
          user_id: user.id,
          amount: value,
          date: buyDate,
          description: g.name,
          category_id: buyCategory || null,
          subcategory: buySub.trim() || null,
          month_id: month.id,
          currency: BASE_CURRENCY,
          original_amount: value,
        })
        .select('id')
        .single()
      if (expErr || !exp) throw expErr ?? new Error(t('common.saveFailed'))
      const { data, error } = await supabase
        .from('goals')
        .update({ done: true, expense_id: (exp as { id: string }).id })
        .eq('id', g.id)
        .select(GOAL_COLS)
        .single()
      if (error || !data) throw error ?? new Error(t('common.error'))
      setGoals(goals.map((x) => (x.id === g.id ? (data as Goal) : x)))
      setBuyFormId(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Вернуть из «Достигнуто»: если был связанный расход — удаляем его тоже.
  const returnItem = async (g: Goal) => {
    if (g.expense_id) {
      const { error: delErr } = await supabase.from('expenses').delete().eq('id', g.expense_id)
      if (delErr) {
        setError(delErr.message)
        return
      }
    }
    const { data, error } = await supabase
      .from('goals')
      .update({ done: false, expense_id: null })
      .eq('id', g.id)
      .select(GOAL_COLS)
      .single()
    if (error || !data) {
      setError(error?.message ?? t('common.error'))
      return
    }
    setGoals(goals.map((x) => (x.id === g.id ? (data as Goal) : x)))
  }

  const removeGoal = async (id: string) => {
    const g = goals.find((x) => x.id === id)
    if (g?.expense_id) {
      await supabase.from('expenses').delete().eq('id', g.expense_id)
    }
    const { error } = await supabase.from('goals').delete().eq('id', id)
    if (error) {
      setError(error.message)
      return
    }
    setGoals(goals.filter((x) => x.id !== id))
    setContribs(contribs.filter((c) => c.goal_id !== id))
  }

  const activeGoals = goals.filter((g) => g.is_goal && !g.done)
  const wishes = goals.filter((g) => !g.is_goal && !g.done)
  const doneItems = goals.filter((g) => g.done)

  const sortedWishes = [...wishes].sort((a, b) => {
    if (byPriority) {
      const d = catPriority(a.category) - catPriority(b.category)
      if (d !== 0) return d
    }
    const cmp = a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
    return dateDir === 'new' ? -cmp : cmp
  })

  const wishConverted = Math.round(parseAmount(price) * rateFor(priceCurrency))
  const goalConverted = Math.round(parseAmount(goalTarget) * rateFor(goalTargetCurrency))
  const buyConverted = parseAmount(buyAmount)

  // Форма записи покупки в расходы (общая для желаний и целей).
  const renderBuyForm = (g: Goal) => (
    <div className="flex flex-col gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3">
      <p className="text-sm font-medium">🛒 {t('goals.toExpenses')}</p>
      <input
        inputMode="numeric"
        value={buyAmount}
        onChange={(e) => setBuyAmount(formatAmountInput(e.target.value))}
        placeholder={t('goals.purchaseAmount')}
        className={inputCls}
      />
      <Select
        value={buyCategory}
        onChange={(v) => {
          setBuyCategory(v)
          setBuySub('')
        }}
        options={categoryOptions}
        placeholder={t('common.category')}
      />
      <Combobox
        value={buySub}
        onChange={setBuySub}
        options={subOptions(buyCategory)}
        placeholder={t('goals.subOptional')}
        onRenameOption={(o, n) => renameSub(buyCategory, o, n)}
        onDeleteOption={(o) => deleteSub(buyCategory, o)}
      />
      <DatePicker value={buyDate} onChange={setBuyDate} />
      <p className="text-xs text-neutral-500">{t('goals.willBeExpense', { n: g.name, v: formatSum(buyConverted) })}</p>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => confirmBuy(g)} disabled={busy} className={btnPrimary}>
          {busy ? t('common.saving') : t('goals.recordExpense')}
        </button>
        <button onClick={() => setDone(g, true)} className={btnGhost}>
          {t('goals.noExpense')}
        </button>
        <button onClick={() => setBuyFormId(null)} className={btnGhost}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  )

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">🎯 {t('goals.title')}</h1>

      <form
        onSubmit={addWish}
        className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50"
      >
        <p className="text-sm font-medium">➕ {t('goals.addWish')}</p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('goals.wishName')}
          className={inputCls}
        />
        <div className="flex gap-2">
          <input
            inputMode="numeric"
            value={price}
            onChange={(e) => setPrice(formatAmountInput(e.target.value))}
            placeholder={t('goals.priceApprox')}
            className={'flex-1 min-w-0 ' + fieldBase}
          />
          <Select
            className="w-32 shrink-0"
            value={priceCurrency}
            onChange={setPriceCurrency}
            options={priceCurrencyOptions}
          />
        </div>
        {priceCurrency !== 'UZS' && (
          <p className="text-xs text-neutral-500">
            {t('inc.rate', { c: priceCurrency, v: formatSum(rateFor(priceCurrency)) })}
            {price ? ` · ≈ ${formatSum(wishConverted)}` : ''}
          </p>
        )}
        <Select value={wishCategory} onChange={setWishCategory} options={wishCategoryOptions} />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('goals.note')}
          className={inputCls}
        />
        {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="self-start rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-60"
        >
          {busy ? t('goals.adding') : t('common.add')}
        </button>
      </form>

      {loading ? (
        <p className="text-neutral-500 dark:text-neutral-400">{t('common.loading')}</p>
      ) : (
        <>
          {/* Активные цели */}
          <section className="flex flex-col gap-3">
            <h2 className={sectionTitle}>🎯 {t('goals.active')}</h2>
            {activeGoals.length === 0 ? (
              <p className="text-sm text-neutral-500">{t('goals.noActive')}</p>
            ) : (
              activeGoals.map((g) => {
                const saved = savedFor(g.id)
                const pct = g.target_amount > 0 ? Math.min(100, (saved / g.target_amount) * 100) : 0
                const remaining = Math.max(0, g.target_amount - saved)
                const months = monthsUntil(g.target_date)
                const perMonth = months > 0 ? remaining / months : 0
                const goalContribs = contribs.filter((c) => c.goal_id === g.id)
                return (
                  <div
                    key={g.id}
                    className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{g.name}</p>
                          {g.category && (
                            <span className={`rounded-full px-2 py-0.5 text-xs ${catBadgeCls(g.category)}`}>
                              {tr(g.category)}
                            </span>
                          )}
                        </div>
                        {g.target_date && (
                          <p className="text-xs text-neutral-500">{t('goals.by', { d: formatDateHuman(g.target_date) })}</p>
                        )}
                      </div>
                      <span className="shrink-0 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                        {Math.round(pct)}%
                      </span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                      <div className="h-full rounded-full bg-emerald-500" style={ { width: `${pct}%` } } />
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <p className="text-neutral-500">{t('goals.collected')}</p>
                        <p className="font-medium text-emerald-600 dark:text-emerald-400">{formatSum(saved)}</p>
                      </div>
                      <div>
                        <p className="text-neutral-500">{t('goals.left')}</p>
                        <p className="font-medium">{formatSum(remaining)}</p>
                      </div>
                      <div>
                        <p className="text-neutral-500">{t('goals.perMonth')}</p>
                        <p className="font-medium">{months > 0 ? formatSum(perMonth) : '—'}</p>
                      </div>
                    </div>
                    <p className="text-xs text-neutral-500">{t('goals.target', { v: formatSum(g.target_amount) })}</p>

                    {buyFormId === g.id ? (
                      renderBuyForm(g)
                    ) : contribFormId === g.id ? (
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <input
                          inputMode="numeric"
                          value={contribAmount}
                          onChange={(e) => setContribAmount(formatAmountInput(e.target.value))}
                          placeholder={t('goals.howMuch')}
                          className={'flex-1 ' + fieldBase}
                        />
                        <div className="flex-1">
                          <DatePicker value={contribDate} onChange={setContribDate} />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => addContribution(g.id)} className={btnPrimary}>
                            {t('goals.setAside')}
                          </button>
                          <button onClick={() => setContribFormId(null)} className={btnGhost}>
                            {t('common.cancel')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          onClick={() => {
                            setContribFormId(g.id)
                            setContribAmount('')
                            setError(null)
                          }}
                          className={btnPrimary}
                        >
                          💰 {t('goals.setAsideBtn')}
                        </button>
                        <button onClick={() => openBuyForm(g)} className={btnGhost}>
                          ✅ {t('goals.bought')}
                        </button>
                        <button onClick={() => removeGoal(g.id)} className={btnMuted}>
                          {t('common.delete')}
                        </button>
                      </div>
                    )}

                    {goalContribs.length > 0 && (
                      <details className="text-sm text-neutral-500">
                        <summary className="cursor-pointer">{t('goals.contribs', { n: goalContribs.length })}</summary>
                        <div className="mt-3 flex flex-col gap-2">
                          {goalContribs.map((c) =>
                            editContribId === c.id ? (
                              <div
                                key={c.id}
                                className="flex flex-col gap-2 rounded-lg bg-neutral-100 p-2.5 dark:bg-neutral-800/50 sm:flex-row"
                              >
                                <input
                                  inputMode="numeric"
                                  value={editContribAmount}
                                  onChange={(e) => setEditContribAmount(formatAmountInput(e.target.value))}
                                  className={'flex-1 ' + fieldBase}
                                />
                                <div className="flex-1">
                                  <DatePicker value={editContribDate} onChange={setEditContribDate} />
                                </div>
                                <div className="flex gap-2">
                                  <button onClick={() => saveContribution(c.id)} className={btnPrimary}>
                                    {t('common.save')}
                                  </button>
                                  <button onClick={() => setEditContribId(null)} className={btnGhost}>
                                    {t('common.cancel')}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div
                                key={c.id}
                                className="flex items-center justify-between gap-3 rounded-lg bg-neutral-100 px-3 py-2.5 text-sm dark:bg-neutral-800/50"
                              >
                                <span className="text-neutral-700 dark:text-neutral-300">
                                  {formatDateHuman(c.date)} · {formatSum(Number(c.amount))}
                                </span>
                                <div className="flex shrink-0 gap-3">
                                  <button
                                    onClick={() => startEditContrib(c)}
                                    className="text-neutral-500 transition hover:text-emerald-600 dark:hover:text-emerald-400"
                                  >
                                    {t('common.edit')}
                                  </button>
                                  <button
                                    onClick={() => removeContribution(c.id)}
                                    className="text-red-500 transition hover:text-red-600 dark:text-red-400 dark:hover:text-red-300"
                                  >
                                    {t('common.delete')}
                                  </button>
                                </div>
                              </div>
                            ),
                          )}
                        </div>
                      </details>
                    )}
                  </div>
                )
              })
            )}
          </section>

          {/* Список желаний */}
          <section className="flex flex-col gap-3">
            <hr className="border-neutral-200 dark:border-neutral-800" />
            <h2 className={sectionTitle}>🛒 {t('goals.wantBuy')}</h2>
            {wishes.length === 0 ? (
              <p className="text-sm text-neutral-500">{t('goals.emptyList')}</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-neutral-500">{t('common.sort')}:</span>
                  <button type="button" onClick={() => setByPriority((v) => !v)} className={chipCls(byPriority)}>
                    {t('goals.byPriority')}
                  </button>
                  <span className="text-neutral-300 dark:text-neutral-700">|</span>
                  <button type="button" onClick={() => setDateDir('new')} className={chipCls(dateDir === 'new')}>
                    {t('common.sortNew')}
                  </button>
                  <button type="button" onClick={() => setDateDir('old')} className={chipCls(dateDir === 'old')}>
                    {t('common.sortOld')}
                  </button>
                </div>
                {sortedWishes.map((g) => (
                  <div
                    key={g.id}
                    className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900/40"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{g.name}</p>
                        {g.category && (
                          <span className={`rounded-full px-2 py-0.5 text-xs ${catBadgeCls(g.category)}`}>
                            {tr(g.category)}
                          </span>
                        )}
                      </div>
                      {g.note && <p className="text-xs text-neutral-500">{g.note}</p>}
                      {g.target_amount > 0 && (
                        <p className="text-xs text-neutral-500">≈ {formatSum(g.target_amount)}</p>
                      )}
                    </div>
                    {buyFormId === g.id ? (
                      renderBuyForm(g)
                    ) : goalFormId === g.id ? (
                      <div className="flex flex-col gap-2">
                        <div className="flex gap-2">
                          <input
                            inputMode="numeric"
                            value={goalTarget}
                            onChange={(e) => setGoalTarget(formatAmountInput(e.target.value))}
                            placeholder={t('goals.goalAmount')}
                            className={'flex-1 min-w-0 ' + fieldBase}
                          />
                          <Select
                            className="w-32 shrink-0"
                            value={goalTargetCurrency}
                            onChange={setGoalTargetCurrency}
                            options={priceCurrencyOptions}
                          />
                        </div>
                        {goalTargetCurrency !== 'UZS' && (
                          <p className="text-xs text-neutral-500">
                            {t('inc.rate', { c: goalTargetCurrency, v: formatSum(rateFor(goalTargetCurrency)) })}
                            {goalTarget ? ` · ≈ ${formatSum(goalConverted)}` : ''}
                          </p>
                        )}
                        <DatePicker value={goalDate} onChange={setGoalDate} />
                        <div className="flex gap-2">
                          <button onClick={() => makeGoal(g.id)} className={btnPrimary}>
                            {t('goals.makeGoal')}
                          </button>
                          <button onClick={() => setGoalFormId(null)} className={btnGhost}>
                            {t('common.cancel')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-3">
                        <button onClick={() => openGoalForm(g)} className={btnPrimary}>
                          🎯 {t('goals.makeGoalBtn')}
                        </button>
                        <button onClick={() => openBuyForm(g)} className={btnGhost}>
                          ✅ {t('goals.bought')}
                        </button>
                        <button onClick={() => removeGoal(g.id)} className={btnMuted}>
                          {t('common.delete')}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </section>

          {/* Достигнуто */}
          {doneItems.length > 0 && (
            <section className="flex flex-col gap-3">
              <hr className="border-neutral-200 dark:border-neutral-800" />
              <h2 className={sectionTitle}>✅ {t('goals.done')}</h2>
              {doneItems.map((g) => (
                <div
                  key={g.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 opacity-70 dark:border-neutral-800 dark:bg-neutral-900/40"
                >
                  <span className="flex items-center gap-2 text-sm">
                    <span className="line-through">{g.name}</span>
                    {g.expense_id && (
                      <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs text-red-600 dark:text-red-400">
                        {t('goals.inExpenses')}
                      </span>
                    )}
                  </span>
                  <div className="flex shrink-0 gap-3 text-sm text-neutral-500">
                    <button onClick={() => returnItem(g)} className="transition hover:text-neutral-900 dark:hover:text-neutral-100">
                      {t('goals.restore')}
                    </button>
                    <button onClick={() => removeGoal(g.id)} className="text-red-500 transition hover:text-red-600 dark:text-red-400 dark:hover:text-red-300">
                      {t('common.delete')}
                    </button>
                  </div>
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  )
}
