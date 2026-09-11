import { useEffect, useState } from 'react'
import { useLang } from '../lib/i18n'
import { monthName, formatDateHuman } from '../lib/db'
import IconButton from './IconButton'
import ConfirmDialog from './ConfirmDialog'
import { useAnimatedMount } from '../lib/useAnimatedMount'
import {
  loadHabitDetail,
  setHabitStatus,
  addReflection,
  deleteReflection,
  isItemOnDate,
  todayStr,
  isStepDone,
  toggleItemStep,
  getItemStepsProgress,
  type PlannerItem,
  type HabitDetail,
  type LogStatus,
} from '../lib/planner'

// Окно привычки в стиле приложения Atoms (П-5, переделка). Открывается по
// нажатию на привычку на экране «Сегодня». Снизу на телефоне, по центру на
// компьютере. Показывает: предложение «Я буду …, …, чтобы стать …», расписание,
// отметку за выбранный день, всего повторений, мини-календарь с редактированием
// истории, проценты/стрики, вехи (milestones) и рефлексию (заметки о прогрессе).

type Props = {
  userId: string
  item: PlannerItem
  date: string // выбранный день на экране «Сегодня»
  onClose: () => void
  onChanged: () => void // сообщить родителю, чтобы перезагрузить день
}

const MILESTONES = [1, 3, 7, 14, 21, 30, 50, 100, 200, 365]
const pad = (n: number) => String(n).padStart(2, '0')

const cellBase = 'flex h-8 w-8 items-center justify-center rounded-lg text-xs transition'

export default function HabitSheet({ userId, item, date, onClose, onChanged }: Props) {
  const { t, lang } = useLang()
  const [open, setOpen] = useState(true)
  const visible = useAnimatedMount(open, 220)

  const [currentItem, setCurrentItem] = useState<PlannerItem>(item)
  useEffect(() => {
    setCurrentItem(item)
  }, [item])

  const [detail, setDetail] = useState<HabitDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<'recent' | 'all'>('recent')
  const [reflText, setReflText] = useState('')
  const [delRefl, setDelRefl] = useState<string | null>(null)

  const today = todayStr()
  const init = new Date((date || today) + 'T00:00:00')
  const [viewYear, setViewYear] = useState(init.getFullYear())
  const [viewMonth, setViewMonth] = useState(init.getMonth())

  const close = () => setOpen(false)
  useEffect(() => {
    if (!visible) onClose()
  }, [visible, onClose])

  const reload = async () => {
    const d = await loadHabitDetail(userId, item.id)
    setDetail(d)
  }

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        setLoading(true)
        const d = await loadHabitDetail(userId, item.id)
        if (active) setDetail(d)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [userId, item.id])

  const WEEKDAYS =
    lang === 'en'
      ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      : ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

  const repeatText = (() => {
    switch (item.repeat_rule) {
      case 'daily':
        return t('items.repeatDaily')
      case 'weekdays':
        return t('items.repeatWeekdays')
      case 'weekly':
        return (item.weekdays ?? []).map((d) => WEEKDAYS[d - 1]).join(', ')
      default:
        return item.start_date ?? ''
    }
  })()
  const timeText =
    item.at_time_start && item.at_time_end
      ? `${item.at_time_start}\u2013${item.at_time_end}`
      : item.at_time_start ?? ''

  // Следующий статус по кругу при нажатии на день: пусто -> сделано -> пропуск -> убрать.
  const cycle = (cur: LogStatus | undefined): 'done' | 'skip' | null => {
    if (cur === 'done') return 'skip'
    if (cur === 'skip') return null
    return 'done'
  }

  const editDay = async (iso: string) => {
    if (busy || iso > today) return
    if (!isItemOnDate(item, iso)) return
    const cur = detail?.statusByDate[iso] as LogStatus | undefined
    const next = cycle(cur)
    setBusy(true)
    try {
      await setHabitStatus(userId, item.id, iso, next)
      await reload()
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const mark = async (target: 'done' | 'skip') => {
    if (busy) return
    const cur = detail?.statusByDate[date]
    const next = cur === target ? null : target
    setBusy(true)
    try {
      await setHabitStatus(userId, item.id, date, next)
      await reload()
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const onToggleStep = async (stepId: string) => {
    if (busy) return
    const isDone = detail?.statusByDate[date] === 'done'
    setBusy(true)
    try {
      const res = await toggleItemStep(userId, currentItem, stepId, date, isDone)
      setCurrentItem({ ...res.updatedItem })
      if (res.taskDoneChanged) {
        await reload()
      }
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const submitReflection = async () => {
    const text = reflText.trim()
    if (!text || busy) return
    setBusy(true)
    try {
      await addReflection(userId, item.id, text)
      setReflText('')
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const removeReflection = async (id: string) => {
    setBusy(true)
    try {
      await deleteReflection(userId, id)
      setDelRefl(null)
      await reload()
    } finally {
      setBusy(false)
    }
  }

  // ===== Мини-календарь месяца =====
  const firstWeekday = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const cells: Array<number | null> = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  const now = new Date(today + 'T00:00:00')
  const atOrAfterCurrentMonth =
    viewYear > now.getFullYear() ||
    (viewYear === now.getFullYear() && viewMonth >= now.getMonth())
  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11)
      setViewYear((y) => y - 1)
    } else setViewMonth((m) => m - 1)
  }
  const nextMonth = () => {
    if (atOrAfterCurrentMonth) return
    if (viewMonth === 11) {
      setViewMonth(0)
      setViewYear((y) => y + 1)
    } else setViewMonth((m) => m + 1)
  }

  const dayCell = (d: number | null, idx: number) => {
    if (d === null) return <span key={idx} />
    const iso = `${viewYear}-${pad(viewMonth + 1)}-${pad(d)}`
    const scheduled = isItemOnDate(item, iso)
    if (!scheduled) {
      return (
        <span key={idx} className={`${cellBase} text-neutral-300 dark:text-neutral-600`}>
          {d}
        </span>
      )
    }
    const st = detail?.statusByDate[iso]
    const future = iso > today
    let cls = 'border border-neutral-300 text-neutral-500 dark:border-neutral-600'
    if (st === 'done') cls = 'bg-emerald-500 font-medium text-white'
    else if (st === 'skip') cls = 'bg-amber-400 font-medium text-white'
    else if (iso === today) cls = 'border border-dashed border-emerald-500 text-emerald-600 dark:text-emerald-400'
    else if (future) cls = 'border border-dashed border-neutral-200 text-neutral-300 dark:border-neutral-700 dark:text-neutral-600'
    return (
      <button
        key={idx}
        type="button"
        disabled={future || busy}
        onClick={() => editDay(iso)}
        title={iso}
        className={`${cellBase} ${cls} ${future ? '' : 'hover:opacity-80'}`}
      >
        {d}
      </button>
    )
  }

  const scheduledForDate = isItemOnDate(item, date)
  const dayLabel = date === today ? t('today.today') : formatDateHuman(date)
  const earned = detail ? MILESTONES.filter((m) => detail.totalDone >= m).length : 0
  const pctShown = detail ? (tab === 'recent' ? detail.pctRecent : detail.pctAll) : 0

  const statBox =
    'rounded-xl bg-neutral-100 px-3 py-2 text-center dark:bg-neutral-800/60'

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
            <div className="flex min-w-0 items-center gap-2">
              {item.icon && <span className="text-xl leading-none">{item.icon}</span>}
              <h2 className="truncate text-lg font-semibold">{item.title}</h2>
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

          {/* Предложение в стиле Atoms */}
          <p className="mt-3 text-base leading-relaxed">
            {t('items.sentenceWill')}{' '}
            <span className="font-semibold underline decoration-emerald-400 decoration-2 underline-offset-4">
              {item.title}
            </span>
            {item.cue ? (
              <>
                {', '}
                <span className="font-semibold underline decoration-violet-400 decoration-2 underline-offset-4">
                  {item.cue}
                </span>
              </>
            ) : null}
            {item.identity ? (
              <>
                {', '}
                {t('items.sentenceBecome')}{' '}
                <span className="font-semibold underline decoration-amber-400 decoration-2 underline-offset-4">
                  {item.identity}
                </span>
              </>
            ) : null}
            {'.'}
          </p>

          {/* Расписание */}
          <p className="mt-2 flex items-center gap-1.5 text-sm text-neutral-500 dark:text-neutral-400">
            <span>🕒</span>
            <span>
              {repeatText}
              {timeText ? ` · ${timeText}` : ''}
            </span>
          </p>

          {item.two_min && (
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              ⏱️ {item.two_min}
            </p>
          )}

          {/* Отметка за выбранный день */}
          <div className="mt-4 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
            <p className="mb-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">
              {t('habits.markFor', { d: dayLabel })}
            </p>
            {scheduledForDate ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => mark('done')}
                  className={`rounded-xl px-3 py-1.5 text-sm font-medium transition disabled:opacity-60 ${
                    detail?.statusByDate[date] === 'done'
                      ? 'bg-emerald-500 text-white'
                      : 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200'
                  }`}
                >
                  {t('habits.markDone')}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => mark('skip')}
                  className={`rounded-xl px-3 py-1.5 text-sm font-medium transition disabled:opacity-60 ${
                    detail?.statusByDate[date] === 'skip'
                      ? 'bg-amber-400 text-white'
                      : 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200'
                  }`}
                >
                  {t('habits.markSkip')}
                </button>
              </div>
            ) : (
              <p className="text-sm text-neutral-400">{t('habits.notScheduledDay')}</p>
            )}
          </div>

          {/* Шаги / Подцели привычки */}
          {currentItem.steps && currentItem.steps.length > 0 && (
            <div className="mt-4 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                  {t('items.stepsTitle')}
                </p>
                {(() => {
                  const isDone = detail?.statusByDate[date] === 'done'
                  const prog = getItemStepsProgress(currentItem, date, isDone)
                  return (
                    <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                      {prog.done}/{prog.total}
                    </span>
                  )
                })()}
              </div>
              <div className="space-y-1.5">
                {currentItem.steps.map((st) => {
                  const isDone = detail?.statusByDate[date] === 'done'
                  const done = isStepDone(currentItem, st.id, date, isDone)
                  return (
                    <div
                      key={st.id}
                      onClick={() => onToggleStep(st.id)}
                      className="flex cursor-pointer select-none items-center gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
                    >
                      <div
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                          done
                            ? 'border-emerald-500 bg-emerald-500 text-white'
                            : 'border-neutral-300 dark:border-neutral-600'
                        }`}
                      >
                        {done && (
                          <svg className="h-3 w-3 stroke-current stroke-[2.5]" viewBox="0 0 24 24" fill="none">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </div>
                      <span
                        className={`text-sm ${
                          done
                            ? 'text-neutral-400 line-through dark:text-neutral-500'
                            : 'text-neutral-700 dark:text-neutral-200'
                        }`}
                      >
                        {st.title}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {loading || !detail ? (
            <p className="mt-4 text-sm text-neutral-500 dark:text-neutral-400">{t('common.loading')}</p>
          ) : (
            <>
              {/* Всего повторений */}
              <div className="mt-4 flex items-end justify-between">
                <div>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    {t('habits.totalReps')}
                  </p>
                  <p className="text-3xl font-semibold">{detail.totalDone}</p>
                </div>
                <p className="text-xs text-neutral-400">
                  {t('habits.since', { d: formatDateHuman(detail.sinceDate) })}
                </p>
              </div>

              {/* Мини-календарь */}
              <div className="mt-3 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
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
                    disabled={atOrAfterCurrentMonth}
                    className="rounded px-2 py-1 text-sm transition hover:bg-neutral-100 disabled:opacity-30 dark:hover:bg-neutral-800"
                  >
                    ›
                  </button>
                </div>
                <div className="grid grid-cols-7 justify-items-center gap-1 text-center text-[10px] text-neutral-400">
                  {WEEKDAYS.map((w) => (
                    <span key={w} className="py-1">
                      {w}
                    </span>
                  ))}
                </div>
                <div className="grid grid-cols-7 justify-items-center gap-1">
                  {cells.map((d, idx) => dayCell(d, idx))}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-neutral-500 dark:text-neutral-400">
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-3 w-3 rounded bg-emerald-500" /> {t('habits.legendDone')}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-3 w-3 rounded bg-amber-400" /> {t('habits.legendSkip')}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-3 w-3 rounded border border-neutral-300 dark:border-neutral-600" /> {t('habits.legendMiss')}
                  </span>
                </div>
                <p className="mt-2 text-[11px] text-neutral-400">{t('habits.calendarHint')}</p>
              </div>

              {/* Рекорды и стрики */}
              <div className="mt-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{t('habits.records')}</h3>
                <div className="flex gap-1 rounded-lg bg-neutral-100 p-0.5 text-xs dark:bg-neutral-800/60">
                  <button
                    type="button"
                    onClick={() => setTab('recent')}
                    className={`rounded-md px-2 py-1 transition ${tab === 'recent' ? 'bg-white shadow-sm dark:bg-neutral-700' : 'text-neutral-500'}`}
                  >
                    {t('habits.recent')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab('all')}
                    className={`rounded-md px-2 py-1 transition ${tab === 'all' ? 'bg-white shadow-sm dark:bg-neutral-700' : 'text-neutral-500'}`}
                  >
                    {t('habits.allTime')}
                  </button>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <div className={statBox}>
                  <p className="text-lg font-semibold">{pctShown}%</p>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400">{t('habits.completion')}</p>
                </div>
                <div className={statBox}>
                  <p className="text-lg font-semibold">🔥 {detail.current}</p>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400">{t('habits.current')}</p>
                </div>
                <div className={statBox}>
                  <p className="text-lg font-semibold">⭐ {detail.best}</p>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400">{t('habits.best')}</p>
                </div>
              </div>

              {/* Вехи */}
              <div className="mt-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{t('habits.milestones')}</h3>
                <span className="text-xs text-neutral-500 dark:text-neutral-400">
                  {t('habits.milestonesEarned', { n: earned })}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {MILESTONES.map((m) => {
                  const got = detail.totalDone >= m
                  return (
                    <span
                      key={m}
                      className={`rounded-xl px-2.5 py-1 text-xs font-medium ${
                        got
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                          : 'bg-neutral-100 text-neutral-400 dark:bg-neutral-800/60 dark:text-neutral-500'
                      }`}
                    >
                      {got ? '🏅 ' : ''}
                      {t('habits.repsShort', { n: m })}
                    </span>
                  )
                })}
              </div>

              {/* Рефлексия */}
              <div className="mt-4">
                <h3 className="text-sm font-semibold">{t('habits.reflection')}</h3>
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  {t('habits.reflectionPrompt', { n: item.title })}
                </p>
                <div className="mt-2 flex gap-2">
                  <textarea
                    value={reflText}
                    onChange={(e) => setReflText(e.target.value)}
                    placeholder={t('habits.reflectionPh')}
                    rows={2}
                    className="min-h-[40px] w-full resize-none rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950"
                  />
                  <button
                    type="button"
                    disabled={busy || !reflText.trim()}
                    onClick={submitReflection}
                    className="shrink-0 self-start rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-50"
                  >
                    {t('habits.reflectionAdd')}
                  </button>
                </div>
                {detail.reflections.length === 0 ? (
                  <p className="mt-2 text-xs text-neutral-400">{t('habits.reflectionEmpty')}</p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-2">
                    {detail.reflections.map((r) => (
                      <li
                        key={r.id}
                        className="flex items-start justify-between gap-2 rounded-lg bg-neutral-50 px-3 py-2 dark:bg-neutral-900/40"
                      >
                        <div className="min-w-0">
                          <p className="text-xs text-neutral-400">{formatDateHuman(r.date)}</p>
                          <p className="whitespace-pre-wrap break-words text-sm">{r.text}</p>
                        </div>
                        <IconButton
                          icon="delete"
                          title={t('common.delete')}
                          onClick={() => setDelRefl(r.id)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!delRefl}
        title={t('habits.deleteReflection')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={() => delRefl && removeReflection(delRefl)}
        onCancel={() => setDelRefl(null)}
      />
    </>
  )
}
