import { useEffect, useRef, useState } from 'react'
import { useLang } from '../lib/i18n'
import { useAnimatedMount } from '../lib/useAnimatedMount'

type Props = {
  value: string // 'HH:MM' (24ч, внутренний формат) или ''
  onChange: (v: string) => void
  placeholder?: string
}

const triggerCls =
  'flex w-full items-center justify-between gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-left text-sm outline-none transition hover:border-emerald-500 focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950'

const pad = (n: number) => String(n).padStart(2, '0')
// 12-часовой (американский) формат: часы 1..12 + AM/PM.
const HOURS12 = Array.from({ length: 12 }, (_, i) => i + 1)
const MINUTES = Array.from({ length: 12 }, (_, i) => pad(i * 5))

// '13:05' -> { h12: 1, min: '05', pm: true }; пустое -> null.
function parse12(value: string): { h12: number; min: string; pm: boolean } | null {
  if (!value) return null
  const [hRaw, mRaw] = value.split(':')
  const h = Number(hRaw)
  if (Number.isNaN(h)) return null
  const pm = h >= 12
  const h12 = h % 12 === 0 ? 12 : h % 12
  return { h12, min: mRaw ?? '00', pm }
}

// { h12, min, pm } -> 'HH:MM' (24ч).
function to24(h12: number, min: string, pm: boolean): string {
  let h = h12 % 12
  if (pm) h += 12
  return `${pad(h)}:${min}`
}

// '13:05' -> '1:05 PM'
function fmt12(value: string): string {
  const p = parse12(value)
  if (!p) return ''
  return `${p.h12}:${p.min} ${p.pm ? 'PM' : 'AM'}`
}

const colCls =
  'flex max-h-44 flex-col gap-0.5 overflow-y-auto rounded-lg bg-neutral-50 p-1 dark:bg-neutral-800/40'
const cellCls = (sel: boolean) =>
  `shrink-0 rounded-md px-2 py-1.5 text-center text-sm transition ${
    sel ? 'bg-emerald-500 font-medium text-neutral-950' : 'hover:bg-emerald-500/10'
  }`

// Выбор времени в стиле приложения, 12-часовой формат (часы / минуты / AM·PM).
// Внутреннее значение остаётся 'HH:MM' (24ч), чтобы не ломать хранение/сортировку.
export default function TimePicker({ value, onChange, placeholder }: Props) {
  const { lang } = useLang()
  const [open, setOpen] = useState(false)
  const show = useAnimatedMount(open)
  const ref = useRef<HTMLDivElement>(null)

  const parsed = parse12(value)
  const curH12 = parsed?.h12 ?? null
  const curMin = parsed?.min ?? null
  const pm = parsed?.pm ?? false

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const setHour = (hh: number) => onChange(to24(hh, curMin || '00', pm))
  const setMinute = (mm: string) => onChange(to24(curH12 || 12, mm, pm))
  const setMeridiem = (nextPm: boolean) => onChange(to24(curH12 || 12, curMin || '00', nextPm))

  const label = fmt12(value)

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className={triggerCls}>
        <span className={label ? '' : 'text-neutral-400'}>{label || placeholder || '--:-- --'}</span>
        <span className="shrink-0 text-neutral-400">🕒</span>
      </button>
      {show && (
        <div
          className={`${
            open ? 'animate-pop' : 'animate-pop-out'
          } absolute z-30 mt-1 w-56 rounded-lg border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900`}
        >
          <div className="flex gap-2">
            <div className="flex-1">
              <p className="mb-1 text-center text-[10px] font-medium uppercase tracking-wide text-neutral-400">
                {lang === 'en' ? 'Hour' : 'Часы'}
              </p>
              <div className={colCls}>
                {HOURS12.map((hh) => (
                  <button
                    key={hh}
                    type="button"
                    onClick={() => setHour(hh)}
                    className={cellCls(hh === curH12)}
                  >
                    {hh}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1">
              <p className="mb-1 text-center text-[10px] font-medium uppercase tracking-wide text-neutral-400">
                {lang === 'en' ? 'Min' : 'Мин'}
              </p>
              <div className={colCls}>
                {MINUTES.map((mm) => (
                  <button
                    key={mm}
                    type="button"
                    onClick={() => setMinute(mm)}
                    className={cellCls(mm === curMin)}
                  >
                    {mm}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex w-12 flex-col gap-1">
              <p className="mb-0 text-center text-[10px] font-medium uppercase tracking-wide text-neutral-400">
                AM/PM
              </p>
              <button
                type="button"
                onClick={() => setMeridiem(false)}
                className={cellCls(!!parsed && !pm)}
              >
                AM
              </button>
              <button
                type="button"
                onClick={() => setMeridiem(true)}
                className={cellCls(!!parsed && pm)}
              >
                PM
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              onChange('')
              setOpen(false)
            }}
            className="mt-2 w-full rounded-md py-1 text-center text-xs text-neutral-500 transition hover:text-red-500 dark:hover:text-red-400"
          >
            {lang === 'en' ? 'Clear' : 'Очистить'}
          </button>
        </div>
      )}
    </div>
  )
}
