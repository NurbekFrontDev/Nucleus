import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import { useAnimatedMount } from '../lib/useAnimatedMount'
import ConfirmDialog from '../components/ConfirmDialog'
import { useLang } from '../lib/i18n'
import {
  getOrCreateMonth,
  formatSum,
  monthName,
  formatAmountInput,
  parseAmount,
} from '../lib/db'

type Category = { id: string; name: string; percent: number; sort_order: number; archived?: boolean }

const inputCls =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950'

// Мелкое поле процента.
const percentInputCls =
  'w-11 shrink-0 rounded-lg border border-neutral-300 bg-white px-1.5 py-1 text-center text-xs tabular-nums outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950'

// Меню категории («Изменить / Удалить»). Отдельный компонент — чтобы
// работала анимация появления и исчезновения (хук useAnimatedMount).
function CategoryMenu({
  open,
  label,
  editLabel,
  deleteLabel,
  onToggle,
  onEdit,
  onDelete,
}: {
  open: boolean
  label: string
  editLabel: string
  deleteLabel: string
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const show = useAnimatedMount(open)
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={onToggle}
        className="px-1 text-lg leading-none text-neutral-400 transition hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300"
      >
        ⋮
      </button>
      {show && (
        <div
          className={`${
            open ? 'animate-pop' : 'animate-pop-out'
          } absolute right-0 top-full z-30 mt-1 w-36 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900`}
        >
          <button
            type="button"
            onClick={onEdit}
            className="block w-full px-3 py-2 text-left text-sm transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            {editLabel}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="block w-full px-3 py-2 text-left text-sm text-red-500 transition hover:bg-red-500/10 dark:text-red-400"
          >
            {deleteLabel}
          </button>
        </div>
      )}
    </div>
  )
}

export default function Budget() {
  const { user } = useAuth()
  const { t, tr } = useLang()
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

  // Управление категориями: меню (выпадает по тапу на точки), переименование, удаление.
  const [menuId, setMenuId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  // Режим перемещения: перетаскивать категории можно только когда он включён.
  // На телефоне это защищает от случайного перетаскивания во время прокрутки.
  const [reorder, setReorder] = useState(false)

  // Перетаскивание категорий через те же точки слева.
  //  · active=false пока палец не сдвинулся больше порога — такой «down» считается тапом и открывает меню.
  //  · active=true — это реальное перетаскивание: соседи плавно расступаются.
  //  · settling=true — карточка плавно «доезжает» в свой слот при отпускании (анимация опускания).
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
  // Синхронный источник правды для pointer-обработчиков: при быстром тапе React
  // не успевает закоммитить state между pointerdown и pointerup, поэтому читаем ref.
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

  const totalPercent = categories.reduce((s, c) => s + Number(c.percent), 0)

  const setPercent = (id: string, val: string) => {
    setCategories((cs) =>
      cs.map((c) => (c.id === id ? { ...c, percent: Number(val) || 0 } : c)),
    )
  }

  // Автосохранение процента категории при уходе из поля.
  const savePercent = async (id: string) => {
    if (!user) return
    const cat = categories.find((c) => c.id === id)
    if (!cat) return
    const { error: pErr } = await supabase
      .from('categories')
      .update({ percent: Number(cat.percent) })
      .eq('id', id)
    if (pErr) setError(pErr.message)
  }

  // Сохраняет порядок категорий в БД.
  const persistOrder = async (reordered: Category[]) => {
    const results = await Promise.all(
      reordered.map((c) =>
        supabase.from('categories').update({ sort_order: c.sort_order }).eq('id', c.id),
      ),
    )
    const failed = results.find((r) => r.error)
    if (failed?.error) setError(failed.error.message)
  }

  // Нажатие на точки: запоминаем начало. Пока не сдвинули палец — это ещё не перетаскивание.
  const startDrag = (e: React.PointerEvent, id: string, index: number) => {
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const el = rowRefs.current.get(id)
    const slot = (el?.offsetHeight ?? 56) + 8
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
    const active = d.active || Math.abs(offset) > 6
    const steps = Math.round(offset / d.slot)
    const overIndex = Math.max(0, Math.min(categories.length - 1, d.fromIndex + steps))
    if (offset === d.offset && overIndex === d.overIndex && active === d.active) return
    const next: DragState = { ...d, offset, overIndex, active }
    dragRef.current = next
    setDrag(next)
  }

  // Отпускание. Если не было движения — ничего не делаем (это было просто касание ручки;
  // меню теперь открывает отдельная кнопка ⋮).
  // Иначе — плавно «доводим» карточку в целевой слот (анимация), потом фиксируем порядок.
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

    // Не было движения — это просто касание ручки, перетаскивание не началось.
    if (!d.active) {
      dragRef.current = null
      setDrag(null)
      return
    }

    const slot = d.slot
    // Целевое смещение = ровно позиция нового слота, чтобы карточка доехала без рывка.
    const targetOffset = (d.overIndex - d.fromIndex) * slot
    const settling: DragState = { ...d, settling: true, offset: targetOffset }
    dragRef.current = settling
    setDrag(settling)

    if (settleTimer.current) window.clearTimeout(settleTimer.current)
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = null
      if (d.overIndex !== d.fromIndex) {
        const next = categories.slice()
        const [moved] = next.splice(d.fromIndex, 1)
        next.splice(d.overIndex, 0, moved)
        const reordered = next.map((c, i) => ({ ...c, sort_order: i + 1 }))
        setCategories(reordered)
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

  const addCategory = async () => {
    if (!user || !newCatName.trim()) return
    const name = newCatName.trim()
    const maxOrder = categories.reduce((m, c) => Math.max(m, c.sort_order), 0)

    if (categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      setError(t('budget.dupName'))
      return
    }

    const { data: revived, error: findErr } = await supabase
      .from('categories')
      .select('id, name, percent, sort_order, archived')
      .eq('user_id', user.id)
      .eq('archived', true)
      .ilike('name', name)
      .order('created_at', { ascending: true })
      .limit(1)
    if (findErr) {
      setError(findErr.message)
      return
    }
    if (revived && revived.length > 0) {
      const found = revived[0] as Category
      const { error: upErr } = await supabase
        .from('categories')
        .update({ archived: false, sort_order: maxOrder + 1 })
        .eq('id', found.id)
      if (upErr) {
        setError(upErr.message)
        return
      }
      setCategories([
        ...categories,
        { ...found, percent: Number(found.percent), sort_order: maxOrder + 1, archived: false },
      ])
      setNewCatName('')
      setError(null)
      return
    }

    const { data, error: addErr } = await supabase
      .from('categories')
      .insert({ user_id: user.id, name, percent: 0, sort_order: maxOrder + 1 })
      .select('id, name, percent, sort_order, archived')
      .single()
    if (addErr || !data) {
      setError(addErr?.message ?? t('budget.addFailed'))
      return
    }
    const c = data as Category
    setCategories([...categories, { ...c, percent: Number(c.percent) }])
    setNewCatName('')
    setError(null)
  }

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

  const saveGoalIncome = async () => {
    if (!user || !monthId) return
    const { error: mErr } = await supabase
      .from('months')
      .update({ planned_income: parseAmount(goalIncome) })
      .eq('id', monthId)
    if (mErr) setError(mErr.message)
  }

  // Ручка слева — только перетаскивание (изменить порядок).
  const grip = (c: Category, index: number) => (
    <button
      type="button"
      aria-label={t('budget.dragHint')}
      title={t('budget.dragHint')}
      onPointerDown={(e) => startDrag(e, c.id, index)}
      onPointerMove={moveDrag}
      onPointerUp={(e) => endDrag(e)}
      onPointerCancel={(e) => endDrag(e)}
      className="shrink-0 cursor-grab touch-none select-none px-1 text-lg leading-none text-neutral-400 transition hover:text-neutral-600 active:cursor-grabbing dark:text-neutral-500 dark:hover:text-neutral-300"
    >
      ⠿
    </button>
  )

  // Кнопка меню справа — «Изменить / Удалить» (отдельный компонент с анимацией).
  const menuButton = (c: Category) => (
    <CategoryMenu
      open={menuId === c.id}
      label={t('budget.menuLabel')}
      editLabel={t('budget.menuEdit')}
      deleteLabel={t('budget.menuDelete')}
      onToggle={() => setMenuId((m) => (m === c.id ? null : c.id))}
      onEdit={() => startRename(c)}
      onDelete={() => {
        setMenuId(null)
        setConfirmId(c.id)
      }}
    />
  )

  const percentField = (c: Category) => (
    <>
      <input
        inputMode="numeric"
        value={String(c.percent)}
        onChange={(e) => setPercent(c.id, e.target.value)}
        onBlur={() => savePercent(c.id)}
        className={percentInputCls}
      />
      <span className="shrink-0 text-xs text-neutral-500">%</span>
    </>
  )

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold">📊 {t('budget.title')} · {monthName(month - 1)}</h1>

      {loading ? (
        <p className="text-neutral-500 dark:text-neutral-400">{t('common.loading')}</p>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50">
              <span className="text-xs text-neutral-500 dark:text-neutral-400">{t('budget.received')}</span>
              <span className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">{formatSum(received)}</span>
            </div>
            <div className="flex flex-col gap-2 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50">
              <label className="text-xs text-neutral-500 dark:text-neutral-400">{t('budget.incomeGoal')}</label>
              <input
                inputMode="numeric"
                value={goalIncome}
                onChange={(e) => setGoalIncome(formatAmountInput(e.target.value))}
                onBlur={saveGoalIncome}
                placeholder={t('budget.incomeGoalPh')}
                className={inputCls}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-neutral-500 dark:text-neutral-400">{t('budget.catsPercents')}</span>
              <span
                className={`shrink-0 whitespace-nowrap text-sm ${
                  totalPercent === 100 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
                }`}
              >
                {t('budget.total', { p: totalPercent })}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setReorder((v) => !v)}
              className={`self-start whitespace-nowrap rounded-lg px-3 py-1 text-xs font-medium transition ${
                reorder
                  ? 'bg-emerald-500 text-neutral-950 hover:bg-emerald-400'
                  : 'border border-neutral-300 text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800'
              }`}
            >
              {reorder ? t('common.reorderDone') : t('common.reorder')}
            </button>

            {categories.map((c, index) =>
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
                    {t('common.save')}
                  </button>
                  <button
                    type="button"
                    onClick={cancelRename}
                    className="shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              ) : (
                <div
                  key={c.id}
                  ref={(el) => {
                    if (el) rowRefs.current.set(c.id, el)
                    else rowRefs.current.delete(c.id)
                  }}
                  style={dragStyle(c.id, index)}
                  className={`relative rounded-xl border bg-neutral-50 px-3 py-2.5 dark:bg-neutral-900/40 ${
                    drag?.id === c.id && drag.active
                      ? 'border-emerald-500/60 shadow-xl ring-1 ring-emerald-500/40'
                      : 'border-neutral-200 dark:border-neutral-800'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {reorder && grip(c, index)}
                    <span className="min-w-0 flex-1 break-words text-sm font-medium leading-snug">{tr(c.name)}</span>
                    {percentField(c)}
                    <span className="min-w-[5rem] shrink-0 text-right text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                      {formatSum((received * Number(c.percent)) / 100)}
                    </span>
                    {menuButton(c)}
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
                placeholder={t('budget.newCat')}
                className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950"
              />
              <button
                type="button"
                onClick={addCategory}
                className="shrink-0 rounded-lg border border-emerald-500/50 px-3 py-2 text-sm text-emerald-600 transition hover:bg-emerald-500/10 dark:text-emerald-400"
              >
                {t('budget.add')}
              </button>
            </div>
          </div>

          {totalPercent !== 100 && (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              {t('budget.percentWarn', { p: totalPercent })}
            </p>
          )}
          {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}
        </div>
      )}

      {/* Клик вне меню — закрыть. */}
      {menuId !== null && (
        <button
          type="button"
          aria-label="close"
          onClick={() => setMenuId(null)}
          className="fixed inset-0 z-10 cursor-default"
        />
      )}

      <ConfirmDialog
        open={confirmId !== null}
        title={t('budget.deleteTitle')}
        danger
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onCancel={() => setConfirmId(null)}
        onConfirm={confirmRemove}
        message={t('budget.deleteMsg', { n: tr(confirmCat?.name ?? '') })}
      />
    </div>
  )
}
