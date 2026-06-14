import { useState } from 'react'
import { monthName } from '../lib/db'
import { useLang } from '../lib/i18n'

const WEEKDAYS_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const WEEKDAYS_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const pad = (n: number) => String(n).padStart(2, '0')

// Один календарь для выбора диапазона: первый клик — начало, второй — конец;
// область между ними подсвечивается.
export default function RangeCalendar({
  start,
  end,
  onChange,
}: {
  start: string
  end: string
  onChange: (start: string, end: string) => void
}) {
  const { t, lang } = useLang()
  const WEEKDAYS = lang === 'en' ? WEEKDAYS_EN : WEEKDAYS_RU
  const [view, setView] = useState(() => {
    const d = start ? new Date(start + 'T00:00:00') : new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  // selStart — временное начало при незавершённом выборе; '' — ждём первый клик.
  const [selStart, setSelStart] = useState('')

  const year = view.getFullYear()
  const month = view.getMonth()
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const lo = selStart || start
  const hi = selStart ? '' : end

  const onPick = (dayISO: string) => {
    if (!selStart) {
      // начинаем новый диапазон
      setSelStart(dayISO)
    } else {
      const a = selStart <= dayISO ? selStart : dayISO
      const b = selStart <= dayISO ? dayISO : selStart
      setSelStart('')
      onChange(a, b)
    }
  }

  const cells: Array<number | null> = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const shiftMonth = (dir: number) => setView(new Date(year, month + dir, 1))

  const navBtn =
    'rounded-lg px-2 py-1 text-sm transition hover:bg-neutral-100 dark:hover:bg-neutral-800'

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => shiftMonth(-1)} className={navBtn}>
          ‹
        </button>
        <span className="text-sm font-medium">
          {monthName(month)} {year}
        </span>
        <button type="button" onClick={() => shiftMonth(1)} className={navBtn}>
          ›
        </button>
      </div>
      <div className="mb-1 grid grid-cols-7 gap-1">
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-center text-[11px] text-neutral-400">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (d === null) return <div key={`e${i}`} />
          const dayISO = `${year}-${pad(month + 1)}-${pad(d)}`
          const isStart = dayISO === lo
          const isEnd = !!hi && dayISO === hi
          const inRange = !!lo && !!hi && dayISO > lo && dayISO < hi
          const endpoint = isStart || isEnd
          return (
            <button
              key={dayISO}
              type="button"
              onClick={() => onPick(dayISO)}
              className={`h-9 rounded-lg text-sm transition ${
                endpoint
                  ? 'bg-emerald-500 font-medium text-neutral-950'
                  : inRange
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                    : 'hover:bg-emerald-500/10'
              }`}
            >
              {d}
            </button>
          )
        })}
      </div>
      <div className="mt-2 text-center text-xs text-neutral-500 dark:text-neutral-400">
        {selStart ? t('range.pickEnd') : t('range.pickStart')}
      </div>
    </div>
  )
}
