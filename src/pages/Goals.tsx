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
  getOrCreateMonth,
  SUBCATEGORY_PRESETS,
  effectivePresets,
  renamePreset,
  deletePreset,
  WISH_CATEGORIES,
  loadGoalsSplit,
  saveGoalsSplit,
  DEFAULT_GOALS_SPLIT,
} from '../lib/db'

type Goal = {
  id: string
  name: string
  note: string | null
  target_amount: number
  target_date: string | null
  is_goal: boolean
  is_primary: boolean
  done: boolean
  category: string | null
  expense_id: string | null
  created_at: string
}
type Contribution = { id: string; goal_id: string; amount: number; date: string }
type Category = { id: string; name: string; percent?: number; archived?: boolean }

const GOAL_COLS =
  'id, name, note, target_amount, target_date, is_goal, is_primary, done, category, expense_id, created_at'

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
  const wishCategoryOptions = WISH_CATEGORIES.map((c) => ({ value: c, label: tr(c) }))

  const [goals, setGoals] = useState<Goal[]>([])
  const [contribs, setContribs] = useState<Contribution[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [received, setReceived] = useState(0)
  const [split, setSplit] = useState(DEFAULT_GOALS_SPLIT)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [note, setNote] = useState('')
  const [wishCategory, setWishCategory] = useState<string>('Цели и хотелки')
  const [busy, setBusy] = useState(false)

  // Мульти-сортировка: «по важности» можно совмещать с направлением по дате.
  const [byPriority, setByPriority] = useState(true)
  const [dateDir, setDateDir] = useState<'new' | 'old'>('new')

  const [goalFormId, setGoalFormId] = useState<string | null>(null)
  const [goalTarget, setGoalTarget] = useState('')
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
        const now = new Date()
        const m = await getOrCreateMonth(user.id, now.getFullYear(), now.getMonth() + 1)
        const [gRes, cRes, catRes, incRes, splitVal] = await Promise.all([
          supabase
            .from('goals')
            .select(GOAL_COLS)
            .eq('user_id', user.id)
            .order('created_at', { ascending: false }),
          supabase
            .from('goal_contributions')
            .select('id, goal_id, amount, date')
            .eq('user_id', user.id),
          supabase
            .from('categories')
            .select('id, name, percent, archived')
            .eq('user_id', user.id)
            .order('sort_order'),
          supabase.from('incomes').select('amount').eq('month_id', m.id),
          loadGoalsSplit(user.id),
        ])
        if (!active) return
        if (gRes.error) throw gRes.error
        if (cRes.error) throw cRes.error
        if (catRes.error) throw catRes.error
        if (incRes.error) throw incRes.error
        setGoals((gRes.data ?? []) as Goal[])
        setContribs((cRes.data ?? []) as Contribution[])
        setCategories((catRes.data ?? []) as Category[])
        setReceived(
          (incRes.data ?? []).reduce((s: number, r: { amount: number }) => s + Number(r.amount), 0),
        )
        setSplit(splitVal)
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
    const { data, error } = await supabase
      .from('goals')
      .insert({
        user_id: user.id,
        name: name.trim(),
        note: note.trim() || null,
        target_amount: parseAmount(price),
        category: wishCategory,
        is_goal: false,
        is_primary: false,
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
  }

  const openGoalForm = (g: Goal) => {
    setGoalFormId(g.id)
    setGoalTarget(g.target_amount ? formatAmountInput(String(g.target_amount)) : '')
    setGoalDate(g.target_date ?? '')
    setError(null)
  }

  const makeGoal = async (id: string) => {
    const target = parseAmount(goalTarget)
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

  // Сделать цель главной: снимаем флаг со всех остальных, ставим этой.
  const setPrimary = async (id: string) => {
    if (!user) return
    const { error: clearErr } = await supabase
      .from('goals')
      .update({ is_primary: false })
      .eq('user_id', user.id)
      .eq('is_primary', true)
    if (clearErr) {
      setError(clearErr.message)
      return
    }
    const { data, error } = await supabase
      .from('goals')
      .update({ is_primary: true })
      .eq('id', id)
      .select(GOAL_COLS)
      .single()
    if (error || !data) {
      setError(error?.message ?? t('common.error'))
      return
    }
    setGoals(goals.map((g) => (g.id === id ? (data as Goal) : { ...g, is_primary: false })))
  }

  const unsetPrimary = async (id: string) => {
    const { data, error } = await supabase
      .from('goals')
      .update({ is_primary: false })
      .eq('id', id)
      .select(GOAL_COLS)
      .single()
    if (error || !data) {
      setError(error?.message ?? t('common.error'))
      return
    }
    setGoals(goals.map((g) => (g.id === id ? (data as Goal) : g)))
  }

  const saveSplit = async () => {
    if (!user) return
    await saveGoalsSplit(user.id, split)
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
      .update({ done, is_primary: done ? false : g.is_primary })
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
        })
        .select('id')
        .single()
      if (expErr || !exp) throw expErr ?? new Error(t('common.saveFailed'))
      const { data, error } = await supabase
        .from('goals')
        .update({ done: true, is_primary: false, expense_id: (exp as { id: string }).id })
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
  const primaryGoal = activeGoals.find((g) => g.is_primary) ?? null
  const secondaryGoals = activeGoals.filter((g) => g.id !== primaryGoal?.id)

  // Распределение внутри категории «Цели» (80/20 по умолчанию).
  const goalsCat = categories.find((c) => !c.archived && c.name.startsWith('Цели'))
  const goalsPercent = goalsCat ? Number(goalsCat.percent ?? 0) : 0
  const goalsBudget = (received * goalsPercent) / 100
  const mainBudget = (goalsBudget * split) / 100
  const secBudget = (goalsBudget * (100 - split)) / 100

  const sortedWishes = [...wishes].sort((a, b) => {
    if (byPriority) {
      const d = catPriority(a.category) - catPriority(b.category)
      if (d !== 0) return d
    }
    const cmp = a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
    return dateDir === 'new' ? -cmp : cmp
  })

  const buyTotal = parseAmount(buyAmount)

  // Форма записи покупки в расходы (общая для желаний и целей).
  const renderBuyForm = (g: Goal) => (
    <div className="flex flex-col gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3">
      <p className="text-sm font-medium">{t('goals.toExpenses')}</p>
      <input
        inputMode="decimal"
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
      <p className="text-xs text-neutral-500">{t('goals.willBeExpense', { n: g.name, v: formatSum(buyTotal) })}</p>
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

  // Карточка активной цели (используется и для главной, и для второстепенных).
  const renderActiveGoal = (g: Goal) => {
    const saved = savedFor(g.id)
    const pct = g.target_amount > 0 ? Math.min(100, (saved / g.target_amount) * 100) : 0
    const remaining = Math.max(0, g.target_amount - saved)
    const months = monthsUntil(g.target_date)
    const perMonth = months > 0 ? remaining / months : 0
    const goalContribs = contribs.filter((c) => c.goal_id === g.id)
    return (
      <div
        key={g.id}
        className={`flex flex-col gap-3 rounded-2xl border p-4 ${
          g.is_primary
            ? 'border-emerald-500/60 bg-emerald-500/5 dark:bg-emerald-500/10'
            : 'border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/50'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {g.is_primary && <span aria-hidden>⭐</span>}
              <p className="font-medium">{g.name}</p>
              {g.category && (
                <span className={`rounded-full px-2 py-0.5 text-xs ${catBadgeCls(g.category)}`}>{tr(g.category)}</span>
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
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
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
        {g.is_primary && mainBudget > 0 && (
          <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
            {t('goals.monthToMain', { v: formatSum(mainBudget) })}
          </p>
        )}

        {buyFormId === g.id ? (
          renderBuyForm(g)
        ) : contribFormId === g.id ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              inputMode="decimal"
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
              {t('goals.setAsideBtn')}
            </button>
            <button onClick={() => openBuyForm(g)} className={btnGhost}>
              {t('goals.bought')}
            </button>
            {g.is_primary ? (
              <button onClick={() => unsetPrimary(g.id)} className={btnGhost}>
                {t('goals.unsetPrimary')}
              </button>
            ) : (
              <button onClick={() => setPrimary(g.id)} className={btnGhost}>
                {t('goals.makePrimary')}
              </button>
            )}
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
                      inputMode="decimal"
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
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">🎯 {t('goals.title')}</h1>

      <form
        onSubmit={addWish}
        className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50"
      >
        <p className="text-sm font-medium">{t('goals.addWish')}</p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('goals.wishName')}
          className={inputCls}
        />
        <input
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(formatAmountInput(e.target.value))}
          placeholder={t('goals.priceApprox')}
          className={inputCls}
        />
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
          {/* Распределение категории «Цели» (80/20) */}
          <section className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50">
            <h2 className={sectionTitle}>{t('goals.split')}</h2>
            <p className="text-xs text-neutral-500">{t('goals.splitHint', { a: split, b: 100 - split })}</p>
            {goalsCat ? (
              <>
                <p className="text-sm">{t('goals.goalsBudget', { v: formatSum(goalsBudget) })}</p>
                <div className="flex h-3 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                  <div className="h-full bg-emerald-500" style={{ width: `${split}%` }} />
                  <div className="h-full bg-sky-400" style={{ width: `${100 - split}%` }} />
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <p className="text-neutral-500">{t('goals.splitMain', { a: split })}</p>
                    <p className="font-medium text-emerald-600 dark:text-emerald-400">{formatSum(mainBudget)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-neutral-500">{t('goals.splitSecondary', { b: 100 - split })}</p>
                    <p className="font-medium text-sky-600 dark:text-sky-400">{formatSum(secBudget)}</p>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-xs text-amber-600 dark:text-amber-400">{t('goals.noGoalsCat')}</p>
            )}
            <div className="flex items-center gap-2">
              <label className="text-xs text-neutral-500">{t('goals.mainShare')}</label>
              <input
                inputMode="numeric"
                value={String(split)}
                onChange={(e) =>
                  setSplit(Math.max(0, Math.min(100, Number(e.target.value.replace(/[^\d]/g, '')) || 0)))
                }
                onBlur={saveSplit}
                className="w-16 rounded-lg border border-neutral-300 bg-white px-2 py-1 text-center text-sm outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950"
              />
              <span className="text-xs text-neutral-500">/ {100 - split}%</span>
            </div>
          </section>

          {/* Главная цель */}
          <section className="flex flex-col gap-3">
            <h2 className={sectionTitle}>{t('goals.primary')}</h2>
            {primaryGoal ? (
              renderActiveGoal(primaryGoal)
            ) : (
              <p className="text-sm text-neutral-500">{t('goals.noPrimary')}</p>
            )}
          </section>

          {/* Второстепенные цели */}
          <section className="flex flex-col gap-3">
            <hr className="border-neutral-200 dark:border-neutral-800" />
            <h2 className={sectionTitle}>{t('goals.secondaryGoals')}</h2>
            {secondaryGoals.length === 0 ? (
              <p className="text-sm text-neutral-500">{t('goals.noActive')}</p>
            ) : (
              secondaryGoals.map(renderActiveGoal)
            )}
          </section>

          {/* Список желаний */}
          <section className="flex flex-col gap-3">
            <hr className="border-neutral-200 dark:border-neutral-800" />
            <h2 className={sectionTitle}>{t('goals.wantBuy')}</h2>
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
                        <input
                          inputMode="decimal"
                          value={goalTarget}
                          onChange={(e) => setGoalTarget(formatAmountInput(e.target.value))}
                          placeholder={t('goals.goalAmount')}
                          className={inputCls}
                        />
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
                          {t('goals.makeGoalBtn')}
                        </button>
                        <button onClick={() => openBuyForm(g)} className={btnGhost}>
                          {t('goals.bought')}
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
              <h2 className={sectionTitle}>{t('goals.done')}</h2>
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
