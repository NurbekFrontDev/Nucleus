import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useLang } from '../lib/i18n'
import { formatDateHuman } from '../lib/db'
import {
  loadDay,
  toggleDone,
  saveDayOrder,
  loadDaySections,
  todayStr,
  addDays,
  PRIORITY_DOT,
  type PlannerItem,
  type PlannerLog,
  type TimeOfDay,
} from '../lib/planner'

// Экран «Сегодня» (П-3): список дел на выбранный день, прогресс-бар, отметка
// выполнения и ручной порядок дел внутри дня (перетаскиванием, как в «Долгах»).
// Добавление дел появится в разделе «Мои дела» (этап П-4).

const cardCls =
  'rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50'
const navBtn =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-neutral-300 text-sm transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'

export default function PlannerToday() {
  const { user } = useAuth()
  const { t } = useLang()

  const [date, setDate] = useState(todayStr())
  const [items, setItems] = useState<PlannerItem[]>([])
  const [logs, setLogs] = useState<Record<string, PlannerLog>>({})
  const [sections, setSections] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reorder, setReorder] = useState(false)

  // ===== Перетаскивание дел внутри дня (тот же механизм, что в «Долгах»). =====
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
    setReorder(false)
    ;(async () => {
      try {
        setLoading(true)
        const [day, sec] = await Promise.all([
          loadDay(user.id, date),
          loadDaySections(user.id),
        ])
        if (!active) return
        setItems(day.items)
        setLogs(day.logs)
        setSections(sec)
        setError(null)
      } catch (e) {
        if (active) setError((e as Error).message)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [user, date])

  const isDone = (id: string) => logs[id]?.status === 'done'
  const total = items.length
  const doneCount = items.filter((it) => isDone(it.id)).length
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0

  const isToday = date === todayStr()
  const relLabel =
    date === todayStr()
      ? t('today.today')
      : date === addDays(todayStr(), -1)
        ? t('today.yesterday')
        : date === addDays(todayStr(), 1)
          ? t('today.tomorrow')
          : ''

  const timeLabel = (item: PlannerItem): string => {
    if (item.at_time_start && item.at_time_end) return `${item.at_time_start}\u2013${item.at_time_end}`
    if (item.at_time_start) return item.at_time_start
    return ''
  }

  // Отметить/снять выполнение с оптимистичным обновлением и откатом при ошибке.
  const onToggle = async (item: PlannerItem) => {
    if (!user) return
    const currentlyDone = isDone(item.id)
    const optimistic: PlannerLog = {
      id: 'tmp',
      item_id: item.id,
      date,
      status: 'done',
      value: null,
      note: null,
    }
    setLogs((prev) => {
      const next = { ...prev }
      if (currentlyDone) delete next[item.id]
      else next[item.id] = optimistic
      return next
    })
    try {
      const newLog = await toggleDone(user.id, item.id, date, currentlyDone)
      setLogs((prev) => {
        const next = { ...prev }
        if (newLog) next[item.id] = newLog
        else delete next[item.id]
        return next
      })
    } catch (e) {
      // Откат к прежнему состоянию.
      setLogs((prev) => {
        const next = { ...prev }
        if (currentlyDone) next[item.id] = optimistic
        else delete next[item.id]
        return next
      })
      setError((e as Error).message)
    }
  }

  // Сохраняет ручной порядок дел этого дня в базе.
  const persistOrder = async (ordered: PlannerItem[]) => {
    if (!user) return
    try {
      await saveDayOrder(user.id, date, ordered.map((i) => i.id))
    } catch (e) {
      setError((e as Error).message)
    }
  }

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

  const moveDrag = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d || d.settling) return
    const offset = e.clientY - d.startY
    const isActive = d.active || Math.abs(offset) > 6
    const steps = Math.round(offset / d.slot)
    const overIndex = Math.max(0, Math.min(items.length - 1, d.fromIndex + steps))
    if (offset === d.offset && overIndex === d.overIndex && isActive === d.active) return
    const next: DragState = { ...d, offset, overIndex, active: isActive }
    dragRef.current = next
    setDrag(next)
  }

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

    const order = items
    if (settleTimer.current) window.clearTimeout(settleTimer.current)
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = null
      if (d.overIndex !== d.fromIndex) {
        const next = order.slice()
        const [moved] = next.splice(d.fromIndex, 1)
        next.splice(d.overIndex, 0, moved)
        setItems(next)
        void persistOrder(next)
      }
      dragRef.current = null
      setDrag(null)
    }, 210)
  }

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

  const grip = (id: string, index: number) => (
    <button
      type="button"
      aria-label={t('today.reorderHint')}
      title={t('today.reorderHint')}
      onPointerDown={(e) => startDrag(e, id, index)}
      onPointerMove={moveDrag}
      onPointerUp={(e) => endDrag(e)}
      onPointerCancel={(e) => endDrag(e)}
      className="shrink-0 cursor-grab touch-none select-none px-1 text-lg leading-none text-neutral-400 transition hover:text-neutral-600 active:cursor-grabbing dark:text-neutral-500 dark:hover:text-neutral-300"
    >
      ⠿
    </button>
  )

  // Обычная строка дела: чекбокс, кружок важности, иконка, название, время.
  const renderTask = (item: PlannerItem) => {
    const done = isDone(item.id)
    const dot = PRIORITY_DOT[item.priority]
    const time = timeLabel(item)
    return (
      <div key={item.id} className={`flex items-center gap-3 ${cardCls}${done ? ' opacity-60' : ''}`}>
        <button
          type="button"
          onClick={() => onToggle(item)}
          aria-label={item.title}
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-xs font-bold transition ${
            done
              ? 'border-emerald-500 bg-emerald-500 text-neutral-950'
              : 'border-neutral-300 hover:border-emerald-500 dark:border-neutral-600'
          }`}
        >
          {done ? '\u2713' : ''}
        </button>
        {dot && <span className="shrink-0 text-xs leading-none">{dot}</span>}
        {item.icon && <span className="shrink-0">{item.icon}</span>}
        <div className="min-w-0 flex-1">
          <p
            className={`truncate text-sm font-medium ${
              done ? 'text-neutral-500 line-through dark:text-neutral-400' : ''
            }`}
          >
            {item.title}
          </p>
          {item.note && <p className="truncate text-xs text-neutral-500">{item.note}</p>}
        </div>
        {time && (
          <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">{time}</span>
        )}
      </div>
    )
  }

  // Группы для режима «Утро / День / Вечер».
  const sectionDefs: { key: Exclude<TimeOfDay, null> | 'none'; label: string }[] = [
    { key: 'morning', label: t('today.morning') },
    { key: 'day', label: t('today.day') },
    { key: 'evening', label: t('today.evening') },
    { key: 'none', label: t('today.noTime') },
  ]

  return (
    <div className="flex flex-col gap-5">
      {/* Шапка: переключение дней. */}
      <div className="flex items-center justify-between gap-3">
        <button onClick={() => setDate(addDays(date, -1))} aria-label={t('today.prev')} className={navBtn}>
          ◀
        </button>
        <div className="text-center">
          <p className="text-lg font-semibold">{relLabel || formatDateHuman(date)}</p>
          {relLabel && <p className="text-xs text-neutral-500">{formatDateHuman(date)}</p>}
        </div>
        <button onClick={() => setDate(addDays(date, 1))} aria-label={t('today.next')} className={navBtn}>
          ▶
        </button>
      </div>

      {!isToday && (
        <button
          onClick={() => setDate(todayStr())}
          className="self-center rounded-lg px-3 py-1 text-xs font-medium text-emerald-600 transition hover:bg-emerald-500/10 dark:text-emerald-400"
        >
          {t('today.today')}
        </button>
      )}

      {/* Прогресс-бар дня: наполняется по мере выполнения дел. */}
      {total > 0 && (
        <div className={cardCls}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">
              {doneCount === total
                ? t('today.allDone')
                : t('today.progress', { done: doneCount, total })}
            </p>
            <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{pct}%</span>
          </div>
          <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}

      {loading ? (
        <p className="text-neutral-500 dark:text-neutral-400">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('today.empty')}</p>
      ) : (
        <>
          {!sections && items.length > 1 && (
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

          {sections ? (
            sectionDefs.map((s) => {
              const list = items.filter((i) =>
                s.key === 'none' ? !i.time_of_day : i.time_of_day === s.key,
              )
              if (list.length === 0) return null
              return (
                <section key={s.key} className="flex flex-col gap-2">
                  <h2 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400">
                    {s.label}
                  </h2>
                  {list.map(renderTask)}
                </section>
              )
            })
          ) : reorder ? (
            <section className="flex flex-col gap-2">
              {items.map((item, index) => (
                <div
                  key={item.id}
                  ref={(el) => {
                    if (el) rowRefs.current.set(item.id, el)
                    else rowRefs.current.delete(item.id)
                  }}
                  style={dragStyle(item.id, index)}
                  className={`relative flex items-center gap-2 rounded-xl border bg-neutral-50 px-3 py-3 dark:bg-neutral-900/40 ${
                    drag?.id === item.id && drag.active
                      ? 'border-emerald-500/60 shadow-xl ring-1 ring-emerald-500/40'
                      : 'border-neutral-200 dark:border-neutral-800'
                  }`}
                >
                  {grip(item.id, index)}
                  {PRIORITY_DOT[item.priority] && (
                    <span className="shrink-0 text-xs leading-none">{PRIORITY_DOT[item.priority]}</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.title}</p>
                  </div>
                </div>
              ))}
            </section>
          ) : (
            <section className="flex flex-col gap-2">{items.map(renderTask)}</section>
          )}
        </>
      )}
    </div>
  )
}
