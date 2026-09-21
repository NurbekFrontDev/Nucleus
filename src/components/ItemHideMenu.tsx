import { useLayoutEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../lib/AuthContext'
import { useLang } from '../lib/i18n'
import { monthName } from '../lib/db'
import RangeCalendar from './RangeCalendar'
import {
  todayStr,
  hideItem,
  showItem,
  getHiddenStatus,
  type PlannerItem,
} from '../lib/planner'

const WEEKDAYS_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const WEEKDAYS_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const pad = (n: number) => String(n).padStart(2, '0')

// Короткая дата «21.09» для подписей скрытия.
const fmtShort = (iso: string | null | undefined): string => {
  if (!iso) return ''
  const p = iso.split('-')
  return p.length >= 3 ? `${p[2]}.${p[1]}` : iso
}

// Мини-календарь на один клик: выбираем конкретный день, начиная с сегодняшнего.
function DayGrid({ onPick }: { onPick: (iso: string) => void }) {
  const { lang } = useLang()
  const WEEKDAYS = lang === 'en' ? WEEKDAYS_EN : WEEKDAYS_RU
  const [view, setView] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const year = view.getFullYear()
  const month = view.getMonth()
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const todayISO = todayStr()

  const cells: Array<number | null> = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const shiftMonth = (dir: number) => setView(new Date(year, month + dir, 1))
  const navBtn =
    'rounded-lg px-2 py-1 text-sm transition hover:bg-neutral-100 dark:hover:bg-neutral-800'

  return (
    <div className="p-1">
      <div className="mb-1 flex items-center justify-between">
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
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-neutral-400">
        {WEEKDAYS.map((w) => (
          <span key={w} className="py-1">
            {w}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-sm">
        {cells.map((d, idx) => {
          if (d === null) return <span key={idx} />
          const iso = `${year}-${pad(month + 1)}-${pad(d)}`
          const past = iso < todayISO
          const isToday = iso === todayISO
          return (
            <button
              key={idx}
              type="button"
              disabled={past}
              onClick={() => onPick(iso)}
              className={`rounded-lg py-1.5 transition ${
                past
                  ? 'cursor-not-allowed text-neutral-300 dark:text-neutral-700'
                  : isToday
                    ? 'border border-emerald-500 font-medium text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400'
                    : 'text-neutral-700 hover:bg-emerald-500/10 dark:text-neutral-200'
              }`}
            >
              {d}
            </button>
          )
        })}
      </div>
    </div>
  )
}

type Props = {
  item: PlannerItem
  anchorEl?: HTMLElement | null
  onClose: () => void
  onChanged: () => void
}

// Выпадающее меню глазика: варианты скрытия дела с сохранением истории прошлых дней.
// «Навсегда» — с сегодняшнего дня и далее; «на сегодня» — один день; «на день» и
// «на период» — выбор дат в календаре в стиле приложения. Рендерится через Portal,
// чтобы находиться поверх всех элементов и не наследовать opacity/grayscale родительской карточки.
export default function ItemHideMenu({ item, anchorEl, onClose, onChanged }: Props) {
  const { user } = useAuth()
  const { t } = useLang()
  const [view, setView] = useState<'menu' | 'date' | 'range'>('menu')
  const [busy, setBusy] = useState(false)
  const status = useMemo(() => getHiddenStatus(item), [item])
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)

  useLayoutEffect(() => {
    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect()
      const top = Math.min(rect.bottom + 6, window.innerHeight - 380)
      const right = Math.max(12, window.innerWidth - rect.right)
      setPos({ top: Math.max(12, top), right })
    }
  }, [anchorEl])

  const act = async (fn: () => Promise<void>) => {
    if (!user || busy) return
    setBusy(true)
    try {
      await fn()
      onChanged()
      onClose()
    } catch (e) {
      console.error('hide/show item failed:', e)
    } finally {
      setBusy(false)
    }
  }

  const row =
    'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-neutral-800'

  const currentState = status.active
    ? status.forever
      ? t('items.hiddenForever')
      : status.until
        ? t('items.hiddenUntil', { d: fmtShort(status.until) })
        : ''
    : ''

  const menuStyle = pos
    ? { top: `${pos.top}px`, right: `${pos.right}px` }
    : { top: '5rem', right: '1rem' }

  return createPortal(
    <>
      {/* Перехват клика вне меню (полный экран, поверх всех задач и кнопок) */}
      <div className="fixed inset-0 z-[999] bg-black/10 backdrop-blur-[0.5px]" onClick={onClose} />
      <div
        style={menuStyle}
        onClick={(e) => e.stopPropagation()}
        className="fixed z-[1000] w-72 max-w-[calc(100vw-2rem)] animate-pop rounded-xl border border-neutral-200 bg-white p-2 opacity-100 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900"
      >
        {view === 'menu' && (
          <>
            {currentState && (
              <p className="px-2.5 pb-1.5 pt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                {currentState}
              </p>
            )}
            {status.active ? (
              <button
                type="button"
                disabled={busy}
                className={`${row} font-medium text-emerald-600 dark:text-emerald-400`}
                onClick={() => act(() => showItem(user!.id, item.id))}
              >
                <span>👁</span>
                <span>{t('items.showItem')}</span>
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy}
              className={row}
              onClick={() => act(() => hideItem(user!.id, item.id, { kind: 'forever' }))}
            >
              <span>🚫</span>
              <span>{t('items.hideForever')}</span>
            </button>
            <button
              type="button"
              disabled={busy}
              className={row}
              onClick={() => act(() => hideItem(user!.id, item.id, { kind: 'today' }))}
            >
              <span>🌙</span>
              <span>{t('items.hideTodayOnly')}</span>
            </button>
            <button
              type="button"
              disabled={busy}
              className={row}
              onClick={() => setView('date')}
            >
              <span>📅</span>
              <span>{t('items.hideOnDate')}</span>
            </button>
            <button
              type="button"
              disabled={busy}
              className={row}
              onClick={() => setView('range')}
            >
              <span>🗓️</span>
              <span>{t('items.hideRange')}</span>
            </button>
          </>
        )}

        {view === 'date' && (
          <>
            <p className="px-2 pb-1 pt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
              {t('items.hideOnDate')}
            </p>
            <DayGrid
              onPick={(iso) => act(() => hideItem(user!.id, item.id, { kind: 'date', date: iso }))}
            />
          </>
        )}

        {view === 'range' && (
          <RangeCalendar
            start=""
            end=""
            onChange={(a, b) => {
              // Прошедшие даты не прячем задним числом: период только с сегодня и позже.
              const today = todayStr()
              const from = a < today ? today : a
              if (b < today) return
              void act(() => hideItem(user!.id, item.id, { kind: 'range', from, to: b }))
            }}
          />
        )}
      </div>
    </>,
    document.body,
  )
}
