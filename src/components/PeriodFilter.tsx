import { useEffect, useState } from 'react'
import DatePicker from './DatePicker'
import { formatDateHuman, MONTH_NAMES, MONTH_NAMES_GEN } from '../lib/db'

export type PeriodValue = { start: string; end: string; label: string }
type Mode = 'day' | 'week' | 'month' | 'year' | 'range'

const MODES: Array<{ id: Mode; label: string }> = [
  { id: 'day', label: 'День' },
  { id: 'week', label: 'Неделя' },
  { id: 'month', label: 'Месяц' },
  { id: 'year', label: 'Год' },
  { id: 'range', label: 'Период' },
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
    return `${s.getDate()}–${e.getDate()} ${MONTH_NAMES_GEN[s.getMonth()]} ${s.getFullYear()}`
  return `${formatDateHuman(iso(s))} – ${formatDateHuman(iso(e))}`
}

// Переключатель периода: День / Неделя / Месяц / Год / Период.
export default function PeriodFilter({ onChange }: { onChange: (v: PeriodValue) => void }) {
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
    value = { start: anchor, end: anchor, label: formatDateHuman(anchor) }
  } else if (mode === 'week') {
    const s = startOfWeek(a)
    const e = new Date(s)
    e.setDate(s.getDate() + 6)
    value = { start: iso(s), end: iso(e), label: weekLabel(s, e) }
  } else if (mode === 'month') {
    const s = new Date(a.getFullYear(), a.getMonth(), 1)
    const e = new Date(a.getFullYear(), a.getMonth() + 1, 0)
    value = { start: iso(s), end: iso(e), label: `${MONTH_NAMES[a.getMonth()]} ${a.getFullYear()}` }
  } else if (mode === 'year') {
    const s = new Date(a.getFullYear(), 0, 1)
    const e = new Date(a.getFullYear(), 11, 31)
    value = { start: iso(s), end: iso(e), label: String(a.getFullYear()) }
  } else {
    value = {
      start: rangeStart,
      end: rangeEnd,
      label: `${formatDateHuman(rangeStart)} – ${formatDateHuman(rangeEnd)}`,
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

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900/50">
      <div className="flex flex-wrap gap-2">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            className={chipCls(mode === m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      {mode === 'range' ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <span className="text-xs text-neutral-500">с</span>
          <div className="flex-1">
            <DatePicker value={rangeStart} onChange={setRangeStart} />
          </div>
          <span className="text-xs text-neutral-500">по</span>
          <div className="flex-1">
            <DatePicker value={rangeEnd} onChange={setRangeEnd} />
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => shift(-1)} className={navBtn}>
            ‹
          </button>
          <span className="text-sm font-medium">{value.label}</span>
          <button type="button" onClick={() => shift(1)} className={navBtn}>
            ›
          </button>
        </div>
      )}
    </div>
  )
}
