import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import DatePicker from '../components/DatePicker'
import IconButton from '../components/IconButton'
import { useLang } from '../lib/i18n'
import {
  formatSum,
  formatAmountInput,
  parseAmount,
  formatDateHuman,
  getOrCreateMonth,
  isCharityCategory,
  isCharityBigSubcategory,
  CHARITY_BIG_SUBCATEGORY,
  CHARITY_SMALL_SUBCATEGORY,
  loadCharityPots,
  loadCharitySplit,
  saveCharitySplit,
  DEFAULT_CHARITY_SPLIT,
  type CharityPotsStats,
} from '../lib/db'
import { readCache, writeCache } from '../lib/offlineCache'
import {
  loadCharityGoals,
  createCharityGoal,
  updateCharityGoal,
  setPrimaryCharityGoal,
  deleteCharityGoal,
  collectedByGoal,
  type CharityGoal,
} from '../lib/charityGoals'

type Category = { id: string; name: string; percent?: number; archived?: boolean }
type CharityExpense = {
  id: string
  amount: number
  date: string
  description: string | null
  subcategory: string | null
  paid_from_pot: string | null
  charity_goal_id: string | null
}
type CharityCache = {
  categories: Category[]
  received: number
  pots: CharityPotsStats
  split: number
  // Необязательное поле для совместимости с кэшем старой версии,
  // где была одна цель (goalName / goalTarget), а массива goals ещё не было.
  goals?: CharityGoal[]
  items: CharityExpense[]
}

const fieldBase =
  'rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-rose-500 dark:border-neutral-700 dark:bg-neutral-950'
const inputCls = 'w-full ' + fieldBase
const btnPrimary =
  'rounded-lg bg-rose-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-rose-400 disabled:opacity-60'
const btnGhost =
  'rounded-lg border border-neutral-300 px-3 py-1.5 text-sm transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
const sectionTitle = 'text-xl font-semibold'

const todayISO = () => new Date().toISOString().slice(0, 10)

export default function Charity() {
  const { user } = useAuth()
  const { t } = useLang()
  const navigate = useNavigate()

  const [categories, setCategories] = useState<Category[]>([])
  const [received, setReceived] = useState(0)
  const [pots, setPots] = useState<CharityPotsStats>({ big: 0, small: 0, total: 0 })
  const [items, setItems] = useState<CharityExpense[]>([])
  const [split, setSplit] = useState(DEFAULT_CHARITY_SPLIT)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Список крупных целей: главная (⭐) идёт первой, дальше второстепенные.
  const [goals, setGoals] = useState<CharityGoal[]>([])

  // Форма цели: null -- закрыта, 'new' -- создание, иначе id редактируемой цели.
  const [goalForm, setGoalForm] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formTarget, setFormTarget] = useState('')
  // Подтверждение удаления цели прямо в карточке.
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null)

  // Пополнение крупной цели: id цели, для которой открыта форма.
  const [bigOpen, setBigOpen] = useState<string | null>(null)
  const [bigAmount, setBigAmount] = useState('')
  const [bigDate, setBigDate] = useState(todayISO())

  // Маленькое пожертвование (список «Кому / Сколько»).
  const [smallTo, setSmallTo] = useState('')
  const [smallAmount, setSmallAmount] = useState('')
  const [smallDate, setSmallDate] = useState(todayISO())

  // Редактирование записи из списка (пополнение крупной цели или маленькое пожертвование).
  const [editId, setEditId] = useState<string | null>(null)
  const [editAmount, setEditAmount] = useState('')
  const [editDate, setEditDate] = useState(todayISO())
  const [editTo, setEditTo] = useState('')

  useEffect(() => {
    if (!user) return
    let active = true
    // Мгновенно показываем кэш (без спиннера и без интернета), сеть обновляет в фоне.
    const ck = `charity:${user.id}`
    const cached = readCache<CharityCache>(ck)
    if (cached) {
      // Кэш не является контрактом: старые версии могли не содержать часть полей.
      // Нормализуем все коллекции и числа до передачи в React, чтобы повреждённый
      // или устаревший payload никогда не превращался в чёрный экран.
      setCategories(Array.isArray(cached.categories) ? cached.categories : [])
      setReceived(Number(cached.received) || 0)
      setPots({
        big: Number(cached.pots?.big) || 0,
        small: Number(cached.pots?.small) || 0,
        total: Number(cached.pots?.total) || 0,
      })
      const cachedSplit = Number(cached.split)
      setSplit(Number.isFinite(cachedSplit) ? Math.max(0, Math.min(100, cachedSplit)) : DEFAULT_CHARITY_SPLIT)
      // Старый локальный кэш до перехода на список целей не содержит goals.
      // Не даём ему положить undefined в состояние и сломать рендер страницы.
      setGoals(Array.isArray(cached.goals) ? cached.goals : [])
      setItems(Array.isArray(cached.items) ? cached.items : [])
      setLoading(false)
    } else {
      setLoading(true)
    }
    ;(async () => {
      try {
        const now = new Date()
        const m = await getOrCreateMonth(user.id, now.getFullYear(), now.getMonth() + 1)
        const [catRes, incRes, potsVal, splitVal, goalVal] = await Promise.all([
          supabase
            .from('categories')
            .select('id, name, percent, archived')
            .eq('user_id', user.id)
            .order('sort_order'),
          supabase.from('incomes').select('amount').eq('month_id', m.id),
          loadCharityPots(user.id),
          loadCharitySplit(user.id),
          loadCharityGoals(user.id),
        ])
        if (!active) return
        if (catRes.error) throw catRes.error
        if (incRes.error) throw incRes.error
        const cats = (catRes.data ?? []) as Category[]
        const receivedSum = (incRes.data ?? []).reduce(
          (s: number, r: { amount: number }) => s + Number(r.amount),
          0,
        )
        setCategories(cats)
        setReceived(receivedSum)
        setPots(potsVal)
        setSplit(splitVal)
        setGoals(goalVal)

        // Записи копилки благотворительности (пополнения и пожертвования).
        const charityIds = cats.filter((c) => isCharityCategory(c.name)).map((c) => c.id)
        let charityItems: CharityExpense[] = []
        if (charityIds.length > 0) {
          const { data: exps } = await supabase
            .from('expenses')
            .select('id, amount, date, description, subcategory, paid_from_pot, charity_goal_id')
            .eq('user_id', user.id)
            .in('category_id', charityIds)
            .order('date', { ascending: false })
          charityItems = (exps ?? []) as CharityExpense[]
          if (active) setItems(charityItems)
        }
        if (active) {
          writeCache(ck, {
            categories: cats,
            received: receivedSum,
            pots: potsVal,
            split: splitVal,
            goals: goalVal,
            items: charityItems,
          })
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
  }, [user])

  const saveSplit = async () => {
    if (!user) return
    await saveCharitySplit(user.id, split)
  }

  const charityCat = categories.find((c) => !c.archived && isCharityCategory(c.name))
  const charityPercent = charityCat ? Number(charityCat.percent ?? 0) : 0
  const charityBudget = (received * charityPercent) / 100
  const bigBudget = (charityBudget * split) / 100
  const smallBudget = (charityBudget * (100 - split)) / 100

  // Списки: пополнения крупных целей и маленькие пожертвования (только пополнения копилки).
  const bigTopUps = items.filter((i) => !i.paid_from_pot && isCharityBigSubcategory(i.subcategory))
  const smallDonations = items.filter((i) => !i.paid_from_pot && !isCharityBigSubcategory(i.subcategory))

  // Сколько собрано по каждой цели. Старые записи без привязки идут главной цели.
  const collected = collectedByGoal(bigTopUps, goals)

  /** Пополнения конкретной цели (у главной — ещё и все записи без привязки). */
  const topUpsOf = (g: CharityGoal) =>
    bigTopUps.filter((i) =>
      i.charity_goal_id ? i.charity_goal_id === g.id : g.is_primary,
    )

  const openGoalForm = (g: CharityGoal | null) => {
    setGoalForm(g ? g.id : 'new')
    setFormName(g ? g.name : '')
    setFormTarget(g && g.target > 0 ? formatAmountInput(String(g.target)) : '')
    setError(null)
  }

  const submitGoal = async (e: FormEvent) => {
    e.preventDefault()
    if (!user || !goalForm) return
    const target = parseAmount(formTarget)
    const name = formName.trim()
    try {
      if (goalForm === 'new') {
        const created = await createCharityGoal(user.id, name, target, false)
        // Перечитываем список: первая цель могла стать главной автоматически.
        setGoals((prev) =>
          created.is_primary ? [created, ...prev.map((g) => ({ ...g, is_primary: false }))] : [...prev, created],
        )
      } else {
        await updateCharityGoal(goalForm, { name, target })
        setGoals((prev) => prev.map((g) => (g.id === goalForm ? { ...g, name, target } : g)))
      }
      setGoalForm(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  /** Сделать цель главной (⭐). Прежняя становится второстепенной. */
  const makePrimary = async (goalId: string) => {
    if (!user) return
    try {
      await setPrimaryCharityGoal(user.id, goalId)
      setGoals((prev) => {
        const next = prev.map((g) => ({ ...g, is_primary: g.id === goalId }))
        return [...next].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order)
      })
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const removeGoal = async (goalId: string) => {
    if (!user) return
    setConfirmDelId(null)
    try {
      await deleteCharityGoal(user.id, goalId)
      setGoals(await loadCharityGoals(user.id))
      // Деньги остаются в копилке: у записей просто слетает привязка к цели.
      setItems((prev) =>
        prev.map((i) => (i.charity_goal_id === goalId ? { ...i, charity_goal_id: null } : i)),
      )
    } catch (err) {
      setError((err as Error).message)
    }
  }

  // Общая запись пополнения копилки благотворительности в «Расходы»
  // (категория «Благотворительность», без paid_from_pot -- значит копилка растёт).
  const addContribution = async (
    sub: string,
    amount: number,
    date: string,
    to: string | null,
    goalId: string | null,
  ): Promise<CharityExpense> => {
    if (!user || !charityCat) throw new Error(t('charity.noCat'))
    const d = new Date(date + 'T00:00:00')
    const m = await getOrCreateMonth(user.id, d.getFullYear(), d.getMonth() + 1)
    const { data, error } = await supabase
      .from('expenses')
      .insert({
        user_id: user.id,
        month_id: m.id,
        category_id: charityCat.id,
        subcategory: sub,
        amount,
        date,
        description: to,
        paid_from_pot: null,
        charity_goal_id: goalId,
      })
      .select('id, amount, date, description, subcategory, paid_from_pot, charity_goal_id')
      .single()
    if (error || !data) throw error ?? new Error(t('common.saveFailed'))
    return data as CharityExpense
  }

  const submitBig = async (e: FormEvent) => {
    e.preventDefault()
    const goalId = bigOpen
    if (!user || !goalId) return
    const amount = parseAmount(bigAmount)
    if (!amount || amount <= 0) {
      setError(t('common.enterPositive'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const row = await addContribution(CHARITY_BIG_SUBCATEGORY, amount, bigDate, null, goalId)
      setItems((prev) => [row, ...prev])
      setPots((p) => ({ ...p, big: p.big + amount, total: p.total + amount }))
      setBigAmount('')
      setBigDate(todayISO())
      setBigOpen(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const submitSmall = async (e: FormEvent) => {
    e.preventDefault()
    if (!user) return
    const amount = parseAmount(smallAmount)
    if (!amount || amount <= 0) {
      setError(t('common.enterPositive'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const row = await addContribution(
        CHARITY_SMALL_SUBCATEGORY,
        amount,
        smallDate,
        smallTo.trim() || null,
        null,
      )
      setItems((prev) => [row, ...prev])
      setPots((p) => ({ ...p, small: p.small + amount, total: p.total + amount }))
      setSmallTo('')
      setSmallAmount('')
      setSmallDate(todayISO())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const startEdit = (c: CharityExpense) => {
    setEditId(c.id)
    setEditAmount(formatAmountInput(String(c.amount)))
    setEditDate(c.date)
    setEditTo(c.description ?? '')
    setError(null)
  }

  const cancelEdit = () => setEditId(null)

  const submitEdit = async (e: FormEvent) => {
    e.preventDefault()
    if (!user || !editId) return
    const ex = items.find((i) => i.id === editId)
    if (!ex) return
    const amount = parseAmount(editAmount)
    if (!amount || amount <= 0) {
      setError(t('common.enterPositive'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const d = new Date(editDate + 'T00:00:00')
      const m = await getOrCreateMonth(user.id, d.getFullYear(), d.getMonth() + 1)
      const isBig = isCharityBigSubcategory(ex.subcategory)
      const newTo = isBig ? ex.description : editTo.trim() || null
      const { error } = await supabase
        .from('expenses')
        .update({ amount, date: editDate, month_id: m.id, description: newTo })
        .eq('id', editId)
      if (error) throw error
      const delta = amount - Number(ex.amount)
      setItems((prev) =>
        prev.map((i) => (i.id === editId ? { ...i, amount, date: editDate, description: newTo } : i)),
      )
      if (!ex.paid_from_pot) {
        if (isBig) setPots((p) => ({ ...p, big: p.big + delta, total: p.total + delta }))
        else setPots((p) => ({ ...p, small: p.small + delta, total: p.total + delta }))
      }
      setEditId(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const removeItem = async (id: string) => {
    const ex = items.find((i) => i.id === id)
    if (!ex) return
    const { error } = await supabase.from('expenses').delete().eq('id', id)
    if (error) {
      setError(error.message)
      return
    }
    setItems((prev) => prev.filter((i) => i.id !== id))
    if (!ex.paid_from_pot) {
      const a = Number(ex.amount) || 0
      if (isCharityBigSubcategory(ex.subcategory)) {
        setPots((p) => ({ ...p, big: p.big - a, total: p.total - a }))
      } else {
        setPots((p) => ({ ...p, small: p.small - a, total: p.total - a }))
      }
    }
  }

  const openBigForm = (goalId: string) => {
    setBigOpen(goalId)
    setBigAmount('')
    setBigDate(todayISO())
    setError(null)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="sticky top-0 z-20 -mx-4 flex flex-col gap-2 border-b border-neutral-200/70 bg-white/85 px-4 py-3 backdrop-blur dark:border-neutral-800/70 dark:bg-neutral-950/85">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="-ml-2 self-start rounded-lg px-2 py-1 text-base font-medium text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
        >
          {t('charity.back')}
        </button>
        <h1 className="text-2xl font-semibold">{t('charity.title')}</h1>
      </div>

      {loading ? (
        <p className="text-neutral-500 dark:text-neutral-400">{t('common.loading')}</p>
      ) : error && items.length === 0 && !charityCat ? (
        <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
      ) : (
        <>
          {/* Текущий баланс копилки по двум частям */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4 dark:border-rose-500/20">
              <p className="text-sm font-medium">{t('charity.bigTitle')}</p>
              <p className="mt-1 text-2xl font-semibold text-rose-600 dark:text-rose-400">
                {formatSum(pots.big)}
              </p>
            </div>
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4 dark:border-rose-500/20">
              <p className="text-sm font-medium">{t('charity.smallTitle')}</p>
              <p className="mt-1 text-2xl font-semibold text-rose-600 dark:text-rose-400">
                {formatSum(pots.small)}
              </p>
            </div>
          </div>

          {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}

          {/* Распределение 5% (как 80/20 в «Целях») */}
          <section className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50">
            <h2 className={sectionTitle}>{t('charity.split')}</h2>
            {charityCat ? (
              <>
                <p className="text-sm">{t('charity.budget', { v: formatSum(charityBudget) })}</p>
                <div className="flex h-3 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                  <div className="h-full bg-rose-500" style={{ width: `${split}%` }} />
                  <div className="h-full bg-rose-300" style={{ width: `${100 - split}%` }} />
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <p className="text-neutral-500">{t('charity.splitBig', { a: split })}</p>
                    <p className="font-medium text-rose-600 dark:text-rose-400">{formatSum(bigBudget)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-neutral-500">{t('charity.splitSmall', { b: 100 - split })}</p>
                    <p className="font-medium text-rose-500 dark:text-rose-300">{formatSum(smallBudget)}</p>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-xs text-amber-600 dark:text-amber-400">{t('charity.noCat')}</p>
            )}
            <div className="flex items-center gap-2">
              <label className="text-xs text-neutral-500">{t('charity.bigShare')}</label>
              <input
                inputMode="numeric"
                value={String(split)}
                onChange={(e) =>
                  setSplit(Math.max(0, Math.min(100, Number(e.target.value.replace(/[^\d]/g, '')) || 0)))
                }
                onBlur={saveSplit}
                className="w-16 rounded-lg border border-neutral-300 bg-white px-2 py-1 text-center text-sm outline-none focus:border-rose-500 dark:border-neutral-700 dark:bg-neutral-950"
              />
              <span className="text-xs text-neutral-500">/ {100 - split}%</span>
            </div>
          </section>

          {/* Крупное пожертвование (цель с прогрессом + пополнение) */}
          <section className="flex flex-col gap-3">
            <hr className="border-neutral-200 dark:border-neutral-800" />
            <h2 className={sectionTitle}>{t('charity.bigTitle')}</h2>
            <div className="flex flex-col gap-3">
              {/* Список целей: главная сверху со звёздочкой, остальные ниже */}
              {goals.map((g) => {
                const got = collected[g.id] ?? 0
                const gpct = g.target > 0 ? Math.min(100, (got / g.target) * 100) : 0
                const left = Math.max(0, g.target - got)
                const tops = topUpsOf(g)
                return (
                  <div
                    key={g.id}
                    className={
                      'flex flex-col gap-3 rounded-2xl border p-4 ' +
                      (g.is_primary
                        ? 'border-rose-500/40 bg-rose-500/5 dark:bg-rose-500/10'
                        : 'border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/50')
                    }
                  >
                    {goalForm === g.id ? (
                      <form onSubmit={submitGoal} className="flex flex-col gap-2">
                        <input
                          value={formName}
                          onChange={(e) => setFormName(e.target.value)}
                          placeholder={t('charity.goalName')}
                          className={inputCls}
                        />
                        <input
                          inputMode="decimal"
                          value={formTarget}
                          onChange={(e) => setFormTarget(formatAmountInput(e.target.value))}
                          placeholder={t('charity.goalAmount')}
                          className={inputCls}
                        />
                        <div className="flex gap-2">
                          <button type="submit" className={btnPrimary}>
                            {t('charity.saveGoal')}
                          </button>
                          <button type="button" onClick={() => setGoalForm(null)} className={btnGhost}>
                            {t('common.cancel')}
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2">
                            <button
                              type="button"
                              onClick={() => makePrimary(g.id)}
                              disabled={g.is_primary}
                              className="shrink-0 text-lg leading-none transition hover:scale-110 disabled:cursor-default disabled:hover:scale-100"
                            >
                              {g.is_primary ? '⭐' : '☆'}
                            </button>
                            {g.name && <p className="truncate font-medium">{g.name}</p>}
                          </div>
                          <span className="shrink-0 text-sm font-semibold text-rose-600 dark:text-rose-400">
                            {Math.round(gpct)}%
                          </span>
                        </div>
                        <div className="h-2.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                          <div className="h-full rounded-full bg-rose-500" style={{ width: `${gpct}%` }} />
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <p className="text-neutral-500">{t('charity.collected')}</p>
                            <p className="font-medium text-rose-600 dark:text-rose-400">{formatSum(got)}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-neutral-500">{t('charity.left')}</p>
                            <p className="font-medium">{formatSum(left)}</p>
                          </div>
                        </div>
                        <p className="text-xs text-neutral-500">{t('charity.target', { v: formatSum(g.target) })}</p>
                        {g.is_primary && bigBudget > 0 && (
                          <p className="text-xs font-medium text-rose-600 dark:text-rose-400">
                            {t('charity.monthToBig', { v: formatSum(bigBudget) })}
                          </p>
                        )}

                        {bigOpen === g.id ? (
                          <form onSubmit={submitBig} className="flex flex-col gap-2">
                            <input
                              inputMode="decimal"
                              value={bigAmount}
                              onChange={(e) => setBigAmount(formatAmountInput(e.target.value))}
                              placeholder={t('charity.topUpAmount')}
                              className={inputCls}
                            />
                            <DatePicker value={bigDate} onChange={setBigDate} />
                            <div className="flex gap-2">
                              <button type="submit" disabled={busy} className={btnPrimary}>
                                {busy ? t('common.saving') : t('charity.topUp')}
                              </button>
                              <button type="button" onClick={() => setBigOpen(null)} className={btnGhost}>
                                {t('common.cancel')}
                              </button>
                            </div>
                          </form>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            {charityCat && (
                              <button type="button" onClick={() => openBigForm(g.id)} className={btnPrimary}>
                                {t('charity.topUp')}
                              </button>
                            )}
                            <IconButton icon="edit" title={t('charity.editGoal')} onClick={() => openGoalForm(g)} />
                            {confirmDelId === g.id ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => removeGoal(g.id)}
                                  className="rounded-lg bg-red-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-red-400"
                                >
                                  {t('common.delete')}
                                </button>
                                <button type="button" onClick={() => setConfirmDelId(null)} className={btnGhost}>
                                  {t('common.cancel')}
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDelId(g.id)}
                                className="text-sm text-red-500 transition hover:text-red-600 dark:text-red-400 dark:hover:text-red-300"
                              >
                                {t('common.delete')}
                              </button>
                            )}
                          </div>
                        )}

                        {tops.length > 0 && (
                          <details className="text-sm text-neutral-500">
                            <summary className="cursor-pointer">{t('charity.topUps', { n: tops.length })}</summary>
                            <div className="mt-3 flex flex-col gap-2">
                              {tops.map((c) => (
                                <div
                                  key={c.id}
                                  className="rounded-lg bg-neutral-100 px-3 py-2.5 text-sm dark:bg-neutral-800/50"
                                >
                                  {editId === c.id ? (
                                    <form onSubmit={submitEdit} className="flex flex-col gap-2">
                                      <input
                                        inputMode="decimal"
                                        value={editAmount}
                                        onChange={(e) => setEditAmount(formatAmountInput(e.target.value))}
                                        placeholder={t('charity.topUpAmount')}
                                        className={inputCls}
                                      />
                                      <DatePicker value={editDate} onChange={setEditDate} />
                                      <div className="flex gap-2">
                                        <button type="submit" disabled={busy} className={btnPrimary}>
                                          {busy ? t('common.saving') : t('common.save')}
                                        </button>
                                        <button type="button" onClick={cancelEdit} className={btnGhost}>
                                          {t('common.cancel')}
                                        </button>
                                      </div>
                                    </form>
                                  ) : (
                                    <div className="flex items-center justify-between gap-3">
                                      <span className="text-neutral-700 dark:text-neutral-300">
                                        {formatDateHuman(c.date)} · {formatSum(Number(c.amount))}
                                      </span>
                                      <div className="flex shrink-0 gap-3">
                                        <button
                                          onClick={() => startEdit(c)}
                                          className="text-neutral-500 transition hover:text-emerald-600 dark:hover:text-emerald-400"
                                        >
                                          {t('common.edit')}
                                        </button>
                                        <button
                                          onClick={() => removeItem(c.id)}
                                          className="text-red-500 transition hover:text-red-600 dark:text-red-400 dark:hover:text-red-300"
                                        >
                                          {t('common.delete')}
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </>
                    )}
                  </div>
                )
              })}

              {/* Целей пока нет */}
              {goals.length === 0 && goalForm === null && (
                <div className="flex flex-col gap-2 rounded-2xl border border-rose-500/40 bg-rose-500/5 p-4 dark:bg-rose-500/10">
                  <p className="text-sm text-neutral-500">{t('charity.noGoal')}</p>
                  <p className="text-xs text-neutral-500">{t('charity.inPot', { v: formatSum(pots.big) })}</p>
                </div>
              )}

              {/* Добавление новой цели */}
              {goalForm === 'new' ? (
                <form
                  onSubmit={submitGoal}
                  className="flex flex-col gap-2 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50"
                >
                  <input
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder={t('charity.goalName')}
                    className={inputCls}
                  />
                  <input
                    inputMode="decimal"
                    value={formTarget}
                    onChange={(e) => setFormTarget(formatAmountInput(e.target.value))}
                    placeholder={t('charity.goalAmount')}
                    className={inputCls}
                  />
                  <div className="flex gap-2">
                    <button type="submit" className={btnPrimary}>
                      {t('charity.saveGoal')}
                    </button>
                    <button type="button" onClick={() => setGoalForm(null)} className={btnGhost}>
                      {t('common.cancel')}
                    </button>
                  </div>
                </form>
              ) : (
                <button type="button" onClick={() => openGoalForm(null)} className={btnGhost + ' self-start'}>
                  {t('charity.setGoal')}
                </button>
              )}
            </div>
          </section>

          {/* Маленькие пожертвования (список «Кому / Сколько») */}
          <section className="flex flex-col gap-3">
            <hr className="border-neutral-200 dark:border-neutral-800" />
            <h2 className={sectionTitle}>{t('charity.smallTitle')}</h2>
            <div className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50">
              <p className="text-2xl font-semibold text-rose-600 dark:text-rose-400">{formatSum(pots.small)}</p>
              {smallBudget > 0 && (
                <p className="text-xs font-medium text-rose-600 dark:text-rose-400">
                  {t('charity.monthToSmall', { v: formatSum(smallBudget) })}
                </p>
              )}

              {charityCat ? (
                <form onSubmit={submitSmall} className="flex flex-col gap-2">
                  <input
                    value={smallTo}
                    onChange={(e) => setSmallTo(e.target.value)}
                    placeholder={t('charity.smallTo')}
                    className={inputCls}
                  />
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      inputMode="decimal"
                      value={smallAmount}
                      onChange={(e) => setSmallAmount(formatAmountInput(e.target.value))}
                      placeholder={t('charity.smallAmount')}
                      className={'flex-1 ' + fieldBase}
                    />
                    <div className="flex-1">
                      <DatePicker value={smallDate} onChange={setSmallDate} />
                    </div>
                  </div>
                  <button type="submit" disabled={busy} className={btnPrimary + ' self-start'}>
                    {busy ? t('common.saving') : t('charity.addSmall')}
                  </button>
                </form>
              ) : (
                <p className="text-xs text-amber-600 dark:text-amber-400">{t('charity.noCat')}</p>
              )}

              {smallDonations.length > 0 && (
                <div className="flex flex-col gap-2">
                  {smallDonations.map((c) => (
                    <div
                      key={c.id}
                      className="rounded-lg bg-neutral-100 px-3 py-2.5 text-sm dark:bg-neutral-800/50"
                    >
                      {editId === c.id ? (
                        <form onSubmit={submitEdit} className="flex flex-col gap-2">
                          <input
                            value={editTo}
                            onChange={(e) => setEditTo(e.target.value)}
                            placeholder={t('charity.smallTo')}
                            className={inputCls}
                          />
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <input
                              inputMode="decimal"
                              value={editAmount}
                              onChange={(e) => setEditAmount(formatAmountInput(e.target.value))}
                              placeholder={t('charity.smallAmount')}
                              className={'flex-1 ' + fieldBase}
                            />
                            <div className="flex-1">
                              <DatePicker value={editDate} onChange={setEditDate} />
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button type="submit" disabled={busy} className={btnPrimary}>
                              {busy ? t('common.saving') : t('common.save')}
                            </button>
                            <button type="button" onClick={cancelEdit} className={btnGhost}>
                              {t('common.cancel')}
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium text-rose-600 dark:text-rose-400">{formatSum(Number(c.amount))}</p>
                            <p className="text-xs text-neutral-500">
                              {c.description ? `${c.description} · ` : ''}
                              {formatDateHuman(c.date)}
                            </p>
                          </div>
                          <div className="flex shrink-0 gap-3">
                            <button
                              onClick={() => startEdit(c)}
                              className="text-neutral-500 transition hover:text-emerald-600 dark:hover:text-emerald-400"
                            >
                              {t('common.edit')}
                            </button>
                            <button
                              onClick={() => removeItem(c.id)}
                              className="text-red-500 transition hover:text-red-600 dark:text-red-400 dark:hover:text-red-300"
                            >
                              {t('common.delete')}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

            </div>
          </section>
        </>
      )}
    </div>
  )
}
