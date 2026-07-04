import { useEffect, useState } from 'react'
import { useLang } from '../lib/i18n'
import { formatDateHuman } from '../lib/db'
import { useAnimatedMount } from '../lib/useAnimatedMount'
import TimePicker from './TimePicker'
import {
  saveDayOverride,
  clearDayOverride,
  todayStr,
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

const chipCls = (sel: boolean) =>
  `rounded-lg border px-3 py-1.5 text-sm transition ${
    sel
      ? 'border-emerald-500 bg-emerald-500 font-medium text-neutral-950'
      : 'border-neutral-300 hover:border-emerald-500 dark:border-neutral-700'
  }`

export default function DayEditSheet({ userId, date, item, hasOverride, existing, onClose, onSaved }: Props) {
  const { t } = useLang()
  const [open, setOpen] = useState(true)
  const visible = useAnimatedMount(open, 220)

  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>(item.time_of_day ?? null)
  const [start, setStart] = useState<string>(item.at_time_start ?? '')
  const [end, setEnd] = useState<string>(item.at_time_end ?? '')
  const [priority, setPriority] = useState<Priority>(item.priority)
  const [note, setNote] = useState<string>(item.note ?? '')
  const [busy, setBusy] = useState(false)

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

  const save = async () => {
    if (busy) return
    setBusy(true)
    try {
      await saveDayOverride(userId, item.id, date, {
        // Название/иконку в этом окне не меняем: сохраняем прежний снимок, если он
        // был (напр. заморозка прошлого дня), иначе null -> берётся из шаблона.
        title: existing?.title ?? null,
        icon: existing?.icon ?? null,
        time_of_day: timeOfDay,
        at_time_start: start || null,
        at_time_end: end || null,
        priority,
        note: note.trim() ? note.trim() : null,
      })
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

        {/* Время */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <p className="mb-1.5 text-sm font-medium">{t('items.timeStart')}</p>
            <TimePicker value={start} onChange={setStart} />
          </div>
          <div>
            <p className="mb-1.5 text-sm font-medium">{t('items.timeEnd')}</p>
            <TimePicker value={end} onChange={setEnd} />
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
