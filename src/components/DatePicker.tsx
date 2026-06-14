import { useEffect, useRef, useState } from 'react'
import { formatDateHuman, monthName } from '../lib/db'
import { useLang } from '../lib/i18n'

type Props = {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}

const triggerCls =
  'flex w-full items-center justify-between gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-left text-sm outline-none transition hover:border-emerald-500 focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950'

const WEEKDAYS_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const WEEKDAYS_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const pad = (n: number) => String(n).padStart(2, '0')

// Календарь в стиле приложения. Значение — строка YYYY-MM-DD.
export default function DatePicker({ value, onChange, placeholder }: Props) {
  const { t, lang } = useLang()
  const WEEKDAYS = lang === 'en' ? WEEKDAYS_EN : WEEKDAYS_RU
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const init = value ? new Date(value + 'T00:00:00') : new Date()
  const [viewYear, setViewYear] = useState(init.getFullYear())
  const [viewMonth, setViewMonth] = useState(init.getMonth())

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const openCal = () => {
    const d = value ? new Date(value + 'T00:00:00') : new Date()
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
    setOpen((v) => !v)
  }

  const firstWeekday = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const today = new Date()
  const todayISO = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11)
      setViewYear((y) => y - 1)
    } else setViewMonth((m) => m - 1)
  }
  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0)
      setViewYear((y) => y + 1)
    } else setViewMonth((m) => m + 1)
  }
  const pick = (day: number) => {
    onChange(`${viewYear}-${pad(viewMonth + 1)}-${pad(day)}`)
    setOpen(false)
  }

  const cells: Array<number | null> = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={openCal} className={triggerCls}>
        <span className={value ? '' : 'text-neutral-400'}>
          {value ? formatDateHuman(value) : placeholder ?? t('date.select')}
        </span>
        <span className="shrink-0 text-neutral-400">📅</span>
      </button>
      {open && (
        <div className="animate-pop absolute z-30 mt-1 w-72 rounded-lg border border-neutral-200 bg-white p-3 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={prevMonth}
              className="rounded px-2 py-1 text-sm transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              ‹
            </button>
            <span className="text-sm font-medium">
              {monthName(viewMonth)} {viewYear}
            </span>
            <button
              type="button"
              onClick={nextMonth}
              className="rounded px-2 py-1 text-sm transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              ›
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-neutral-400">
            {WEEKDAYS.map((w) => (
              <span key={w} className="py-1">
                {w}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-sm">
            {cells.map((d, idx) => {
              if (d === null) return <span key={idx} />
              const iso = `${viewYear}-${pad(viewMonth + 1)}-${pad(d)}`
              const selected = iso === value
              const isToday = iso === todayISO
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => pick(d)}
                  className={`rounded-lg py-1.5 transition ${
                    selected
                      ? 'bg-emerald-500 font-medium text-neutral-950'
                      : isToday
                        ? 'border border-emerald-500 text-emerald-600 dark:text-emerald-400'
                        : 'hover:bg-emerald-500/10'
                  }`}
                >
                  {d}
                </button>
              )
            })}
          </div>
          <div className="mt-2 flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => {
                onChange('')
                setOpen(false)
              }}
              className="text-neutral-500 transition hover:text-red-500 dark:hover:text-red-400"
            >
              {t('date.clear')}
            </button>
            <button
              type="button"
              onClick={() => {
                onChange(todayISO)
                setOpen(false)
              }}
              className="text-emerald-600 transition hover:underline dark:text-emerald-400"
            >
              {t('date.today')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
