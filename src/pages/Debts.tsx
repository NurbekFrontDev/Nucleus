import { useEffect, useState, type FormEvent } from 'react'
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
}
type Payment = {
  id: string
  debt_id: string
  amount: number
  date: string
  expense_id: string | null
}
type Category = { id: string; name: string; archived?: boolean }

const DEBT_COLS = 'id, person, amount, note, archived, created_at'
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [person, setPerson] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
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

  useEffect(() => {
    if (!user) return
    let active = true
    ;(async () => {
      try {
        setLoading(true)
        const [dRes, pRes, cRes] = await Promise.all([
          supabase
            .from('debts')
            .select(DEBT_COLS)
            .eq('user_id', user.id)
            .order('created_at', { ascending: false }),
          supabase.from('debt_payments').select(PAYMENT_COLS).eq('user_id', user.id),
          supabase
            .from('categories')
            .select('id, name, archived')
            .eq('user_id', user.id)
            .order('sort_order'),
        ])
        if (!active) return
        if (dRes.error) throw dRes.error
        if (pRes.error) throw pRes.error
        if (cRes.error) throw cRes.error
        setDebts((dRes.data ?? []) as Debt[])
        setPayments((pRes.data ?? []) as Payment[])
        setCategories((cRes.data ?? []) as Category[])
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

  const paidFor = (debtId: string) =>
    payments.filter((p) => p.debt_id === debtId).reduce((s, p) => s + Number(p.amount), 0)

  const isDebtDone = (d: Debt) => {
    const total = Number(d.amount)
    return total > 0 && paidFor(d.id) >= total
  }

  const active = debts.filter((d) => !d.archived)
  const cleared = debts.filter((d) => d.archived)
  // Активные делим: ещё не выплаченные сверху, полностью выплаченные — вниз.
  const unpaid = active.filter((d) => !isDebtDone(d))
  const paidOff = active.filter((d) => isDebtDone(d))
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
    const { data, error } = await supabase
      .from('debts')
      .insert({
        user_id: user.id,
        person: person.trim(),
        amount: value,
        note: note.trim() || null,
        archived: false,
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

  // Удалить долг полностью. Платежи уходят (каскад в БД), но расходы остаются в истории.
  const deleteDebt = async (id: string) => {
    setDeleteId(null)
    const { error } = await supabase.from('debts').delete().eq('id', id)
    if (error) {
      setError(error.message)
      return
    }
    setDebts(debts.filter((d) => d.id !== id))
    setPayments(payments.filter((p) => p.debt_id !== id))
  }

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
      <div className="flex items-center justify-between">
        {embedded ? (
          <span />
        ) : (
          <h1 className="text-2xl font-semibold">💳 {t('debts.title')}</h1>
        )}
        {active.length > 0 && (
          <span className="text-sm text-neutral-500 dark:text-neutral-400">
            {t('debts.totalLeft', { v: formatSum(totalLeft) })}
          </span>
        )}
      </div>

      <form
        onSubmit={addDebt}
        className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50"
      >
        <p className="text-sm font-medium">{t('debts.add')}</p>
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

      {loading ? (
        <p className="text-neutral-500 dark:text-neutral-400">{t('common.loading')}</p>
      ) : (
        <>
          {active.length === 0 ? (
            <p className="text-sm text-neutral-500">{t('debts.empty')}</p>
          ) : (
            <>
              {unpaid.length > 0 && (
                <section className="flex flex-col gap-3">{unpaid.map(renderDebt)}</section>
              )}

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
