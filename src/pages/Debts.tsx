import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import DatePicker from '../components/DatePicker'
import ConfirmDialog from '../components/ConfirmDialog'
import { useLang } from '../lib/i18n'
import {
  formatSum,
  formatAmountInput,
  parseAmount,
  formatDateHuman,
  getOrCreateMonth,
} from '../lib/db'

type Debt = {
  id: string
  person: string
  amount: number
  note: string | null
  archived: boolean
  created_at: string
  sort_order: number
}
type Payment = {
  id: string
  debt_id: string
  amount: number
  date: string
  expense_id: string | null
}
type Category = { id: string; name: string; percent?: number; archived?: boolean }

const DEBT_COLS = 'id, person, amount, note, archived, created_at, sort_order'
const PAYMENT_COLS = 'id, debt_id, amount, date, expense_id'

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

export default function Debts({ embedded = false }: { embedded?: boolean }) {
  const { user } = useAuth()
  const { t } = useLang()

  const [debts, setDebts] = useState<Debt[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  // Доход за текущий месяц — нужен, чтобы посчитать бюджет категории «Долги» (её % от дохода).
  const [received, setReceived] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [person, setPerson] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  // Форма добавления долга по умолчанию свёрнута; раскрывается по нажатию.
  const [formOpen, setFormOpen] = useState(false)
  // Отдельное состояние для записи платежа, чтобы не крутилась кнопка «Добавить».
  const [paying, setPaying] = useState(false)

  const [editId, setEditId] = useState<string | null>(null)
  const [editPerson, setEditPerson] = useState('')
  const [editAmount, setEditAmount] = useState('')
  const [editNote, setEditNote] = useState('')

  const [payFormId, setPayFormId] = useState<string | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10))

  const [clearOpen, setClearOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  // Режим перемещения: перетаскивать долги можно только когда он включён.
  // На телефоне это защищает от случайного перетаскивания во время прокрутки.
  const [reorder, setReorder] = useState(false)

  // Перетаскивание долгов (тот же механизм, что в «Бюджете»).
  //  · active=false пока палец не сдвинулся больше порога.
  //  · active=true — настоящее перетаскивание: соседи плавно расступаются.
  //  · settling=true — карточка плавно «доезжает» в слот при отпускании.
  type DragState = {
    id: string
    fromIndex: number
    overIndex: number
    startY: number
    offset: number
    slot: number
    active: boolean
    settling: boolean
  }
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const settleTimer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (settleTimer.current) window.clearTimeout(settleTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!user) return
    let active = true
    ;(async () => {
      try {
        setLoading(true)
        const now = new Date()
        const m = await getOrCreateMonth(user.id, now.getFullYear(), now.getMonth() + 1)
        const [dRes, pRes, cRes, incRes] = await Promise.all([
          supabase
            .from('debts')
            .select(DEBT_COLS)
            .eq('user_id', user.id)
            .order('sort_order', { ascending: true }),
          supabase.from('debt_payments').select(PAYMENT_COLS).eq('user_id', user.id),
          supabase
            .from('categories')
            .select('id, name, percent, archived')
            .eq('user_id', user.id)
            .order('sort_order'),
          supabase.from('incomes').select('amount').eq('month_id', m.id),
        ])
        if (!active) return
        if (dRes.error) throw dRes.error
        if (pRes.error) throw pRes.error
        if (cRes.error) throw cRes.error
        if (incRes.error) throw incRes.error
        setDebts((dRes.data ?? []) as Debt[])
        setPayments((pRes.data ?? []) as Payment[])
        setCategories((cRes.data ?? []) as Category[])
        setReceived(
          (incRes.data ?? []).reduce((s: number, r: { amount: number }) => s + Number(r.amount), 0),
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
  }, [user])

  // Категория «Долги» — в неё попадают платежи как расходы.
  const debtCategory = categories.find(
    (c) => !c.archived && (c.name === 'Долги' || c.name.toLowerCase().startsWith('долг')),
  )

  // Бюджет категории «Долги» в этом месяце (её % от дохода) и сколько из него уже выплачено.
  const debtPercent = debtCategory ? Number(debtCategory.percent ?? 0) : 0
  const debtsBudget = (received * debtPercent) / 100
  const ymPrefix = new Date().toISOString().slice(0, 7)
  const paidThisMonth = payments
    .filter((p) => (p.date ?? '').startsWith(ymPrefix))
    .reduce((s, p) => s + Number(p.amount), 0)

  const paidFor = (debtId: string) =>
    payments.filter((p) => p.debt_id === debtId).reduce((s, p) => s + Number(p.amount), 0)

  const isDebtDone = (d: Debt) => {
    const total = Number(d.amount)
    return total > 0 && paidFor(d.id) >= total
  }

  const active = debts.filter((d) => !d.archived)
  const cleared = debts.filter((d) => d.archived)
  // Активные делим: ещё не выплаченные сверху, полностью выплаченные — вниз.
  // Внутри групп — по ручному порядку (sort_order), чтобы важные были выше.
  const bySort = (a: Debt, b: Debt) => a.sort_order - b.sort_order
  const unpaid = active.filter((d) => !isDebtDone(d)).sort(bySort)
  const paidOff = active.filter((d) => isDebtDone(d)).sort(bySort)
  const totalLeft = active.reduce(
    (s, d) => s + Math.max(0, Number(d.amount) - paidFor(d.id)),
    0,
  )

  const addDebt = async (e: FormEvent) => {
    e.preventDefault()
    if (!user) return
    if (!person.trim()) {
      setError(t('debts.errPerson'))
      return
    }
    const value = parseAmount(amount)
    if (!value) {
      setError(t('debts.errAmount'))
      return
    }
    setBusy(true)
    setError(null)
    // Новый долг кладём наверх списка (самый маленький sort_order).
    const minOrder = debts.reduce((m, d) => Math.min(m, d.sort_order), 0)
    const { data, error } = await supabase
      .from('debts')
      .insert({
        user_id: user.id,
        person: person.trim(),
        amount: value,
        note: note.trim() || null,
        archived: false,
        sort_order: minOrder - 1,
      })
      .select(DEBT_COLS)
      .single()
    setBusy(false)
    if (error || !data) {
      setError(error?.message ?? t('debts.errAdd'))
      return
    }
    setDebts([data as Debt, ...debts])
    setPerson('')
    setAmount('')
    setNote('')
  }

  const startEdit = (d: Debt) => {
    setEditId(d.id)
    setEditPerson(d.person)
    setEditAmount(formatAmountInput(String(d.amount)))
    setEditNote(d.note ?? '')
    setError(null)
  }

  const saveEdit = async (id: string) => {
    if (!editPerson.trim()) {
      setError(t('debts.errPerson'))
      return
    }
    const value = parseAmount(editAmount)
    if (!value) {
      setError(t('debts.errAmount'))
      return
    }
    const { data, error } = await supabase
      .from('debts')
      .update({ person: editPerson.trim(), amount: value, note: editNote.trim() || null })
      .eq('id', id)
      .select(DEBT_COLS)
      .single()
    if (error || !data) {
      setError(error?.message ?? t('common.editFailed'))
      return
    }
    setDebts(debts.map((d) => (d.id === id ? (data as Debt) : d)))
    setEditId(null)
  }

  const openPayForm = (d: Debt) => {
    setPayFormId(d.id)
    const remaining = Math.max(0, Number(d.amount) - paidFor(d.id))
    setPayAmount(remaining > 0 ? formatAmountInput(String(remaining)) : '')
    setPayDate(new Date().toISOString().slice(0, 10))
    setError(null)
  }

  // Записать платёж: создаём расход в категории «Долги» и связанный платёж.
  const confirmPay = async (d: Debt) => {
    if (!user) return
    const value = parseAmount(payAmount)
    if (!value) {
      setError(t('debts.errPayAmount'))
      return
    }
    setPaying(true)
    setError(null)
    try {
      const dt = new Date(payDate + 'T00:00:00')
      const month = await getOrCreateMonth(user.id, dt.getFullYear(), dt.getMonth() + 1)
      const { data: exp, error: expErr } = await supabase
        .from('expenses')
        .insert({
          user_id: user.id,
          month_id: month.id,
          category_id: debtCategory?.id ?? null,
          amount: value,
          date: payDate,
          description: 'Долг: ' + d.person,
        })
        .select('id')
        .single()
      if (expErr || !exp) throw expErr ?? new Error(t('common.saveFailed'))
      const { data, error } = await supabase
        .from('debt_payments')
        .insert({
          user_id: user.id,
          debt_id: d.id,
          amount: value,
          date: payDate,
          expense_id: (exp as { id: string }).id,
        })
        .select(PAYMENT_COLS)
        .single()
      if (error || !data) throw error ?? new Error(t('common.error'))
      setPayments([...payments, data as Payment])
      setPayFormId(null)
      setPayAmount('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPaying(false)
    }
  }

  // Удалить платёж: убираем и связанный расход (чтобы не задваивалось).
  const removePayment = async (p: Payment) => {
    if (p.expense_id) {
      await supabase.from('expenses').delete().eq('id', p.expense_id)
    }
    const { error } = await supabase.from('debt_payments').delete().eq('id', p.id)
    if (error) {
      setError(error.message)
      return
    }
    setPayments(payments.filter((x) => x.id !== p.id))
  }

  // Вернуть полностью выплаченный долг в активные: убираем последний платёж (и связанный расход).
  const undoLastPayment = async (d: Debt) => {
    const last = payments
      .filter((p) => p.debt_id === d.id)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))[0]
    if (last) await removePayment(last)
  }

  // Очистить долги: прячем активные долги (archived), но платежи и расходы остаются в истории.
  const clearAll = async () => {
    if (!user) return
    const { error } = await supabase
      .from('debts')
      .update({ archived: true })
      .eq('user_id', user.id)
      .eq('archived', false)
    setClearOpen(false)
    if (error) {
      setError(error.message)
      return
    }
    setDebts(debts.map((d) => (d.archived ? d : { ...d, archived: true })))
  }

  const restoreDebt = async (id: string) => {
    const { data, error } = await supabase
      .from('debts')
      .update({ archived: false })
      .eq('id', id)
      .select(DEBT_COLS)
      .single()
    if (error || !data) {
      setError(error?.message ?? t('common.error'))
      return
    }
    setDebts(debts.map((d) => (d.id === id ? (data as Debt) : d)))
  }

  // Удалить долг полностью вместе с его расходами в Истории: сначала удаляем расходы,
  // привязанные к платежам этого долга, потом сам долг (платежи уйдут каскадом в БД).
  // Так после удаления долга в Истории не остаётся «висящих» трат по нему.
  const deleteDebt = async (id: string) => {
    setDeleteId(null)
    const expenseIds = payments
      .filter((p) => p.debt_id === id && p.expense_id)
      .map((p) => p.expense_id as string)
    if (expenseIds.length > 0) {
      const { error: expErr } = await supabase.from('expenses').delete().in('id', expenseIds)
      if (expErr) {
        setError(expErr.message)
        return
      }
    }
    const { error } = await supabase.from('debts').delete().eq('id', id)
    if (error) {
      setError(error.message)
      return
    }
    setDebts(debts.filter((d) => d.id !== id))
    setPayments(payments.filter((p) => p.debt_id !== id))
  }

  // Сохраняет новый порядок долгов в БД.
  const persistOrder = async (reordered: Debt[]) => {
    const results = await Promise.all(
      reordered.map((d) =>
        supabase.from('debts').update({ sort_order: d.sort_order }).eq('id', d.id),
      ),
    )
    const failed = results.find((r) => r.error)
    if (failed?.error) setError(failed.error.message)
  }

  // Нажатие на ручку: запоминаем старт. Пока палец не сдвинулся — это ещё не перетаскивание.
  const startDrag = (e: React.PointerEvent, id: string, index: number) => {
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const el = rowRefs.current.get(id)
    const slot = (el?.offsetHeight ?? 64) + 8
    const next: DragState = {
      id,
      fromIndex: index,
      overIndex: index,
      startY: e.clientY,
      offset: 0,
      slot,
      active: false,
      settling: false,
    }
    dragRef.current = next
    setDrag(next)
  }

  // Движение: после порога (6px) — настоящий драг; карточка следует за пальцем.
  const moveDrag = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d || d.settling) return
    const offset = e.clientY - d.startY
    const isActive = d.active || Math.abs(offset) > 6
    const steps = Math.round(offset / d.slot)
    const overIndex = Math.max(0, Math.min(unpaid.length - 1, d.fromIndex + steps))
    if (offset === d.offset && overIndex === d.overIndex && isActive === d.active) return
    const next: DragState = { ...d, offset, overIndex, active: isActive }
    dragRef.current = next
    setDrag(next)
  }

  // Отпускание: если не было движения — ничего не делаем. Иначе плавно доводим
  // карточку в слот, потом фиксируем порядок.
  const endDrag = (e?: React.PointerEvent) => {
    if (e) {
      try {
        ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
      } catch {
        // уже отпущен
      }
    }
    const d = dragRef.current
    if (!d) return
    if (!d.active) {
      dragRef.current = null
      setDrag(null)
      return
    }
    const slot = d.slot
    const targetOffset = (d.overIndex - d.fromIndex) * slot
    const settling: DragState = { ...d, settling: true, offset: targetOffset }
    dragRef.current = settling
    setDrag(settling)

    const order = unpaid
    if (settleTimer.current) window.clearTimeout(settleTimer.current)
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = null
      if (d.overIndex !== d.fromIndex) {
        const next = order.slice()
        const [moved] = next.splice(d.fromIndex, 1)
        next.splice(d.overIndex, 0, moved)
        const reordered = next.map((dd, i) => ({ ...dd, sort_order: i + 1 }))
        setDebts((prev) =>
          prev.map((dd) => {
            const found = reordered.find((r) => r.id === dd.id)
            return found ? { ...dd, sort_order: found.sort_order } : dd
          }),
        )
        void persistOrder(reordered)
      }
      dragRef.current = null
      setDrag(null)
    }, 210)
  }

  // Стиль карточки во время перетаскивания.
  const dragStyle = (id: string, index: number): React.CSSProperties | undefined => {
    if (!drag || !drag.active) return undefined
    if (id === drag.id) {
      return {
        transform: `translateY(${drag.offset}px) scale(${drag.settling ? 1 : 1.03})`,
        transition: drag.settling ? 'transform 200ms cubic-bezier(0.2, 0, 0, 1)' : 'none',
        position: 'relative',
        zIndex: 30,
      }
    }
    let shift = 0
    if (drag.overIndex > drag.fromIndex && index > drag.fromIndex && index <= drag.overIndex)
      shift = -drag.slot
    else if (drag.overIndex < drag.fromIndex && index >= drag.overIndex && index < drag.fromIndex)
      shift = drag.slot
    return {
      transform: `translateY(${shift}px)`,
      transition: 'transform 200ms cubic-bezier(0.2, 0, 0, 1)',
    }
  }

  // Ручка слева — только перетаскивание (в режиме перемещения).
  const grip = (id: string, index: number) => (
    <button
      type="button"
      aria-label={t('debts.dragHint')}
      title={t('debts.dragHint')}
      onPointerDown={(e) => startDrag(e, id, index)}
      onPointerMove={moveDrag}
      onPointerUp={(e) => endDrag(e)}
      onPointerCancel={(e) => endDrag(e)}
      className="shrink-0 cursor-grab touch-none select-none px-1 text-lg leading-none text-neutral-400 transition hover:text-neutral-600 active:cursor-grabbing dark:text-neutral-500 dark:hover:text-neutral-300"
    >
      ⠿
    </button>
  )

  const renderDebt = (d: Debt) => {
    const paid = paidFor(d.id)
    const total = Number(d.amount)
    const pct = total > 0 ? Math.min(100, (paid / total) * 100) : 0
    const remaining = Math.max(0, total - paid)
    const done = remaining <= 0 && total > 0
    const debtPayments = payments
      .filter((p) => p.debt_id === d.id)
      .sort((a, b) => (a.date < b.date ? 1 : -1))
    return (
      <div
        key={d.id}
        className={
          'flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50' +
          (done ? ' opacity-80' : '')
        }
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className={'font-medium' + (done ? ' text-neutral-500 line-through dark:text-neutral-400' : '')}>
                {d.person}
              </p>
              {done && (
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-600 dark:text-emerald-400">
                  {t('debts.paidOff')}
                </span>
              )}
            </div>
            {d.note && <p className="text-xs text-neutral-500">{d.note}</p>}
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
            <p className="text-neutral-500">{t('debts.paid')}</p>
            <p className="font-medium text-emerald-600 dark:text-emerald-400">{formatSum(paid)}</p>
          </div>
          <div>
            <p className="text-neutral-500">{t('debts.left')}</p>
            <p className="font-medium">{formatSum(remaining)}</p>
          </div>
          <div className="text-right">
            <p className="text-neutral-500">{t('debts.amount')}</p>
            <p className="font-medium">{formatSum(total)}</p>
          </div>
        </div>

        {editId === d.id ? (
          <div className="flex flex-col gap-2">
            <input
              value={editPerson}
              onChange={(e) => setEditPerson(e.target.value)}
              placeholder={t('debts.person')}
              className={inputCls}
            />
            <input
              inputMode="decimal"
              value={editAmount}
              onChange={(e) => setEditAmount(formatAmountInput(e.target.value))}
              placeholder={t('debts.amount')}
              className={inputCls}
            />
            <input
              value={editNote}
              onChange={(e) => setEditNote(e.target.value)}
              placeholder={t('debts.note')}
              className={inputCls}
            />
            <div className="flex gap-2">
              <button onClick={() => saveEdit(d.id)} className={btnPrimary}>
                {t('common.save')}
              </button>
              <button onClick={() => setEditId(null)} className={btnGhost}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : payFormId === d.id ? (
          <div className="flex flex-col gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3">
            <input
              inputMode="decimal"
              value={payAmount}
              onChange={(e) => setPayAmount(formatAmountInput(e.target.value))}
              placeholder={t('debts.payAmount')}
              className={inputCls}
            />
            <DatePicker value={payDate} onChange={setPayDate} />
            <p className="text-xs text-neutral-500">{t('debts.payHint')}</p>
            {!debtCategory && (
              <p className="text-xs text-amber-600 dark:text-amber-400">{t('debts.noCat')}</p>
            )}
            <div className="flex flex-wrap gap-2">
              <button onClick={() => confirmPay(d)} disabled={paying} className={btnPrimary}>
                {paying ? t('common.saving') : t('debts.pay')}
              </button>
              <button onClick={() => setPayFormId(null)} className={btnGhost}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : done ? (
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => undoLastPayment(d)} className={btnGhost}>
              {t('debts.undo')}
            </button>
            <button onClick={() => setDeleteId(d.id)} className={btnMuted}>
              {t('common.delete')}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => openPayForm(d)} className={btnPrimary}>
              {t('debts.payBtn')}
            </button>
            <button onClick={() => startEdit(d)} className={btnGhost}>
              {t('common.edit')}
            </button>
            <button onClick={() => setDeleteId(d.id)} className={btnMuted}>
              {t('common.delete')}
            </button>
          </div>
        )}

        {debtPayments.length > 0 && (
          <details className="text-sm text-neutral-500">
            <summary className="cursor-pointer">
              {t('debts.payments', { n: debtPayments.length })}
            </summary>
            <div className="mt-3 flex flex-col gap-2">
              {debtPayments.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-3 rounded-lg bg-neutral-100 px-3 py-2.5 text-sm dark:bg-neutral-800/50"
                >
                  <span className="text-neutral-700 dark:text-neutral-300">
                    {formatDateHuman(p.date)} · {formatSum(Number(p.amount))}
                  </span>
                  <button
                    onClick={() => removePayment(p)}
                    className="shrink-0 text-red-500 transition hover:text-red-600 dark:text-red-400 dark:hover:text-red-300"
                  >
                    {t('common.delete')}
                  </button>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    )
  }

  const deleteTarget = deleteId ? debts.find((d) => d.id === deleteId) : null

  return (
    <div className="flex flex-col gap-6">
      <div
        className={
          embedded
            ? 'flex flex-wrap items-center justify-between gap-x-3 gap-y-1'
            : 'sticky top-0 z-20 -mx-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-neutral-200/70 bg-white/85 px-4 py-3 backdrop-blur dark:border-neutral-800/70 dark:bg-neutral-950/85'
        }
      >
        {embedded ? (
          <span />
        ) : (
          <h1 className="text-2xl font-semibold">💳 {t('debts.title')}</h1>
        )}
        {(active.length > 0 || (debtCategory && debtsBudget > 0)) && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-neutral-500 dark:text-neutral-400">
            {active.length > 0 && (
              <span>{t('debts.totalLeft', { v: formatSum(totalLeft) })}</span>
            )}
            {active.length > 0 && debtCategory && debtsBudget > 0 && (
              <span aria-hidden className="text-neutral-300 dark:text-neutral-700">
                ·
              </span>
            )}
            {debtCategory && debtsBudget > 0 && (
              <span>
                {t('debts.paidThisMonth', { v: formatSum(paidThisMonth), b: formatSum(debtsBudget) })}
              </span>
            )}
          </div>
        )}
      </div>

      {!formOpen ? (
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          className="flex w-full items-center justify-between rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm font-medium transition hover:border-emerald-400 dark:border-neutral-800 dark:bg-neutral-900/50 dark:hover:border-emerald-600"
        >
          <span>＋ {t('debts.add')}</span>
          <span className="text-neutral-400">▾</span>
        </button>
      ) : (
      <form
        onSubmit={addDebt}
        className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50"
      >
        <button
          type="button"
          onClick={() => setFormOpen(false)}
          className="flex items-center justify-between text-sm font-medium text-neutral-500 transition hover:text-neutral-800 dark:hover:text-neutral-200"
        >
          <span>＋ {t('debts.add')}</span>
          <span className="text-neutral-400">▴</span>
        </button>
        <input
          value={person}
          onChange={(e) => setPerson(e.target.value)}
          placeholder={t('debts.person')}
          className={inputCls}
        />
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(formatAmountInput(e.target.value))}
          placeholder={t('debts.amount')}
          className={inputCls}
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('debts.note')}
          className={inputCls}
        />
        {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="self-start rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-60"
        >
          {busy ? t('debts.adding') : t('common.add')}
        </button>
      </form>
      )}

      {loading ? (
        <p className="text-neutral-500 dark:text-neutral-400">{t('common.loading')}</p>
      ) : (
        <>
          {active.length === 0 ? (
            <p className="text-sm text-neutral-500">{t('debts.empty')}</p>
          ) : (
            <>
              {unpaid.length > 1 && (
                <button
                  type="button"
                  onClick={() => setReorder((v) => !v)}
                  className={`self-start rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                    reorder
                      ? 'bg-emerald-500 text-neutral-950 hover:bg-emerald-400'
                      : 'border border-neutral-300 text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800'
                  }`}
                >
                  {reorder ? t('common.reorderDone') : t('common.reorder')}
                </button>
              )}

              {unpaid.length > 0 &&
                (reorder ? (
                  <section className="flex flex-col gap-2">
                    {unpaid.map((d, index) => (
                      <div
                        key={d.id}
                        ref={(el) => {
                          if (el) rowRefs.current.set(d.id, el)
                          else rowRefs.current.delete(d.id)
                        }}
                        style={dragStyle(d.id, index)}
                        className={`relative flex items-center gap-2 rounded-xl border bg-neutral-50 px-3 py-3 dark:bg-neutral-900/40 ${
                          drag?.id === d.id && drag.active
                            ? 'border-emerald-500/60 shadow-xl ring-1 ring-emerald-500/40'
                            : 'border-neutral-200 dark:border-neutral-800'
                        }`}
                      >
                        {grip(d.id, index)}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{d.person}</p>
                          {d.note && <p className="truncate text-xs text-neutral-500">{d.note}</p>}
                        </div>
                        <span className="shrink-0 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                          {formatSum(Math.max(0, Number(d.amount) - paidFor(d.id)))}
                        </span>
                      </div>
                    ))}
                  </section>
                ) : (
                  <section className="flex flex-col gap-3">{unpaid.map(renderDebt)}</section>
                ))}

              {paidOff.length > 0 && (
                <section className="flex flex-col gap-3">
                  <hr className="border-neutral-200 dark:border-neutral-800" />
                  <h2 className={sectionTitle}>{t('debts.paidSection')}</h2>
                  {paidOff.map(renderDebt)}
                </section>
              )}

              <button
                onClick={() => setClearOpen(true)}
                className="self-start text-sm text-red-500 transition hover:text-red-600 dark:text-red-400 dark:hover:text-red-300"
              >
                {t('debts.clear')}
              </button>
            </>
          )}

          {cleared.length > 0 && (
            <section className="flex flex-col gap-3">
              <hr className="border-neutral-200 dark:border-neutral-800" />
              <h2 className={sectionTitle}>{t('debts.cleared')}</h2>
              {cleared.map((d) => {
                const paid = paidFor(d.id)
                return (
                  <div
                    key={d.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 opacity-70 dark:border-neutral-800 dark:bg-neutral-900/40"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{d.person}</p>
                      <p className="text-xs text-neutral-500">
                        {t('debts.paid')}: {formatSum(paid)} / {formatSum(Number(d.amount))}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-3 text-sm text-neutral-500">
                      <button
                        onClick={() => restoreDebt(d.id)}
                        className="transition hover:text-neutral-900 dark:hover:text-neutral-100"
                      >
                        {t('goals.restore')}
                      </button>
                      <button
                        onClick={() => setDeleteId(d.id)}
                        className="text-red-500 transition hover:text-red-600 dark:text-red-400 dark:hover:text-red-300"
                      >
                        {t('common.delete')}
                      </button>
                    </div>
                  </div>
                )
              })}
            </section>
          )}
        </>
      )}

      <ConfirmDialog
        open={clearOpen}
        danger
        title={t('debts.clearTitle')}
        message={t('debts.clearMsg')}
        confirmLabel={t('debts.clear')}
        onConfirm={clearAll}
        onCancel={() => setClearOpen(false)}
      />
      <ConfirmDialog
        open={!!deleteId}
        danger
        title={t('debts.deleteTitle')}
        message={deleteTarget ? t('debts.deleteMsg', { n: deleteTarget.person }) : ''}
        confirmLabel={t('common.delete')}
        onConfirm={() => deleteId && deleteDebt(deleteId)}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  )
}
