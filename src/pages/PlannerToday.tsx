import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useLang } from '../lib/i18n'
import { formatDateHuman, monthName } from '../lib/db'
import HabitSheet from '../components/HabitSheet'
import DayPanel from '../components/DayPanel'
import {
  loadDay,
  toggleDone,
  saveDayOrder,
  loadDaySections,
  loadDaySummaries,
  todayStr,
  addDays,
  toDateStr,
  PRIORITY_DOT,
  type PlannerItem,
  type PlannerLog,
  type TimeOfDay,
  type DaySummary,
  type DayMark,
} from '../lib/planner'

// Экран «Сегодня» (П-3 + П-6): один экран с переключателем вида в правом
// верхнем углу — Сегодня / Неделя / Месяц / Год (как в TickTick).
//   Сегодня        -> список дел на выбранный день, прогресс-бар, отметка
//                     выполнения и ручной порядок дел (перетаскиванием).
//   Неделя/Месяц/Год -> календарь с цветными метками; клик по дню открывает
//                     окно этого дня (DayPanel) со списком дел.
// Отдельной вкладки «Календарь» больше нет — всё живёт здесь.

type View = 'today' | 'week' | 'month' | 'year'

const cardCls =
  'rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50'
const navBtn =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-neutral-300 text-sm transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`

// Цвет полоски-метки в календаре: выполнено -> зелёный, иначе по важности дела.
const markColor = (m: DayMark): string => {
  if (m.done) return 'bg-emerald-500'
  switch (m.priority) {
    case 'high':
      return 'bg-red-500'
    case 'medium':
      return 'bg-amber-500'
    case 'low':
      return 'bg-green-500'
    default:
      return 'bg-sky-500'
  }
}

export default function PlannerToday() {
  const { user } = useAuth()
  const { t, lang } = useLang()

  const today = todayStr()

  // ===== Общее состояние вида =====
  const [view, setView] = useState<View>('today')
  const [menuOpen, setMenuOpen] = useState(false)

  // ===== Вид «Сегодня» =====
  const [date, setDate] = useState(today)
  const [items, setItems] = useState<PlannerItem[]>([])
  const [logs, setLogs] = useState<Record<string, PlannerLog>>({})
  const [sections, setSections] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reorder, setReorder] = useState(false)
  const [sheetItem, setSheetItem] = useState<PlannerItem | null>(null)

  // ===== Виды «Неделя / Месяц / Год» (календарь) =====
  const [anchor, setAnchor] = useState(today) // дата внутри текущего периода
  const [summaries, setSummaries] = useState<Record<string, DaySummary>>({})
  const [calLoading, setCalLoading] = useState(true)
  const [panelDate, setPanelDate] = useState<string | null>(null)

  const anchorDate = useMemo(() => new Date(anchor + 'T00:00:00'), [anchor])
  const year = anchorDate.getFullYear()
  const month = anchorDate.getMonth()

  const WEEKDAYS =
    lang === 'en'
      ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      : ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

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

  // Загрузка дня (только когда открыт вид «Сегодня»).
  useEffect(() => {
    if (!user || view !== 'today') return
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
  }, [user, date, view])

  // Диапазон дат для загрузки сводок календаря (зависит от вида).
  const range = useMemo(() => {
    if (view === 'year') {
      return { start: iso(year, 0, 1), end: iso(year, 11, 31) }
    }
    if (view === 'week') {
      const wd = (anchorDate.getDay() + 6) % 7
      const start = new Date(year, month, anchorDate.getDate() - wd)
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)
      return { start: toDateStr(start), end: toDateStr(end) }
    }
    // месяц: сетка 6 недель от понедельника
    const firstWd = (new Date(year, month, 1).getDay() + 6) % 7
    const gridStart = new Date(year, month, 1 - firstWd)
    const gridEnd = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + 41)
    return { start: toDateStr(gridStart), end: toDateStr(gridEnd) }
  }, [view, year, month, anchorDate])

  // Загрузка сводок календаря (только когда открыт календарный вид).
  useEffect(() => {
    if (!user || view === 'today') return
    let active = true
    ;(async () => {
      try {
        setCalLoading(true)
        const s = await loadDaySummaries(user.id, range.start, range.end)
        if (!active) return
        setSummaries(s)
        setError(null)
      } catch (e) {
        if (active) setError((e as Error).message)
      } finally {
        if (active) setCalLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [user, view, range.start, range.end])

  // Перезагрузка дня (после отметок в окне привычки).
  const reload = async () => {
    if (!user) return
    try {
      const day = await loadDay(user.id, date)
      setItems(day.items)
      setLogs(day.logs)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // Перезагрузка сводок (после отметок в окне дня).
  const reloadSummaries = async () => {
    if (!user) return
    try {
      const s = await loadDaySummaries(user.id, range.start, range.end)
      setSummaries(s)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const isDone = (id: string) => logs[id]?.status === 'done'
  const total = items.length
  const doneCount = items.filter((it) => isDone(it.id)).length
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0

  const isToday = date === today
  const relLabel =
    date === today
      ? t('today.today')
      : date === addDays(today, -1)
        ? t('today.yesterday')
        : date === addDays(today, 1)
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

  // Строка дела/привычки: чекбокс, кружок важности, иконка, название, время.
  // Привычку можно нажать — откроется окно в стиле Atoms (история, календарь, стрики).
  const renderTask = (item: PlannerItem) => {
    const done = isDone(item.id)
    const dot = PRIORITY_DOT[item.priority]
    const time = timeLabel(item)
    const isHabit = item.type === 'habit'
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
        {item.important && <span className="shrink-0 text-xs leading-none">⭐</span>}
        {item.icon && <span className="shrink-0">{item.icon}</span>}
        {isHabit ? (
          <button
            type="button"
            onClick={() => setSheetItem(item)}
            title={t('habits.openHint')}
            className="min-w-0 flex-1 text-left"
          >
            <p
              className={`flex items-center gap-1 text-sm font-medium ${
                done ? 'text-neutral-500 line-through dark:text-neutral-400' : ''
              }`}
            >
              <span className="truncate">{item.title}</span>
              <span className="shrink-0 text-xs">🔁</span>
            </p>
            {item.note && <p className="truncate text-xs text-neutral-500">{item.note}</p>}
          </button>
        ) : (
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
        )}
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

  // ===== Календарь: период, навигация, сетки =====
  const shift = (dir: number) => {
    if (view === 'year') {
      setAnchor(iso(year + dir, month, Math.min(anchorDate.getDate(), 28)))
    } else if (view === 'week') {
      const d = new Date(year, month, anchorDate.getDate() + dir * 7)
      setAnchor(toDateStr(d))
    } else {
      const d = new Date(year, month + dir, 1)
      setAnchor(toDateStr(d))
    }
  }

  const periodLabel = useMemo(() => {
    if (view === 'year') return String(year)
    if (view === 'week') {
      const wd = (anchorDate.getDay() + 6) % 7
      const start = new Date(year, month, anchorDate.getDate() - wd)
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)
      if (start.getMonth() === end.getMonth())
        return `${start.getDate()}\u2013${end.getDate()} ${monthName(start.getMonth())}`
      return `${start.getDate()} ${monthName(start.getMonth())} \u2013 ${end.getDate()} ${monthName(end.getMonth())}`
    }
    return `${monthName(month)} ${year}`
  }, [view, year, month, anchorDate])

  const viewLabel = (v: View) =>
    v === 'today'
      ? t('today.today')
      : v === 'month'
        ? t('cal.month')
        : v === 'week'
          ? t('cal.week')
          : t('cal.year')

  // Ячейка дня (для месяца и недели).
  const dayCell = (dateStr: string, inMonth: boolean) => {
    const sum = summaries[dateStr]
    const dayNum = Number(dateStr.slice(8, 10))
    const cellToday = dateStr === today
    const marks = sum ? sum.marks.slice(0, 4) : []
    const extra = sum ? sum.total - marks.length : 0
    return (
      <button
        key={dateStr}
        type="button"
        onClick={() => setPanelDate(dateStr)}
        className={`flex min-h-[64px] flex-col gap-1 rounded-xl border p-1.5 text-left transition hover:border-emerald-400 ${
          cellToday ? 'border-emerald-500 bg-emerald-500/5' : 'border-neutral-200 dark:border-neutral-800'
        } ${inMonth ? '' : 'opacity-40'}`}
      >
        <span
          className={`text-xs font-medium ${
            cellToday
              ? 'flex h-5 w-5 items-center justify-center self-start rounded-full bg-emerald-500 text-white'
              : 'text-neutral-600 dark:text-neutral-300'
          }`}
        >
          {dayNum}
        </span>
        <span className="flex flex-col gap-0.5">
          {marks.map((m, i) => (
            <span key={i} className={`h-1.5 rounded-full ${markColor(m)}`} />
          ))}
          {extra > 0 && <span className="text-[10px] leading-none text-neutral-400">+{extra}</span>}
        </span>
      </button>
    )
  }

  const monthGrid = () => {
    const firstWd = (new Date(year, month, 1).getDay() + 6) % 7
    const gridStart = new Date(year, month, 1 - firstWd)
    const days = Array.from({ length: 42 }, (_, i) =>
      new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i),
    )
    return (
      <div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-neutral-400">
          {WEEKDAYS.map((w) => (
            <span key={w} className="py-1">
              {w}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {days.map((d) => dayCell(toDateStr(d), d.getMonth() === month))}
        </div>
      </div>
    )
  }

  const weekGrid = () => {
    const wd = (anchorDate.getDay() + 6) % 7
    const start = new Date(year, month, anchorDate.getDate() - wd)
    const days = Array.from({ length: 7 }, (_, i) =>
      new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
    )
    return (
      <div className="grid grid-cols-7 gap-1">
        {days.map((d, i) => (
          <div key={i} className="flex flex-col gap-1">
            <span className="text-center text-[11px] text-neutral-400">{WEEKDAYS[i]}</span>
            {dayCell(toDateStr(d), true)}
          </div>
        ))}
      </div>
    )
  }

  // Вид «Год»: 12 мини-месяцев. Клик по месяцу открывает его в виде «Месяц».
  const miniMonth = (mi: number) => {
    const firstWd = (new Date(year, mi, 1).getDay() + 6) % 7
    const daysInMonth = new Date(year, mi + 1, 0).getDate()
    const cells: Array<number | null> = []
    for (let i = 0; i < firstWd; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(d)
    return (
      <button
        key={mi}
        type="button"
        onClick={() => {
          setAnchor(iso(year, mi, 1))
          setView('month')
        }}
        className="rounded-xl border border-neutral-200 p-2 text-left transition hover:border-emerald-400 dark:border-neutral-800"
      >
        <p className="mb-1 text-sm font-medium">{monthName(mi)}</p>
        <div className="grid grid-cols-7 gap-[2px]">
          {cells.map((d, idx) => {
            if (d === null) return <span key={idx} className="h-3.5" />
            const dateStr = iso(year, mi, d)
            const has = !!summaries[dateStr]
            const cellToday = dateStr === today
            return (
              <span
                key={idx}
                className={`flex h-3.5 items-center justify-center rounded-[3px] text-[8px] ${
                  cellToday
                    ? 'bg-emerald-500 text-white'
                    : has
                      ? 'bg-emerald-500/20 text-neutral-600 dark:text-neutral-300'
                      : 'text-neutral-400'
                }`}
              >
                {d}
              </span>
            )
          })}
        </div>
      </button>
    )
  }

  const isCalendar = view !== 'today'

  return (
    <div className="flex flex-col gap-5">
      {/* Шапка: навигация + период/дата + переключатель вида справа. */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => (isCalendar ? shift(-1) : setDate(addDays(date, -1)))}
            aria-label={t('today.prev')}
            className={navBtn}
          >
            ◀
          </button>
          <div className="min-w-[8rem] text-center">
            {isCalendar ? (
              <p className="text-lg font-semibold">{periodLabel}</p>
            ) : (
              <>
                <p className="text-lg font-semibold">{relLabel || formatDateHuman(date)}</p>
                {relLabel && <p className="text-xs text-neutral-500">{formatDateHuman(date)}</p>}
              </>
            )}
          </div>
          <button
            onClick={() => (isCalendar ? shift(1) : setDate(addDays(date, 1)))}
            aria-label={t('today.next')}
            className={navBtn}
          >
            ▶
          </button>
        </div>

        {/* Кнопка-переключатель вида (Сегодня / Неделя / Месяц / Год). */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-1 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            🗓️ {viewLabel(view)} ▾
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 z-20 mt-1 w-36 overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
                {(['today', 'week', 'month', 'year'] as View[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => {
                      setView(v)
                      setMenuOpen(false)
                    }}
                    className={`flex w-full items-center justify-between px-3 py-2 text-sm transition hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                      view === v ? 'font-semibold text-emerald-600 dark:text-emerald-400' : ''
                    }`}
                  >
                    {viewLabel(v)}
                    {view === v && <span>✓</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Быстрый возврат к сегодняшней дате. */}
      {isCalendar ? (
        <button
          onClick={() => setAnchor(today)}
          className="self-center rounded-lg px-3 py-1 text-xs font-medium text-emerald-600 transition hover:bg-emerald-500/10 dark:text-emerald-400"
        >
          {t('cal.today')}
        </button>
      ) : (
        !isToday && (
          <button
            onClick={() => setDate(today)}
            className="self-center rounded-lg px-3 py-1 text-xs font-medium text-emerald-600 transition hover:bg-emerald-500/10 dark:text-emerald-400"
          >
            {t('today.today')}
          </button>
        )
      )}

      {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}

      {isCalendar ? (
        // ===== Календарные виды =====
        <>
          {calLoading ? (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('common.loading')}</p>
          ) : view === 'month' ? (
            monthGrid()
          ) : view === 'week' ? (
            weekGrid()
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {Array.from({ length: 12 }, (_, mi) => miniMonth(mi))}
            </div>
          )}

          {/* Легенда цветов */}
          {view !== 'year' && (
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-neutral-500 dark:text-neutral-400">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-4 rounded-full bg-emerald-500" /> {t('habits.legendDone')}
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-4 rounded-full bg-red-500" /> {t('cal.high')}
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-4 rounded-full bg-sky-500" /> {t('cal.task')}
              </span>
            </div>
          )}
        </>
      ) : (
        // ===== Вид «Сегодня» =====
        <>
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
        </>
      )}

      {/* Окно привычки (вид «Сегодня»). */}
      {sheetItem && user && (
        <HabitSheet
          userId={user.id}
          item={sheetItem}
          date={date}
          onClose={() => setSheetItem(null)}
          onChanged={reload}
        />
      )}

      {/* Окно дня (календарные виды). */}
      {panelDate && user && (
        <DayPanel
          userId={user.id}
          date={panelDate}
          onClose={() => setPanelDate(null)}
          onChanged={reloadSummaries}
        />
      )}
    </div>
  )
}
