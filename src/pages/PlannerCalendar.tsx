import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useLang } from '../lib/i18n'
import { monthName } from '../lib/db'
import DayPanel from '../components/DayPanel'
import {
  loadDaySummaries,
  todayStr,
  toDateStr,
  type DaySummary,
  type DayMark,
} from '../lib/planner'

// Экран «Календарь» (П-6) в духе TickTick: в правом верхнем углу кнопка-
// переключатель вида (Месяц / Неделя / Год). Стрелками листаем период. Дни
// показывают цветные полоски-метки (цвет по важности, выполненные — зелёным).
// Нажатие на день открывает окно этого дня (DayPanel) со списком дел.

type View = 'month' | 'week' | 'year'

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`

const navBtn =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-neutral-300 text-sm transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'

// Цвет полоски-метки: выполнено -> зелёный, иначе по важности дела.
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

export default function PlannerCalendar() {
  const { user } = useAuth()
  const { t, lang } = useLang()

  const today = todayStr()

  const [view, setView] = useState<View>('month')
  const [anchor, setAnchor] = useState(today) // дата внутри текущего периода
  const [menuOpen, setMenuOpen] = useState(false)
  const [panelDate, setPanelDate] = useState<string | null>(null)
  const [summaries, setSummaries] = useState<Record<string, DaySummary>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const anchorDate = useMemo(() => new Date(anchor + 'T00:00:00'), [anchor])
  const year = anchorDate.getFullYear()
  const month = anchorDate.getMonth()

  const WEEKDAYS =
    lang === 'en'
      ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      : ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

  // Диапазон дат для загрузки сводок (зависит от вида).
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

  useEffect(() => {
    if (!user) return
    let active = true
    ;(async () => {
      try {
        setLoading(true)
        const s = await loadDaySummaries(user.id, range.start, range.end)
        if (!active) return
        setSummaries(s)
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
  }, [user, range.start, range.end])

  const reloadSummaries = async () => {
    if (!user) return
    try {
      const s = await loadDaySummaries(user.id, range.start, range.end)
      setSummaries(s)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // Переход к предыдущему/следующему периоду.
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
    v === 'month' ? t('cal.month') : v === 'week' ? t('cal.week') : t('cal.year')

  // Ячейка дня (для месяца и недели).
  const dayCell = (dateStr: string, inMonth: boolean) => {
    const sum = summaries[dateStr]
    const dayNum = Number(dateStr.slice(8, 10))
    const isToday = dateStr === today
    const marks = sum ? sum.marks.slice(0, 4) : []
    const extra = sum ? sum.total - marks.length : 0
    return (
      <button
        key={dateStr}
        type="button"
        onClick={() => setPanelDate(dateStr)}
        className={`flex min-h-[64px] flex-col gap-1 rounded-xl border p-1.5 text-left transition hover:border-emerald-400 ${
          isToday ? 'border-emerald-500 bg-emerald-500/5' : 'border-neutral-200 dark:border-neutral-800'
        } ${inMonth ? '' : 'opacity-40'}`}
      >
        <span
          className={`text-xs font-medium ${
            isToday
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

  // ===== Вид «Месяц» =====
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

  // ===== Вид «Неделя» =====
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

  // ===== Вид «Год»: 12 мини-месяцев =====
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
            const isToday = dateStr === today
            return (
              <span
                key={idx}
                className={`flex h-3.5 items-center justify-center rounded-[3px] text-[8px] ${
                  isToday
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

  return (
    <div className="flex flex-col gap-4">
      {/* Закреплённая шапка: период, навигация, вид и кнопка «Сегодня» не двигаются. */}
      <div className="sticky top-0 z-20 -mx-4 flex flex-col gap-3 border-b border-neutral-200/70 bg-white/85 px-4 py-3 backdrop-blur dark:border-neutral-800/70 dark:bg-neutral-950/85">
      {/* Шапка: период + навигация + переключатель вида */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button onClick={() => shift(-1)} aria-label={t('cal.prev')} className={navBtn}>
            ◀
          </button>
          <h1 className="min-w-[7rem] text-center text-lg font-semibold">{periodLabel}</h1>
          <button onClick={() => shift(1)} aria-label={t('cal.next')} className={navBtn}>
            ▶
          </button>
        </div>
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
                {(['month', 'week', 'year'] as View[]).map((v) => (
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

      <button
        onClick={() => setAnchor(today)}
        className="self-center rounded-lg px-3 py-1 text-xs font-medium text-emerald-600 transition hover:bg-emerald-500/10 dark:text-emerald-400"
      >
        {t('cal.today')}
      </button>
      </div>

      {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}

      {loading ? (
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
