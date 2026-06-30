import { Fragment, useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import Combobox from '../components/Combobox'
import DatePicker from '../components/DatePicker'
import PeriodFilter, { type PeriodValue } from '../components/PeriodFilter'
import IconButton from '../components/IconButton'
import { useLang } from '../lib/i18n'
import {
  getOrCreateMonth,
  formatSum,
  formatDateHuman,
  formatAmountInput,
  parseAmount,
  monthName,
  INCOME_SOURCE_PRESETS,
  effectivePresets,
  renamePreset,
  deletePreset,
} from '../lib/db'

type Income = {
  id: string
  amount: number
  date: string
  description: string | null
  source: string | null
  created_at: string
}

const INCOME_COLS = 'id, amount, date, description, source, created_at'

const inputCls =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950'

const chipCls = (active: boolean) =>
  `rounded-full border px-3 py-1 text-xs transition ${
    active
      ? 'border-emerald-500 bg-emerald-500 font-medium text-neutral-950'
      : 'border-neutral-300 text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800'
  }`

export default function Incomes() {
  const { user } = useAuth()
  const { t, tr } = useLang()
  const todayISO = new Date().toISOString().slice(0, 10)

  const [period, setPeriod] = useState<PeriodValue | null>(null)
  const [items, setItems] = useState<Income[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortOrder, setSortOrder] = useState<'new' | 'old'>('new')

  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayISO)
  const [source, setSource] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  const [editId, setEditId] = useState<string | null>(null)
  const [editAmount, setEditAmount] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editSource, setEditSource] = useState('')
  const [editDescription, setEditDescription] = useState('')

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
  const sourceOptions = Array.from(
    new Set([...usedSources, ...effectivePresets('src', INCOME_SOURCE_PRESETS)]),
  )

  // Переименовать источник: обновляем подсказку и все записи с этим источником.
  const renameSource = async (oldV: string, newV: string) => {
    const v = newV.trim()
    if (!user || !v || v === oldV) return
    renamePreset('src', INCOME_SOURCE_PRESETS, oldV, v)
    await supabase.from('incomes').update({ source: v }).eq('user_id', user.id).eq('source', oldV)
    setItems((prev) => prev.map((i) => (i.source === oldV ? { ...i, source: v } : i)))
    if (source === oldV) setSource(v)
    if (editSource === oldV) setEditSource(v)
  }

  // Удалить источник: убираем подсказку и очищаем источник у записей (суммы остаются).
  const deleteSource = async (v: string) => {
    if (!user) return
    deletePreset('src', INCOME_SOURCE_PRESETS, v)
    await supabase.from('incomes').update({ source: null }).eq('user_id', user.id).eq('source', v)
    setItems((prev) => prev.map((i) => (i.source === v ? { ...i, source: null } : i)))
    if (source === v) setSource('')
    if (editSource === v) setEditSource('')
  }

  const inPeriod = (d: string) => !period || (d >= period.start && d <= period.end)

  const addIncome = async (e: FormEvent) => {
    e.preventDefault()
    if (!user) return
    const original = parseAmount(amount)
    if (!original || original <= 0) {
      setError(t('common.enterPositive'))
      return
    }
    setBusy(true)
    setError(null)
    const d = new Date(date + 'T00:00:00')
    const m = await getOrCreateMonth(user.id, d.getFullYear(), d.getMonth() + 1)
    const { data, error } = await supabase
      .from('incomes')
      .insert({
        user_id: user.id,
        month_id: m.id,
        amount: original,
        date,
        source: source || null,
        description: description || null,
      })
      .select(INCOME_COLS)
      .single()
    setBusy(false)
    if (error || !data) {
      setError(error?.message ?? t('common.saveFailed'))
      return
    }
    if (inPeriod((data as Income).date)) setItems([data as Income, ...items])
    setAmount('')
    setSource('')
    setDescription('')
  }

  const startEdit = (i: Income) => {
    setEditId(i.id)
    setEditAmount(formatAmountInput(String(i.amount)))
    setEditDate(i.date)
    setEditSource(i.source ?? '')
    setEditDescription(i.description ?? '')
    setError(null)
  }

  const saveEdit = async (id: string) => {
    const original = parseAmount(editAmount)
    if (!original || original <= 0) {
      setError(t('common.enterPositive'))
      return
    }
    const { data, error } = await supabase
      .from('incomes')
      .update({
        amount: original,
        date: editDate,
        source: editSource || null,
        description: editDescription || null,
      })
      .eq('id', id)
      .select(INCOME_COLS)
      .single()
    if (error || !data) {
      setError(error?.message ?? t('common.editFailed'))
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
      <div className="sticky top-0 z-20 -mx-4 flex flex-col gap-3 border-b border-neutral-200/70 bg-white/85 px-4 py-3 backdrop-blur dark:border-neutral-800/70 dark:bg-neutral-950/85">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">💼 {t('inc.title')}</h1>
          <span className="text-sm text-neutral-500 dark:text-neutral-400">
            {t('inc.total')}{' '}
            <b className="text-emerald-600 dark:text-emerald-400">{formatSum(total)}</b>
          </span>
        </div>
        <PeriodFilter onChange={setPeriod} />
      </div>

      <form
        onSubmit={addIncome}
        className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50"
      >
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(formatAmountInput(e.target.value))}
          placeholder={t('common.amount')}
          className={inputCls}
        />
        <DatePicker value={date} onChange={setDate} />
        <Combobox
          value={source}
          onChange={setSource}
          options={sourceOptions}
          placeholder={t('inc.source')}
          onRenameOption={renameSource}
          onDeleteOption={deleteSource}
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('common.descOptional')}
          className={inputCls}
        />
        {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-emerald-500 px-4 py-2.5 font-medium text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-60"
        >
          {busy ? t('common.saving') : t('inc.addBtn')}
        </button>
      </form>

      {loading ? (
        <p className="text-neutral-500 dark:text-neutral-400">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-neutral-500">{t('inc.empty')}</p>
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
                <input
                  inputMode="decimal"
                  value={editAmount}
                  onChange={(e) => setEditAmount(formatAmountInput(e.target.value))}
                  placeholder={t('common.amount')}
                  className={inputCls}
                />
                <DatePicker value={editDate} onChange={setEditDate} />
                <Combobox
                  value={editSource}
                  onChange={setEditSource}
                  options={sourceOptions}
                  placeholder={t('inc.sourceShort')}
                  onRenameOption={renameSource}
                  onDeleteOption={deleteSource}
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
                    {formatDateHuman(i.date)}
                    {i.source ? ` · ${tr(i.source)}` : ''}
                    {i.description ? ` · ${i.description}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <IconButton icon="edit" title={t('common.edit')} onClick={() => startEdit(i)} />
                  <IconButton icon="delete" title={t('common.delete')} onClick={() => removeIncome(i.id)} />
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
