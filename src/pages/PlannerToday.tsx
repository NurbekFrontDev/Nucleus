import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useLang } from '../lib/i18n'
import { formatDateHuman, monthName } from '../lib/db'
import { readCache, writeCache } from '../lib/offlineCache'
import HabitSheet from '../components/HabitSheet'
import DayPanel from '../components/DayPanel'
import DayEditSheet from '../components/DayEditSheet'
import DayTemplateSheet from '../components/DayTemplateSheet'
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
  calcDayEnergy,
  archiveItem,
  type PlannerItem,
  type PlannerLog,
  type TimeOfDay,
  type DaySummary,
  type DayMark,
  type PlannerDayOverride,
} from '../lib/planner'
import EnergyCharacter from '../components/EnergyCharacter'
import { hapticTap } from '../lib/native'
import { rescheduleAll } from '../lib/notifications'
import ConfirmDialog from '../components/ConfirmDialog'

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
// Минималистичная стрелка навигации (без рамки) — по бокам от колец дней.
const arrowBtn =
  'flex h-8 w-5 shrink-0 items-center justify-center text-lg leading-none text-neutral-400 transition hover:text-neutral-700 active:scale-90 dark:text-neutral-500 dark:hover:text-neutral-200'

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`

// Геометрия кольца дня в ленте (внутри — краткое название дня недели).
const STRIP_R = 21
const STRIP_C = 2 * Math.PI * STRIP_R

// Полоска-метка дня в календаре: выполнено -> зелёный, запланировано -> серый.
// (Раньше незавершённые дела красились по важности в красный/жёлтый — из-за этого
// месяц/неделя выглядели «тревожно красными». Теперь спокойный нейтральный цвет,
// а зелёным выделяется только выполненное.)
const markColor = (m: DayMark): string =>
  m.done ? 'bg-emerald-500' : 'bg-neutral-300 dark:bg-neutral-600'

// Цвет кольца дня по проценту выполнения — синхронно с прогресс-баром дня.
// 0% (день ещё не начат / ничего не отмечено) -> нейтральный серый (НЕ красный),
// ≤30% красный, ≤60% жёлтый, иначе зелёный.
const ringTone = (p: number): string =>
  p <= 0
    ? 'text-neutral-300 dark:text-neutral-700'
    : p <= 30
      ? 'text-red-500'
      : p <= 60
        ? 'text-amber-500'
        : 'text-emerald-500'

export default function PlannerToday() {
  const { user } = useAuth()
  const { t, lang } = useLang()

  const today = todayStr()

  // ===== Общее состояние вида =====
  const [view, setView] = useState<View>('today')
  const [menuOpen, setMenuOpen] = useState(false)

  // ===== Вид «Сегодня» =====
  const [date, setDate] = useState(today)
  // Кэш дня для мгновенного открытия без интернета (stale-while-revalidate):
  // сразу показываем сохранённые дела дня, сеть обновляет их в фоне.
  type DayCache = {
    items: PlannerItem[]
    logs: Record<string, PlannerLog>
    overrides: Record<string, PlannerDayOverride>
    sections: boolean
  }
  const cachedDay = user ? readCache<DayCache>(`planday:${user.id}:${today}`) : null
  const [items, setItems] = useState<PlannerItem[]>(cachedDay?.items ?? [])
  const [logs, setLogs] = useState<Record<string, PlannerLog>>(cachedDay?.logs ?? {})
  const [sections, setSections] = useState(cachedDay?.sections ?? false)
  const [loading, setLoading] = useState(!cachedDay)
  const [error, setError] = useState<string | null>(null)
  const [reorder, setReorder] = useState(false)
  const [sheetItem, setSheetItem] = useState<PlannerItem | null>(null)
  const [energyOpen, setEnergyOpen] = useState(false)
  // Режим «Изменить день»: правка дела только на эту дату (не трогая шаблон).
  const [editDay, setEditDay] = useState(false)
  const [editItem, setEditItem] = useState<PlannerItem | null>(null)
  const [delItem, setDelItem] = useState<PlannerItem | null>(null)
  // Окно «Шаблоны дня»: сохранить текущий день / применить шаблон.
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [overrides, setOverrides] = useState<Record<string, PlannerDayOverride>>(cachedDay?.overrides ?? {})
  const [stripSummaries, setStripSummaries] = useState<Record<string, DaySummary>>({})

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
    setEditDay(false)
    // Мгновенно показываем кэш выбранного дня (без спиннера и без интернета).
    // Если кэша нет — очищаем, чтобы не мелькали данные прошлого дня.
    const ck = `planday:${user.id}:${date}`
    const cached = readCache<DayCache>(ck)
    if (cached) {
      setItems(cached.items)
      setLogs(cached.logs)
      setOverrides(cached.overrides)
      setSections(cached.sections)
      setLoading(false)
    } else {
      setItems([])
      setLogs({})
      setLoading(true)
    }
    ;(async () => {
      try {
        const [day, sec] = await Promise.all([
          loadDay(user.id, date),
          loadDaySections(user.id),
        ])
        if (!active) return
        setItems(day.items)
        setLogs(day.logs)
        setOverrides(day.overrides)
        setSections(sec)
        setError(null)
        writeCache(ck, {
          items: day.items,
          logs: day.logs,
          overrides: day.overrides,
          sections: sec,
        })
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

  // Сводки 7-дневной ленты колец (вид «Сегодня»): процент выполнения по дням.
  useEffect(() => {
    if (!user || view !== 'today') return
    let active = true
    ;(async () => {
      try {
        const s = await loadDaySummaries(user.id, addDays(today, -6), today)
        if (active) setStripSummaries(s)
      } catch {
        // некритично для ленты колец
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
      setOverrides(day.overrides)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const confirmDelete = async () => {
    if (!user || !delItem) return
    try {
      await archiveItem(user.id, delItem.id)
      setDelItem(null)
      await reload()
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
  const dayEnergy = useMemo(
    () => calcDayEnergy(items, logs),
    [items, logs],
  )
  const pct = dayEnergy.energy
  const barColor =
    pct <= 30
      ? 'bg-red-500'
      : pct <= 60
        ? 'bg-amber-500'
        : 'bg-emerald-500'

  const relLabel =
    date === today
      ? t('today.today')
      : date === addDays(today, -1)
        ? t('today.yesterday')
        : date === addDays(today, 1)
          ? t('today.tomorrow')
          : ''

  // 12-часовой формат из HH:MM
  const fmtTime12 = (hhmm: string): string => {
    if (!hhmm) return ''
    const [h, m] = hhmm.split(':').map(Number)
    if (isNaN(h) || isNaN(m)) return hhmm
    const pm = h >= 12
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
    return `${h12}:${String(m).padStart(2, '0')} ${pm ? 'PM' : 'AM'}`
  }

  const timeLabel = (item: PlannerItem): string => {
    if (item.at_time_start && item.at_time_end) return `${fmtTime12(item.at_time_start)}\u2013${fmtTime12(item.at_time_end)}`
    if (item.at_time_start) return fmtTime12(item.at_time_start)
    return ''
  }

  // Отметить/снять выполнение с оптимистичным обновлением и откатом при ошибке.
  const onToggle = async (item: PlannerItem) => {
    if (!user) return
    void hapticTap()
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
      // Отметка выполнения влияет на напоминания: пересобираем расписание,
      // чтобы по выполненному делу уведомление не приходило (и вернулось,
      // если снять галочку). Актуально только для сегодняшнего дня.
      if (date === today) void rescheduleAll(user.id)
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
      <div
        key={item.id}
        role="button"
        tabIndex={0}
        onClick={() => (editDay ? setEditItem(item) : onToggle(item))}
        aria-label={item.title}
        className={`flex cursor-pointer items-start justify-between gap-2.5 ${cardCls}${done && !editDay ? ' opacity-60' : ''} transition active:scale-[.99]`}
      >
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          {editDay ? (
            <span
              aria-hidden
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-emerald-500/50 text-[11px]"
            >
              ✏️
            </span>
          ) : (
            <span
              aria-hidden
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[10px] font-bold transition ${
                done
                  ? 'border-emerald-500 bg-emerald-500 text-neutral-950'
                  : 'border-neutral-300 dark:border-neutral-600'
              }`}
            >
              {done ? '\u2713' : ''}
            </span>
          )}
          {dot && <span className="mt-1 shrink-0 text-xs leading-none">{dot}</span>}
          {item.important && <span className="mt-1 shrink-0 text-xs leading-none">⭐</span>}
          {item.icon && <span className="mt-0.5 shrink-0">{item.icon}</span>}
          <div className="min-w-0 flex-1">
            <p
              className={`break-words text-base font-medium ${
                done ? 'text-neutral-500 line-through dark:text-neutral-400' : ''
              }`}
            >
              <span className="break-words">{item.title}</span>
              {overrides[item.id] && !overrides[item.id].frozen && (
                <span
                  title={t('today.edited')}
                  className="ml-1 align-middle text-xs text-emerald-600 dark:text-emerald-400"
                >
                  ✎
                </span>
              )}
              {isHabit && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setSheetItem(item)
                  }}
                  title={t('habits.openHint')}
                  className="ml-1 align-middle text-xs text-neutral-400 transition hover:text-emerald-600 dark:hover:text-emerald-400"
                >
                  🔁
                </button>
              )}
            </p>
            {time && (
              <p className="mt-0.5 text-[13px] font-medium text-neutral-500 dark:text-neutral-400">{time}</p>
            )}
            {item.note && <p className="break-words text-xs text-neutral-500">{item.note}</p>}
          </div>
        </div>
        {editDay && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setDelItem(item)
            }}
            title={t('common.delete')}
            className="shrink-0 rounded-lg p-1.5 text-neutral-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
          >
            🗑
          </button>
        )}
      </div>
    )
  }

  const sectionLabel = (item: PlannerItem): string => {
    switch (item.time_of_day) {
      case 'morning':
        return t('today.morning')
      case 'day':
        return t('today.day')
      case 'allday':
        return t('today.allday')
      case 'evening':
        return t('today.evening')
      default:
        return t('today.noTime')
    }
  }

  const renderReorderTask = (item: PlannerItem, index: number) => {
    const done = isDone(item.id)
    const dot = PRIORITY_DOT[item.priority]
    const time = timeLabel(item)
    const isHabit = item.type === 'habit'

    return (
      <div
        key={item.id}
        ref={(el) => {
          if (el) rowRefs.current.set(item.id, el)
          else rowRefs.current.delete(item.id)
        }}
        style={dragStyle(item.id, index)}
        className={`relative flex items-start gap-3 ${cardCls}${done ? ' opacity-60' : ''} ${
          drag?.id === item.id && drag.active
            ? ' border-emerald-500/60 shadow-xl ring-1 ring-emerald-500/40'
            : ''
        }`}
      >
        {grip(item.id, index)}
        {dot && <span className="mt-1 shrink-0 text-xs leading-none">{dot}</span>}
        {item.important && <span className="mt-1 shrink-0 text-xs leading-none">⭐</span>}
        {item.icon && <span className="mt-0.5 shrink-0">{item.icon}</span>}

        <div className="min-w-0 flex-1">
          <p
            className={`break-words text-base font-medium ${
              done ? 'text-neutral-500 line-through dark:text-neutral-400' : ''
            }`}
          >
            {item.title}
            {isHabit && <span className="ml-1 text-xs">🔁</span>}
          </p>

          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-300">
              {sectionLabel(item)}
            </span>
            {time && (
              <span className="shrink-0 rounded-md bg-white px-1.5 py-0.5 text-[11px] font-medium text-neutral-700 shadow-sm ring-1 ring-neutral-200/60 dark:bg-neutral-800 dark:text-neutral-200 dark:ring-neutral-700">
                {time}
              </span>
            )}
          </div>

          {item.note && <p className="mt-1 break-words text-xs text-neutral-500">{item.note}</p>}
        </div>
      </div>
    )
  }

  // Группы для режима «Утро / День / Вечер / Весь день».
  const sectionDefs: { key: Exclude<TimeOfDay, null> | 'none'; label: string }[] = [
    { key: 'morning', label: t('today.morning') },
    { key: 'day', label: t('today.day') },
    { key: 'allday', label: t('today.allday') },
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
      {/* Закреплённая шапка: не движется при прокрутке содержимого. */}
      <div className="sticky top-0 z-20 -mx-4 flex flex-col gap-3 border-b border-neutral-200/70 bg-white/85 px-4 pb-3 pt-3 backdrop-blur dark:border-neutral-800/70 dark:bg-neutral-950/85">
      {/* Верхняя строка: дата по центру (тап — вернуться к «сегодня») +
          иконка-календарь справа (открывает выпадающий список вида). */}
      <div className="flex items-center justify-between gap-2">
        {!isCalendar && date !== today ? (
          <button
            type="button"
            onClick={() => setDate(today)}
            title={t('cal.today')}
            className="flex h-8 shrink-0 items-center rounded-lg border border-emerald-500/40 px-2 text-xs font-medium text-emerald-600 transition hover:bg-emerald-500/10 dark:text-emerald-400"
          >
            {t('cal.today')}
          </button>
        ) : (
          <span aria-hidden className="h-8 w-8 shrink-0" />
        )}
        <button
          type="button"
          onClick={() => (isCalendar ? setAnchor(today) : setDate(today))}
          title={t('today.today')}
          className="min-w-0 flex-1 truncate text-center"
        >
          {isCalendar ? (
            <span className="text-sm font-semibold">{periodLabel}</span>
          ) : (
            <span className="text-sm font-semibold">
              {relLabel || formatDateHuman(date)}
              {relLabel && (
                <span className="ml-1.5 text-xs font-normal text-neutral-500 dark:text-neutral-400">
                  · {formatDateHuman(date)}
                </span>
              )}
            </span>
          )}
        </button>
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={viewLabel(view)}
            title={viewLabel(view)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-300 text-base transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            🗓️
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

      {/* Кольца дней с минималистичными стрелками по бокам (вид «Сегодня»);
          в календаре — те же стрелки + быстрый возврат к сегодня. */}
      {!isCalendar ? (
        <div className="flex items-center gap-1">
          <button onClick={() => setDate(addDays(date, -1))} aria-label={t('today.prev')} className={arrowBtn}>
            ‹
          </button>
          <div className="flex flex-1 justify-between gap-1">
            {Array.from({ length: 7 }, (_, i) => {
              // Лента фиксирована относительно СЕГОДНЯ (6 прошедших дней + сегодня
              // справа). Выбор дня не сдвигает ленту — подсветка просто переезжает
              // на нажатый день.
              const dStr = addDays(today, i - 6)
              const dt = new Date(dStr + 'T00:00:00')
              const wd = (dt.getDay() + 6) % 7
              const sel = dStr === date
              const isStripToday = dStr === today
              const sum = stripSummaries[dStr]
              let ringPct = sum && sum.total > 0 ? Math.round((sum.done / sum.total) * 100) : 0
              // Для выбранного дня берём «энергию» дня, чтобы цвет и заполнение
              // кольца совпадали с прогресс-баром внизу.
              if (dStr === date && items.length > 0) ringPct = pct
              const off = STRIP_C * (1 - ringPct / 100)
              const tone = ringTone(ringPct)
              return (
                <button
                  key={dStr}
                  type="button"
                  onClick={() => setDate(dStr)}
                  aria-label={WEEKDAYS[wd]}
                  className="flex min-w-0 flex-1 flex-col items-center"
                >
                  <span className={`relative flex aspect-square w-full max-w-[44px] items-center justify-center rounded-full transition sm:max-w-[56px] md:max-w-[68px] ${sel ? 'bg-neutral-200/80 dark:bg-white/15' : ''}`}>
                    <svg viewBox="0 0 48 48" className="absolute inset-0 h-full w-full -rotate-90">
                      <circle
                        cx="24"
                        cy="24"
                        r={STRIP_R}
                        fill="none"
                        strokeWidth="3.5"
                        className={sel && ringPct > 0 ? `${tone} opacity-20` : 'text-neutral-200 dark:text-neutral-800'}
                        stroke="currentColor"
                      />
                      {ringPct > 0 && (
                        <circle
                          cx="24"
                          cy="24"
                          r={STRIP_R}
                          fill="none"
                          strokeWidth="3.5"
                          strokeLinecap="round"
                          className={`${tone} transition-[stroke-dashoffset] duration-300`}
                          stroke="currentColor"
                          strokeDasharray={STRIP_C}
                          strokeDashoffset={off}
                        />
                      )}
                    </svg>
                    <span
                      className={`relative text-[11px] font-bold uppercase tracking-tight sm:text-sm ${
                        sel
                          ? ringPct > 0
                            ? tone
                            : 'text-neutral-600 dark:text-neutral-300'
                          : isStripToday
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-neutral-600 dark:text-neutral-300'
                      }`}
                    >
                      {WEEKDAYS[wd]}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
          <button onClick={() => setDate(addDays(date, 1))} aria-label={t('today.next')} className={arrowBtn}>
            ›
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-center gap-4">
          <button onClick={() => shift(-1)} aria-label={t('today.prev')} className={arrowBtn}>
            ‹
          </button>
          <button
            onClick={() => setAnchor(today)}
            className="rounded-lg px-3 py-1 text-xs font-medium text-emerald-600 transition hover:bg-emerald-500/10 dark:text-emerald-400"
          >
            {t('cal.today')}
          </button>
          <button onClick={() => shift(1)} aria-label={t('today.next')} className={arrowBtn}>
            ›
          </button>
        </div>
      )}
      </div>

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
                <span className="inline-block h-2 w-4 rounded-full bg-neutral-300 dark:bg-neutral-600" /> {t('cal.task')}
              </span>
            </div>
          )}
        </>
      ) : (
        // ===== Вид «Сегодня» =====
        <>
          {loading ? (
            <p className="text-neutral-500 dark:text-neutral-400">{t('common.loading')}</p>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('today.empty')}</p>
              <button
                type="button"
                onClick={() => setTemplatesOpen(true)}
                className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                📋 {lang === 'ru' ? 'Шаблоны дня' : 'Day templates'}
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      setReorder((v) => !v)
                      setEditDay(false)
                    }}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                      reorder
                        ? 'bg-emerald-500 text-neutral-950 hover:bg-emerald-400'
                        : 'border border-neutral-300 text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800'
                    }`}
                  >
                    {reorder ? t('common.reorderDone') : t('common.reorder')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setEditDay((v) => !v)
                    setReorder(false)
                  }}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                    editDay
                      ? 'bg-emerald-500 text-neutral-950 hover:bg-emerald-400'
                      : 'border border-neutral-300 text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800'
                  }`}
                >
                  {editDay ? t('today.editDayDone') : t('today.editDay')}
                </button>
                <button
                  type="button"
                  onClick={() => setTemplatesOpen(true)}
                  className="rounded-lg border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-500 transition hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
                >
                  📋 {lang === 'ru' ? 'Шаблоны' : 'Templates'}
                </button>
              </div>

              {sections && !reorder && !editDay ? (
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
                <section className="flex flex-col gap-2">{items.map(renderReorderTask)}</section>
              ) : (
                <section className="flex flex-col gap-2">{items.map(renderTask)}</section>
              )}
            </>
          )}

          {/* Прогресс-бар дня — закреплён ВНИЗУ экрана отдельной панелью
              (всегда виден, не «висит» в воздухе). Кнопка чата ассистента
              поднята выше и оказывается над ним. Тап открывает окно энергии. */}
          {!loading && total > 0 && (
            <>
              {/* Отступ под фиксированную панель, чтобы последнее дело не пряталось. */}
              <div aria-hidden className="h-14" />
              <div className="fixed inset-x-0 bottom-16 z-20 md:bottom-0 md:left-72">
                <div className="mx-auto max-w-3xl px-4">
                <button
                  type="button"
                  onClick={() => setEnergyOpen(true)}
                  className="flex w-full items-center gap-3 rounded-xl border border-neutral-200 bg-white/95 px-4 py-2.5 text-left shadow-lg backdrop-blur transition dark:border-neutral-800 dark:bg-neutral-950/95"
                >
                  <span className="shrink-0 text-xs font-medium text-neutral-600 dark:text-neutral-300">
                    {dayEnergy.doneCount === total
                      ? t('today.allDone')
                      : t('today.progress', { done: dayEnergy.doneCount, total })}
                  </span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                    <span
                      className={`block h-full rounded-full ${barColor} transition-all duration-300`}
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-emerald-600 dark:text-emerald-400">{pct}%</span>
                </button>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* Окно персонажа энергии (геймификация). */}
      {energyOpen && (
        <EnergyCharacter
          energy={dayEnergy}
          onClose={() => setEnergyOpen(false)}
        />
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

      {/* Окно правки дела на конкретный день (вид «Сегодня»). */}
      {editItem && user && (
        <DayEditSheet
          userId={user.id}
          date={date}
          item={editItem}
          hasOverride={!!overrides[editItem.id] && !overrides[editItem.id].frozen}
          existing={overrides[editItem.id] ?? null}
          onClose={() => setEditItem(null)}
          onSaved={reload}
        />
      )}

      {/* Окно «Шаблоны дня» (вид «Сегодня»). */}
      {templatesOpen && user && (
        <DayTemplateSheet
          userId={user.id}
          date={date}
          items={items}
          onClose={() => setTemplatesOpen(false)}
          onApplied={reload}
        />
      )}

      <ConfirmDialog
        open={!!delItem}
        title={lang === 'ru' ? 'Удалить дело?' : 'Delete task?'}
        message={
          delItem
            ? lang === 'ru'
              ? `«${delItem.title}» будет удалено из ваших дел.`
              : `"${delItem.title}" will be deleted from your tasks.`
            : ''
        }
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDelItem(null)}
      />
    </div>
  )
}
