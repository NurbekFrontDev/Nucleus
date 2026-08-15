import { useEffect, useState } from 'react'
import { useLang } from '../lib/i18n'
import { formatDateHuman } from '../lib/db'
import { useAnimatedMount } from '../lib/useAnimatedMount'
import TimePicker from './TimePicker'
import {
  saveDayOverride,
  clearDayOverride,
  loadWeekdayOverrides,
  saveWeekdayOverride,
  clearWeekdayOverride,
  isoWeekday,
  todayStr,
  endTimeFromDuration,
  type PlannerItem,
  type PlannerDayOverride,
  type Priority,
  type TimeOfDay,
} from '../lib/planner'

// Окно «Изменить на этот день».
// Меняет время/секцию/важность/заметку дела ТОЛЬКО на выбранную дату,
// не трогая шаблон «Мои дела» и другие дни (см. planner_day_overrides).
// «item» приходит уже с наложенной правкой дня (если она есть),
// поэтому поля формы инициализируются текущими значениями дня.

type Props = {
  userId: string
  date: string
  item: PlannerItem
  hasOverride: boolean
  // Существующая правка дня (если есть) — нужна, чтобы при сохранении сохранить
  // прежний снимок названия/иконки (напр. от заморозки прошлого дня).
  existing?: PlannerDayOverride | null
  onClose: () => void
  onSaved: () => void
}

const SECTIONS: { value: TimeOfDay; key: string }[] = [
  { value: null, key: 'items.secNone' },
  { value: 'morning', key: 'items.secMorning' },
  { value: 'day', key: 'items.secDay' },
  { value: 'evening', key: 'items.secEvening' },
  { value: 'allday', key: 'items.secAllDay' },
]

const PRIORITIES: { value: Priority; key: string }[] = [
  { value: 'none', key: 'items.prioNone' },
  { value: 'low', key: 'items.prioLow' },
  { value: 'medium', key: 'items.prioMedium' },
  { value: 'high', key: 'items.prioHigh' },
]

// Полные названия дней недели по ISO (1=Пн..7=Вс) для подписи «Повторять каждый ...».
const WEEKDAY_LONG: Record<'ru' | 'en', Record<number, string>> = {
  ru: {
    1: 'понедельник',
    2: 'вторник',
    3: 'среду',
    4: 'четверг',
    5: 'пятницу',
    6: 'субботу',
    7: 'воскресенье',
  },
  en: {
    1: 'Monday',
    2: 'Tuesday',
    3: 'Wednesday',
    4: 'Thursday',
    5: 'Friday',
    6: 'Saturday',
    7: 'Sunday',
  },
}

const chipCls = (sel: boolean) =>
  `rounded-lg border px-3 py-1.5 text-sm transition ${
    sel
      ? 'border-emerald-500 bg-emerald-500 font-medium text-neutral-950'
      : 'border-neutral-300 hover:border-emerald-500 dark:border-neutral-700'
  }`

export default function DayEditSheet({ userId, date, item, hasOverride, existing, onClose, onSaved }: Props) {
  const { t, lang } = useLang()
  const [open, setOpen] = useState(true)
  const visible = useAnimatedMount(open, 220)

  // Название и иконка тоже редактируются на конкретный день (шаблон не трогаем).
  const [title, setTitle] = useState<string>(item.title)
  const [icon, setIcon] = useState<string>(item.icon ?? '')
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>(item.time_of_day ?? null)
  const [start, setStart] = useState<string>(item.at_time_start ?? '')
  const [end, setEnd] = useState<string>(item.at_time_end ?? '')
  const initDurationMin = item.duration_min
  const initHours = initDurationMin !== null && initDurationMin >= 60 && initDurationMin % 60 === 0
  const [durationUnit, setDurationUnit] = useState<'min' | 'hour'>(initHours ? 'hour' : 'min')
  const [duration, setDuration] = useState<string>(
    initDurationMin ? (initHours ? String(initDurationMin / 60) : String(initDurationMin)) : '',
  )
  const [priority, setPriority] = useState<Priority>(item.priority)
  const [note, setNote] = useState<string>(item.note ?? '')
  const [busy, setBusy] = useState(false)

  // Применять это время/секцию не только сегодня, а КАЖДЫЙ такой день недели
  // (например каждое воскресенье). Хранится в planner_weekday_overrides.
  const weekday = isoWeekday(date)
  const [applyWeekly, setApplyWeekly] = useState(false)
  const [hadWeekly, setHadWeekly] = useState(false)

  useEffect(() => {
    let alive = true
    loadWeekdayOverrides(userId, weekday).then((rows) => {
      if (!alive) return
      const mine = rows.find((r) => r.item_id === item.id)
      if (mine) {
        setApplyWeekly(true)
        setHadWeekly(true)
      }
    })
    return () => {
      alive = false
    }
  }, [userId, weekday, item.id])

  const close = () => setOpen(false)
  // Когда анимация закрытия проиграла — сообщаем родителю (как в DayPanel).
  useEffect(() => {
    if (!visible) onClose()
  }, [visible, onClose])

  // Пока окно открыто — блокируем прокрутку фона: двигается только само окно.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  const today = todayStr()
  const dayLabel = date === today ? t('today.today') : formatDateHuman(date)

  const durationValue = (raw: string = duration, unit: 'min' | 'hour' = durationUnit): number | null => {
    const value = parseFloat(raw)
    if (!Number.isFinite(value) || value <= 0) return null
    const inMins = unit === 'hour' ? Math.round(value * 60) : Math.round(value)
    return inMins > 0 ? Math.min(1440, inMins) : null
  }

  const hasDuration = durationValue() !== null

  const setStartWithDuration = (value: string) => {
    setStart(value)
    const minutes = durationValue()
    if (minutes) setEnd(endTimeFromDuration(value, minutes))
  }

  const setDurationWithEnd = (value: string, unit: 'min' | 'hour' = durationUnit) => {
    setDuration(value)
    const minutes = durationValue(value, unit)
    if (minutes && start) setEnd(endTimeFromDuration(start, minutes))
  }

  const toggleDurationUnit = () => {
    const nextUnit = durationUnit === 'min' ? 'hour' : 'min'
    const currentMins = durationValue(duration, durationUnit)
    setDurationUnit(nextUnit)
    if (currentMins !== null) {
      const nextVal = nextUnit === 'hour' ? String(+(currentMins / 60).toFixed(2)) : String(currentMins)
      setDurationWithEnd(nextVal, nextUnit)
    }
  }

  const save = async () => {
    if (busy) return
    setBusy(true)
    try {
      const cleanTitle = title.trim()
      const cleanIcon = icon.trim()
      await saveDayOverride(userId, item.id, date, {
        // Если название/иконка не менялись, оставляем прежний снимок (напр.
        // от заморозки прошлого дня), иначе пишем новое значение только на этот день.
        title: cleanTitle && cleanTitle !== item.title ? cleanTitle : (existing?.title ?? null),
        icon: cleanIcon !== (item.icon ?? '') ? cleanIcon || null : (existing?.icon ?? null),
        time_of_day: timeOfDay,
        at_time_start: start || null,
        at_time_end: end || null,
        duration_min: durationValue(),
        priority,
        note: note.trim() ? note.trim() : null,
      })
      // Повторяющаяся правка на этот день недели.
      if (applyWeekly) {
        await saveWeekdayOverride(userId, item.id, weekday, {
          time_of_day: timeOfDay,
          at_time_start: start || null,
          at_time_end: end || null,
          duration_min: durationValue(),
        })
      } else if (hadWeekly) {
        await clearWeekdayOverride(userId, item.id, weekday)
      }
      onSaved()
      close()
    } catch {
      setBusy(false)
    }
  }

  const reset = async () => {
    if (busy) return
    setBusy(true)
    try {
      await clearDayOverride(userId, item.id, date)
      onSaved()
      close()
    } catch {
      setBusy(false)
    }
  }

  return (
    <div
      className={`${open ? 'animate-fade' : 'animate-fade-out'} fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:p-4`}
      onClick={close}
    >
      <div
        className={`${open ? 'animate-dialog' : 'animate-dialog-out'} max-h-[90vh] w-full overflow-y-auto overscroll-contain rounded-t-3xl border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-800 dark:bg-neutral-900 sm:max-w-lg sm:rounded-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Шапка */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{t('dayEdit.title')}</h2>
            <p className="truncate text-xs text-neutral-500">
              {item.icon ? `${item.icon} ` : ''}
              {item.title} · {dayLabel}
            </p>
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

        {/* Название и иконка — только на этот день */}
        <div className="mt-4 flex gap-3">
          <div className="w-20 shrink-0">
            <p className="mb-1.5 text-sm font-medium">{lang === 'en' ? 'Icon' : 'Иконка'}</p>
            <input
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              maxLength={4}
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-center text-sm outline-none transition focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950"
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="mb-1.5 text-sm font-medium">{lang === 'en' ? 'Title' : 'Название'}</p>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950"
            />
          </div>
        </div>

        {/* Секция дня */}
        <div className="mt-4">
          <p className="mb-1.5 text-sm font-medium">{t('items.section')}</p>
          <div className="flex flex-wrap gap-2">
            {SECTIONS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setTimeOfDay(s.value)}
                className={chipCls(timeOfDay === s.value)}
              >
                {t(s.key)}
              </button>
            ))}
          </div>
        </div>

        {/* Время и длительность. При длительности конец рассчитывается сразу. */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          <div>
            <p className="mb-1.5 text-sm font-medium">{t('items.timeStart')}</p>
            <TimePicker value={start} onChange={setStartWithDuration} />
          </div>
          <div>
            <p className="mb-1.5 text-sm font-medium">{t('items.duration')}</p>
            <div className="relative flex items-center">
              <input
                type="number"
                inputMode="decimal"
                step={durationUnit === 'hour' ? '0.25' : '1'}
                min="0.1"
                max={durationUnit === 'hour' ? '24' : '1440'}
                value={duration}
                onChange={(e) => setDurationWithEnd(e.target.value)}
                placeholder={durationUnit === 'hour' ? '1' : t('items.durationPh')}
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 pr-11 text-sm outline-none transition focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950"
              />
              <button
                type="button"
                onClick={toggleDurationUnit}
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded bg-neutral-100 dark:bg-neutral-800 px-1.5 py-1 text-xs font-semibold text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition"
                title={durationUnit === 'hour' ? t('items.hour') : t('items.min')}
              >
                {durationUnit === 'hour' ? t('items.hour') : t('items.min')} ▾
              </button>
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-sm font-medium">{t('items.timeEnd')}</p>
            {hasDuration ? (
              <div className="rounded-lg border border-dashed border-emerald-400/70 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                {start ? endTimeFromDuration(start, durationValue()) : t('items.durationSetStart')}
              </div>
            ) : (
              <TimePicker value={end} onChange={setEnd} />
            )}
          </div>
        </div>

        {/* Важность */}
        <div className="mt-4">
          <p className="mb-1.5 text-sm font-medium">{t('items.priority')}</p>
          <div className="flex flex-wrap gap-2">
            {PRIORITIES.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPriority(p.value)}
                className={chipCls(priority === p.value)}
              >
                {t(p.key)}
              </button>
            ))}
          </div>
        </div>

        {/* Заметка на этот день */}
        <div className="mt-4">
          <p className="mb-1.5 text-sm font-medium">{t('dayEdit.note')}</p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950"
          />
        </div>

        {/* Повторять это время каждый такой день недели */}
        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
          <input
            type="checkbox"
            checked={applyWeekly}
            onChange={(e) => setApplyWeekly(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-emerald-500"
          />
          <span className="min-w-0 text-sm">
            <span className="font-medium">
              {lang === 'en'
                ? `Repeat every ${WEEKDAY_LONG.en[weekday]}`
                : `Повторять каждый ${WEEKDAY_LONG.ru[weekday]}`}
            </span>
            <span className="mt-0.5 block text-xs text-neutral-500">
              {lang === 'en'
                ? 'Time, duration, and day section will apply on this weekday every week.'
                : 'Время, длительность и секция дня будут применяться в этот день недели каждую неделю.'}
            </span>
          </span>
        </label>

        {/* Кнопки */}
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="w-full rounded-xl bg-emerald-500 py-2.5 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-60"
          >
            {busy ? t('common.saving') : t('common.save')}
          </button>
          {hasOverride && (
            <button
              type="button"
              onClick={reset}
              disabled={busy}
              className="w-full rounded-xl border border-neutral-300 py-2.5 text-sm font-medium text-neutral-600 transition hover:border-red-400 hover:text-red-500 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-300"
            >
              {t('dayEdit.reset')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
