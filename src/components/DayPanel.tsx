import { useEffect, useState } from 'react'
import { useLang } from '../lib/i18n'
import { formatDateHuman } from '../lib/db'
import HabitSheet from './HabitSheet'
import DayEditSheet from './DayEditSheet'
import { useAnimatedMount } from '../lib/useAnimatedMount'
import {
  loadDay,
  toggleDone,
  todayStr,
  PRIORITY_DOT,
  type PlannerItem,
  type PlannerLog,
  type PlannerDayOverride,
} from '../lib/planner'

// Окно одного дня (П-6). Открывается по нажатию на день в календаре.
// Снизу на телефоне, по центру на компьютере. Показывает прогресс дня и
// список дел: задачи отмечаются галочкой, а привычку можно нажать — откроется
// её окно в стиле Atoms (история, мини-календарь, стрики).

type Props = {
  userId: string
  date: string
  onClose: () => void
  onChanged: () => void // обновить календарь после изменений
}

const rowCls =
  'flex items-start gap-2.5 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50'

export default function DayPanel({ userId, date, onClose, onChanged }: Props) {
  const { t } = useLang()
  const [open, setOpen] = useState(true)
  const visible = useAnimatedMount(open, 220)

  const [items, setItems] = useState<PlannerItem[]>([])
  const [logs, setLogs] = useState<Record<string, PlannerLog>>({})
  const [loading, setLoading] = useState(true)
  const [sheetItem, setSheetItem] = useState<PlannerItem | null>(null)
  // Режим правки дел только на этот день (не трогая шаблон).
  const [editDay, setEditDay] = useState(false)
  const [editItem, setEditItem] = useState<PlannerItem | null>(null)
  const [overrides, setOverrides] = useState<Record<string, PlannerDayOverride>>({})

  const close = () => setOpen(false)
  useEffect(() => {
    if (!visible) onClose()
  }, [visible, onClose])

  const reload = async () => {
    const day = await loadDay(userId, date)
    setItems(day.items)
    setLogs(day.logs)
    setOverrides(day.overrides)
  }

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        setLoading(true)
        const day = await loadDay(userId, date)
        if (!active) return
        setItems(day.items)
        setLogs(day.logs)
        setOverrides(day.overrides)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [userId, date])

  const isDone = (id: string) => logs[id]?.status === 'done'
  const total = items.length
  const doneCount = items.filter((it) => isDone(it.id)).length
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0

  const today = todayStr()
  const dayLabel = date === today ? t('today.today') : formatDateHuman(date)

  // Отметить/снять выполнение задачи (оптимистично, с откатом при ошибке).
  const onToggle = async (item: PlannerItem) => {
    const currentlyDone = isDone(item.id)
    setLogs((prev) => {
      const next = { ...prev }
      if (currentlyDone) delete next[item.id]
      else
        next[item.id] = {
          id: 'tmp',
          item_id: item.id,
          date,
          status: 'done',
          value: null,
          note: null,
        }
      return next
    })
    try {
      const newLog = await toggleDone(userId, item.id, date, currentlyDone)
      setLogs((prev) => {
        const next = { ...prev }
        if (newLog) next[item.id] = newLog
        else delete next[item.id]
        return next
      })
      onChanged()
    } catch {
      await reload()
    }
  }

  const fmtTime12 = (hhmm: string): string => {
    if (!hhmm) return ''
    const [h, m] = hhmm.split(':').map(Number)
    if (isNaN(h) || isNaN(m)) return hhmm
    const pm = h >= 12
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
    return `${h12}:${String(m).padStart(2, '0')} ${pm ? 'PM' : 'AM'}`
  }

  const timeLabel = (item: PlannerItem): string => {
    if (item.at_time_start && item.at_time_end)
      return `${fmtTime12(item.at_time_start)}\u2013${fmtTime12(item.at_time_end)}`
    if (item.at_time_start) return fmtTime12(item.at_time_start)
    return ''
  }

  const renderRow = (item: PlannerItem) => {
    const done = isDone(item.id)
    const dot = PRIORITY_DOT[item.priority]
    const time = timeLabel(item)
    const isHabit = item.type === 'habit'
    return (
      <div key={item.id} className={`${rowCls}${done && !editDay ? ' opacity-60' : ''}`}>
        {editDay ? (
          <button
            type="button"
            onClick={() => setEditItem(item)}
            aria-label={item.title}
            className="mt-0.5 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border border-emerald-500/50 text-xs text-emerald-600 transition hover:bg-emerald-500/10 dark:text-emerald-400"
          >
            ✏️
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onToggle(item)}
            aria-label={item.title}
            className={`mt-0.5 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border text-xs font-bold transition ${
              done
                ? 'border-emerald-500 bg-emerald-500 text-neutral-950'
                : 'border-neutral-300 hover:border-emerald-500 dark:border-neutral-600'
            }`}
          >
            {done ? '\u2713' : ''}
          </button>
        )}
        {dot && <span className="mt-1 shrink-0 text-xs leading-none">{dot}</span>}
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
                onClick={() => setSheetItem(item)}
                title={t('habits.openHint')}
                className="ml-1 align-middle text-xs"
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
    )
  }

  return (
    <>
      <div
        className={`${open ? 'animate-fade' : 'animate-fade-out'} fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4`}
        onClick={close}
      >
        <div
          className={`${open ? 'animate-dialog' : 'animate-dialog-out'} max-h-[90vh] w-full overflow-y-auto rounded-t-3xl border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-800 dark:bg-neutral-900 sm:max-w-lg sm:rounded-2xl`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Шапка */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold">{dayLabel}</h2>
              {date !== today && (
                <p className="text-xs text-neutral-500">{formatDateHuman(date)}</p>
              )}
            </div>
            <button
              type="button"
              onClick={close}
              aria-label={t('ai.close')}
              className="shrink-0 rounded-full px-2 py-1 text-lg leading-none text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800"
            >
              ✕
            </button>
          </div>

          {/* Прогресс дня */}
          {total > 0 && (
            <div className="mt-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">
                  {doneCount === total
                    ? t('today.allDone')
                    : t('today.progress', { done: doneCount, total })}
                </p>
                <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                  {pct}%
                </span>
              </div>
              <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}

          {/* Переключатель «Изменить день»: правка дел только на эту дату. */}
          {!loading && items.length > 0 && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setEditDay((v) => !v)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                  editDay
                    ? 'bg-emerald-500 text-neutral-950 hover:bg-emerald-400'
                    : 'border border-neutral-300 text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800'
                }`}
              >
                {editDay ? t('today.editDayDone') : t('today.editDay')}
              </button>
              {editDay && (
                <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">{t('today.editDayHint')}</p>
              )}
            </div>
          )}

          {/* Список дел дня */}
          {loading ? (
            <p className="mt-4 text-sm text-neutral-500 dark:text-neutral-400">{t('common.loading')}</p>
          ) : items.length === 0 ? (
            <p className="mt-4 text-sm text-neutral-500 dark:text-neutral-400">{t('cal.dayEmpty')}</p>
          ) : (
            <section className="mt-4 flex flex-col gap-2">{items.map(renderRow)}</section>
          )}
        </div>
      </div>

      {sheetItem && (
        <HabitSheet
          userId={userId}
          item={sheetItem}
          date={date}
          onClose={() => setSheetItem(null)}
          onChanged={() => {
            void reload()
            onChanged()
          }}
        />
      )}

      {/* Окно правки дела на конкретный день. */}
      {editItem && (
        <DayEditSheet
          userId={userId}
          date={date}
          item={editItem}
          hasOverride={!!overrides[editItem.id] && !overrides[editItem.id].frozen}
          existing={overrides[editItem.id] ?? null}
          onClose={() => setEditItem(null)}
          onSaved={() => {
            void reload()
            onChanged()
          }}
        />
      )}
    </>
  )
}
