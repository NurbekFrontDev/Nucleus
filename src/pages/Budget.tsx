import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import ConfirmDialog from '../components/ConfirmDialog'
import {
  getOrCreateMonth,
  formatSum,
  MONTH_NAMES,
  formatAmountInput,
  parseAmount,
} from '../lib/db'

type Category = { id: string; name: string; percent: number; sort_order: number; archived?: boolean }

const inputCls =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950'

export default function Budget() {
  const { user } = useAuth()
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1

  const [monthId, setMonthId] = useState<string | null>(null)
  const [goalIncome, setGoalIncome] = useState('')
  const [received, setReceived] = useState(0)
  const [categories, setCategories] = useState<Category[]>([])
  const [newCatName, setNewCatName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  // Управление категориями: меню «три точки», переименование, удаление.
  const [menuId, setMenuId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    let active = true
    ;(async () => {
      try {
        setLoading(true)
        const m = await getOrCreateMonth(user.id, year, month)
        const [catRes, incRes] = await Promise.all([
          supabase
            .from('categories')
            .select('id, name, percent, sort_order, archived')
            .eq('user_id', user.id)
            .eq('archived', false)
            .order('sort_order'),
          supabase.from('incomes').select('amount').eq('month_id', m.id),
        ])
        if (!active) return
        if (catRes.error) throw catRes.error
        if (incRes.error) throw incRes.error
        setMonthId(m.id)
        setGoalIncome(m.planned_income ? formatAmountInput(String(m.planned_income)) : '')
        setReceived(
          (incRes.data ?? []).reduce(
            (s: number, r: { amount: number }) => s + Number(r.amount),
            0,
          ),
        )
        setCategories(
          ((catRes.data ?? []) as Category[]).map((c) => ({
            ...c,
            percent: Number(c.percent),
          })),
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
  }, [user, year, month])

  const goal = parseAmount(goalIncome)
  const totalPercent = categories.reduce((s, c) => s + Number(c.percent), 0)

  const setPercent = (id: string, val: string) => {
    setCategories((cs) =>
      cs.map((c) => (c.id === id ? { ...c, percent: Number(val) || 0 } : c)),
    )
    setSaved(false)
  }

  const addCategory = async () => {
    if (!user || !newCatName.trim()) return
    const maxOrder = categories.reduce((m, c) => Math.max(m, c.sort_order), 0)
    const { data, error: addErr } = await supabase
      .from('categories')
      .insert({ user_id: user.id, name: newCatName.trim(), percent: 0, sort_order: maxOrder + 1 })
      .select('id, name, percent, sort_order, archived')
      .single()
    if (addErr || !data) {
      setError(addErr?.message ?? 'Не удалось добавить категорию')
      return
    }
    const c = data as Category
    setCategories([...categories, { ...c, percent: Number(c.percent) }])
    setNewCatName('')
    setError(null)
  }

  // Переименование: расходы связаны с категорией по id, поэтому смена названия безопасна.
  const startRename = (c: Category) => {
    setMenuId(null)
    setEditingId(c.id)
    setEditingName(c.name)
    setError(null)
  }
  const cancelRename = () => {
    setEditingId(null)
    setEditingName('')
  }
  const saveRename = async () => {
    if (!editingId) return
    const name = editingName.trim()
    if (!name) return
    const { error: rErr } = await supabase.from('categories').update({ name }).eq('id', editingId)
    if (rErr) {
      setError(rErr.message)
      return
    }
    setCategories((cs) => cs.map((c) => (c.id === editingId ? { ...c, name } : c)))
    cancelRename()
  }

  // Мягкое удаление: archived = true. Строка остаётся в БД, чтобы история хранила название.
  const confirmCat = categories.find((c) => c.id === confirmId) ?? null
  const confirmRemove = async () => {
    if (!confirmId) return
    const { error: delErr } = await supabase
      .from('categories')
      .update({ archived: true })
      .eq('id', confirmId)
    if (delErr) {
      setError(delErr.message)
      setConfirmId(null)
      return
    }
    setCategories((cs) => cs.filter((x) => x.id !== confirmId))
    setConfirmId(null)
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!user || !monthId) return
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const { error: mErr } = await supabase
        .from('months')
        .update({ planned_income: goal })
        .eq('id', monthId)
      if (mErr) throw mErr
      for (const c of categories) {
        const { error: cErr } = await supabase
          .from('categories')
          .update({ percent: Number(c.percent) })
          .eq('id', c.id)
        if (cErr) throw cErr
      }
      setSaved(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold">📊 Бюджет / План · {MONTH_NAMES[month - 1]}</h1>

      {loading ? (
        <p className="text-neutral-500 dark:text-neutral-400">Загрузка…</p>
      ) : (
        <form onSubmit={save} className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50">
              <span className="text-xs text-neutral-500 dark:text-neutral-400">Получено в этом месяце</span>
              <span className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">{formatSum(received)}</span>
            </div>
            <div className="flex flex-col gap-2 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50">
              <label className="text-xs text-neutral-500 dark:text-neutral-400">Цель по доходу (ориентир)</label>
              <input
                inputMode="numeric"
                value={goalIncome}
                onChange={(e) => {
                  setGoalIncome(formatAmountInput(e.target.value))
                  setSaved(false)
                }}
                placeholder="Например, 10 000 000"
                className={inputCls}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-neutral-500 dark:text-neutral-400">Категории и проценты</span>
              <span
                className={`text-sm ${
                  totalPercent === 100 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
                }`}
              >
                Сумма: {totalPercent}%
              </span>
            </div>

            {categories.map((c) =>
              editingId === c.id ? (
                <div
                  key={c.id}
                  className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-neutral-50 px-3 py-3 dark:bg-neutral-900/40"
                >
                  <input
                    autoFocus
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        saveRename()
                      } else if (e.key === 'Escape') {
                        cancelRename()
                      }
                    }}
                    className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950"
                  />
                  <button
                    type="button"
                    onClick={saveRename}
                    className="shrink-0 rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-medium text-neutral-950 transition hover:bg-emerald-400"
                  >
                    Сохранить
                  </button>
                  <button
                    type="button"
                    onClick={cancelRename}
                    className="shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                  >
                    Отмена
                  </button>
                </div>
              ) : (
                <div
                  key={c.id}
                  className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3 dark:border-neutral-800 dark:bg-neutral-900/40"
                >
                  <span className="min-w-0 flex-1 text-sm font-medium leading-tight">{c.name}</span>
                  <input
                    inputMode="numeric"
                    value={String(c.percent)}
                    onChange={(e) => setPercent(c.id, e.target.value)}
                    className="w-14 shrink-0 rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-center text-sm outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950"
                  />
                  <span className="shrink-0 text-neutral-500">%</span>
                  <span className="w-20 shrink-0 whitespace-nowrap text-right text-xs font-medium text-emerald-600 dark:text-emerald-400 sm:w-28 sm:text-sm">
                    {formatSum((received * Number(c.percent)) / 100)}
                  </span>
                  <div className="relative shrink-0">
                    <button
                      type="button"
                      onClick={() => setMenuId(menuId === c.id ? null : c.id)}
                      title="Действия"
                      className="px-1.5 text-lg leading-none text-neutral-500 transition hover:text-neutral-800 dark:hover:text-neutral-200"
                    >
                      ⋯
                    </button>
                    {menuId === c.id && (
                      <div className="absolute right-0 top-full z-20 mt-1 w-36 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
                        <button
                          type="button"
                          onClick={() => startRename(c)}
                          className="block w-full px-3 py-2 text-left text-sm transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
                        >
                          ✏️ Изменить
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setMenuId(null)
                            setConfirmId(c.id)
                          }}
                          className="block w-full px-3 py-2 text-left text-sm text-red-500 transition hover:bg-red-500/10 dark:text-red-400"
                        >
                          🗑️ Удалить
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ),
            )}

            <div className="mt-1 flex gap-2">
              <input
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addCategory()
                  }
                }}
                placeholder="Новая категория"
                className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950"
              />
              <button
                type="button"
                onClick={addCategory}
                className="shrink-0 rounded-lg border border-emerald-500/50 px-3 py-2 text-sm text-emerald-600 transition hover:bg-emerald-500/10 dark:text-emerald-400"
              >
                + Добавить
              </button>
            </div>
          </div>

          {totalPercent !== 100 && (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              ⚠️ Сумма процентов = {totalPercent}%. Рекомендуется ровно 100%.
            </p>
          )}
          {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}
          {saved && <p className="text-sm text-emerald-600 dark:text-emerald-400">✅ Сохранено!</p>}

          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-emerald-500 px-4 py-2.5 font-medium text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-60"
          >
            {busy ? 'Сохранение…' : 'Сохранить'}
          </button>
        </form>
      )}

      {/* Клик вне меню — закрыть. */}
      {menuId !== null && (
        <button
          type="button"
          aria-label="Закрыть меню"
          onClick={() => setMenuId(null)}
          className="fixed inset-0 z-10 cursor-default"
        />
      )}

      <ConfirmDialog
        open={confirmId !== null}
        title="Удалить категорию?"
        danger
        confirmLabel="Удалить"
        onCancel={() => setConfirmId(null)}
        onConfirm={confirmRemove}
        message={
          <>
            Категория <b>«{confirmCat?.name ?? ''}»</b> будет убрана из списка. Прошлые расходы
            останутся в истории с пометкой «(удалена)».
          </>
        }
      />
    </div>
  )
}
