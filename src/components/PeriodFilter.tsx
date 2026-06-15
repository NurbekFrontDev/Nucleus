import { useEffect, useState } from 'react'
import RangeCalendar from './RangeCalendar'
import { formatDateHuman, monthName, monthGen } from '../lib/db'
import { useLang } from '../lib/i18n'

export type PeriodValue = {
  start: string
  end: string
  label: string
  // Когда true — список записей стоит группировать по месяцам (Год / Всё).
  groupByMonth: boolean
}
type Mode = 'day' | 'week' | 'month' | 'year' | 'all' | 'range'

const MODES: Array<{ id: Mode; key: string }> = [
  { id: 'day', key: 'period.day' },
  { id: 'week', key: 'period.week' },
  { id: 'month', key: 'period.month' },
  { id: 'year', key: 'period.year' },
  { id: 'all', key: 'period.all' },
  { id: 'range', key: 'period.range' },
]

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const chipCls = (active: boolean) =>
  `rounded-full border px-3 py-1 text-xs transition ${
    active
      ? 'border-emerald-500 bg-emerald-500 font-medium text-neutral-950'
      : 'border-neutral-300 text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800'
  }`

const navBtn =
  'rounded-lg border border-neutral-300 px-3 py-1 text-sm transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'

function startOfWeek(d: Date) {
  const x = new Date(d)
  const wd = (x.getDay() + 6) % 7
  x.setDate(x.getDate() - wd)
  return x
}

function weekLabel(s: Date, e: Date) {
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear())
    return `${s.getDate()}–${e.getDate()} ${monthGen(s.getMonth())} ${s.getFullYear()}`
  return `${formatDateHuman(iso(s))} – ${formatDateHuman(iso(e))}`
}

// Переключатель периода: День / Неделя / Месяц / Год / Всё / Период.
export default function PeriodFilter({
  onChange,
  modes,
  modesAlign = 'left',
}: {
  onChange: (v: PeriodValue) => void
  modes?: Mode[]
  modesAlign?: 'left' | 'center' | 'stretch'
}) {
  const { t } = useLang()
  const shownModes = modes ? MODES.filter((m) => modes.includes(m.id)) : MODES
  const rowCls =
    modesAlign === 'center'
      ? 'flex flex-wrap justify-center gap-2'
      : modesAlign === 'stretch'
        ? 'flex gap-2'
        : 'flex flex-wrap gap-2'
  const todayISO = iso(new Date())
  const [mode, setMode] = useState<Mode>('month')
  const [anchor, setAnchor] = useState(todayISO)
  const [rangeStart, setRangeStart] = useState(() => {
    const d = new Date()
    return iso(new Date(d.getFullYear(), d.getMonth(), 1))
  })
  const [rangeEnd, setRangeEnd] = useState(todayISO)

  const a = new Date(anchor + 'T00:00:00')
  let value: PeriodValue
  if (mode === 'day') {
    value = { start: anchor, end: anchor, label: formatDateHuman(anchor), groupByMonth: false }
  } else if (mode === 'week') {
    const s = startOfWeek(a)
    const e = new Date(s)
    e.setDate(s.getDate() + 6)
    value = { start: iso(s), end: iso(e), label: weekLabel(s, e), groupByMonth: false }
  } else if (mode === 'month') {
    const s = new Date(a.getFullYear(), a.getMonth(), 1)
    const e = new Date(a.getFullYear(), a.getMonth() + 1, 0)
    value = {
      start: iso(s),
      end: iso(e),
      label: `${monthName(a.getMonth())} ${a.getFullYear()}`,
      groupByMonth: false,
    }
  } else if (mode === 'year') {
    const s = new Date(a.getFullYear(), 0, 1)
    const e = new Date(a.getFullYear(), 11, 31)
    value = { start: iso(s), end: iso(e), label: String(a.getFullYear()), groupByMonth: true }
  } else if (mode === 'all') {
    value = { start: '1900-01-01', end: '2999-12-31', label: t('period.allTime'), groupByMonth: true }
  } else {
    value = {
      start: rangeStart,
      end: rangeEnd,
      label: `${formatDateHuman(rangeStart)} – ${formatDateHuman(rangeEnd)}`,
      groupByMonth: false,
    }
  }

  useEffect(() => {
    onChange(value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.start, value.end, value.label])

  const shift = (dir: number) => {
    const x = new Date(anchor + 'T00:00:00')
    if (mode === 'day') x.setDate(x.getDate() + dir)
    else if (mode === 'week') x.setDate(x.getDate() + 7 * dir)
    else if (mode === 'month') x.setMonth(x.getMonth() + dir)
    else if (mode === 'year') x.setFullYear(x.getFullYear() + dir)
    setAnchor(iso(x))
  }

  const navigable = mode === 'day' || mode === 'week' || mode === 'month' || mode === 'year'

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900/50">
      <div className={rowCls}>
        {shownModes.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            className={`${chipCls(mode === m.id)}${modesAlign === 'stretch' ? ' flex-1 text-center' : ''}`}
          >
            {t(m.key)}
          </button>
        ))}
      </div>
      {mode === 'range' ? (
        <RangeCalendar
          start={rangeStart}
          end={rangeEnd}
          onChange={(s, e) => {
            setRangeStart(s)
            setRangeEnd(e)
          }}
        />
      ) : navigable ? (
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => shift(-1)} className={navBtn}>
            ‹
          </button>
          <span className="text-sm font-medium">{value.label}</span>
          <button type="button" onClick={() => shift(1)} className={navBtn}>
            ›
          </button>
        </div>
      ) : (
        <div className="text-center text-sm font-medium">{value.label}</div>
      )}
    </div>
  )
}
