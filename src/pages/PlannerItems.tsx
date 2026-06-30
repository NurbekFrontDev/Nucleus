import { useEffect, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useLang } from '../lib/i18n'
import Select from '../components/Select'
import DatePicker from '../components/DatePicker'
import TimePicker from '../components/TimePicker'
import IconButton from '../components/IconButton'
import ConfirmDialog from '../components/ConfirmDialog'
import {
  loadAllItems,
  createItem,
  updateItem,
  archiveItem,
  PRIORITY_DOT,
  type PlannerItem,
  type PlannerType,
  type RepeatRule,
  type Priority,
  type TimeOfDay,
  type ItemInput,
} from '../lib/planner'

// Экран «Мои дела»: единое место, где заводят и редактируют дела и привычки
// (П-5, переделка под стиль Atoms). Это «склад/конструктор»: тут ТОЛЬКО
// добавление, изменение и удаление. Отмечать выполнение и смотреть стрики/
// историю привычки — на экране «Сегодня» (там по нажатию на привычку
// открывается окно в стиле Atoms). В форме переключатель «Дело / Привычка»;
// для привычки — конструктор-предложение «Я буду [действие], [когда и где],
// чтобы стать [кем]» и версия на 2 минуты.

const cardCls =
  'rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900'
const inputCls =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950'
const labelCls = 'mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400'

type FormState = {
  type: PlannerType
  title: string
  note: string
  repeat_rule: RepeatRule
  weekdays: number[]
  start_date: string
  priority: Priority
  important: boolean
  time_of_day: TimeOfDay
  at_time_start: string
  at_time_end: string
  icon: string
  cue: string
  identity: string
  two_min: string
}

const emptyForm: FormState = {
  type: 'task',
  title: '',
  note: '',
  repeat_rule: 'none',
  weekdays: [],
  start_date: '',
  priority: 'none',
  important: false,
  time_of_day: null,
  at_time_start: '',
  at_time_end: '',
  icon: '',
  cue: '',
  identity: '',
  two_min: '',
}

export default function PlannerItems() {
  const { user } = useAuth()
  const { t, lang } = useLang()
  const [items, setItems] = useState<PlannerItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [delItem, setDelItem] = useState<PlannerItem | null>(null)

  const WEEKDAYS =
    lang === 'en'
      ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      : ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

  const loadAll = async () => {
    if (!user) return
    try {
      setLoading(true)
      const list = await loadAllItems(user.id)
      setItems(list)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const openAdd = () => {
    setEditId(null)
    setForm(emptyForm)
    setShowForm(true)
  }

  const openEdit = (it: PlannerItem) => {
    // Если форма уже открыта на этом же деле — закрываем (тоггл).
    if (showForm && editId === it.id) {
      cancel()
      return
    }
    setEditId(it.id)
    setForm({
      type: it.type,
      title: it.title,
      note: it.note ?? '',
      repeat_rule: it.repeat_rule,
      weekdays: it.weekdays ?? [],
      start_date: it.start_date ?? '',
      priority: it.priority,
      important: it.important,
      time_of_day: it.time_of_day,
      at_time_start: it.at_time_start ?? '',
      at_time_end: it.at_time_end ?? '',
      icon: it.icon ?? '',
      cue: it.cue ?? '',
      identity: it.identity ?? '',
      two_min: it.two_min ?? '',
    })
    setShowForm(true)
  }

  const cancel = () => {
    setShowForm(false)
    setEditId(null)
    setForm(emptyForm)
    setError('')
  }

  // При смене типа на «Привычка» разовое повторение не подходит — ставим «каждый день».
  const setType = (type: PlannerType) => {
    setForm((f) => ({
      ...f,
      type,
      repeat_rule: type === 'habit' && f.repeat_rule === 'none' ? 'daily' : f.repeat_rule,
    }))
  }

  const toggleWeekday = (d: number) => {
    setForm((f) => ({
      ...f,
      weekdays: f.weekdays.includes(d)
        ? f.weekdays.filter((x) => x !== d)
        : [...f.weekdays, d].sort(),
    }))
  }

  const submit = async () => {
    if (!user) return
    const isHabit = form.type === 'habit'
    if (!form.title.trim()) {
      setError(isHabit ? t('items.errHabitTitle') : t('items.errTitle'))
      return
    }
    if (form.repeat_rule === 'weekly' && form.weekdays.length === 0) {
      setError(t('items.errWeekdays'))
      return
    }
    setError('')
    setSaving(true)
    try {
      const input: ItemInput = {
        type: form.type,
        title: form.title.trim(),
        note: form.note.trim() || null,
        repeat_rule: form.repeat_rule,
        weekdays: form.repeat_rule === 'weekly' ? form.weekdays : null,
        start_date: form.start_date || null,
        priority: form.priority,
        important: form.important,
        time_of_day: form.time_of_day,
        at_time_start: form.at_time_start || null,
        at_time_end: form.at_time_end || null,
        icon: form.icon.trim() || null,
        cue: isHabit ? form.cue.trim() || null : null,
        identity: isHabit ? form.identity.trim() || null : null,
        two_min: isHabit ? form.two_min.trim() || null : null,
      }
      if (editId) await updateItem(user.id, editId, input)
      else await createItem(user.id, input)
      cancel()
      await loadAll()
    } catch (e) {
      setError((e as Error).message || t('common.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!user || !delItem) return
    try {
      await archiveItem(user.id, delItem.id)
      setDelItem(null)
      await loadAll()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const describeRepeat = (it: PlannerItem): string => {
    switch (it.repeat_rule) {
      case 'daily':
        return t('items.repeatDaily')
      case 'weekdays':
        return t('items.repeatWeekdays')
      case 'weekly':
        return (it.weekdays ?? []).map((d) => WEEKDAYS[d - 1]).join(', ')
      default:
        return it.start_date ? it.start_date : t('items.repeatNone')
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

  const timeLabel = (it: PlannerItem): string => {
    if (it.at_time_start && it.at_time_end) return `${fmtTime12(it.at_time_start)}\u2013${fmtTime12(it.at_time_end)}`
    if (it.at_time_start) return fmtTime12(it.at_time_start)
    if (it.time_of_day === 'morning') return t('items.secMorning')
    if (it.time_of_day === 'day') return t('items.secDay')
    if (it.time_of_day === 'evening') return t('items.secEvening')
    if (it.time_of_day === 'allday') return t('items.secAllDay')
    return ''
  }

  const isHabitForm = form.type === 'habit'

  // Форма добавления/редактирования. При добавлении показывается сверху,
  // при редактировании — встраивается прямо под нужным делом (см. ниже).
  const renderForm = () => (
    <div className={`${cardCls} animate-pop flex flex-col gap-3`}>
      <h2 className="text-base font-semibold">
        {editId
          ? isHabitForm
            ? t('items.editHabit')
            : t('items.editTitle')
          : isHabitForm
            ? t('items.newHabit')
            : t('items.newTitle')}
      </h2>

      {/* Переключатель Дело / Привычка */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setType('task')}
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
            !isHabitForm
              ? 'bg-emerald-500 text-neutral-950'
              : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
          }`}
        >
          {t('items.typeTask')}
        </button>
        <button
          type="button"
          onClick={() => setType('habit')}
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
            isHabitForm
              ? 'bg-emerald-500 text-neutral-950'
              : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
          }`}
        >
          🔁 {t('items.typeHabit')}
        </button>
      </div>

      <div>
        <label className={labelCls}>{isHabitForm ? t('items.habitName') : t('items.name')}</label>
        <input
          className={inputCls}
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          placeholder={isHabitForm ? t('items.habitNamePh') : t('items.namePh')}
        />
      </div>

      {/* Конструктор-предложение для привычки */}
      {isHabitForm && (
        <>
          <div>
            <label className={labelCls}>{t('items.when')}</label>
            <input
              className={inputCls}
              value={form.cue}
              onChange={(e) => setForm((f) => ({ ...f, cue: e.target.value }))}
              placeholder={t('items.whenPh')}
            />
          </div>
          <div>
            <label className={labelCls}>{t('items.identity')}</label>
            <input
              className={inputCls}
              value={form.identity}
              onChange={(e) => setForm((f) => ({ ...f, identity: e.target.value }))}
              placeholder={t('items.identityPh')}
            />
          </div>
          <div className="rounded-lg bg-neutral-50 p-3 text-sm dark:bg-neutral-800/40">
            {t('items.sentenceWill')}{' '}
            <span className="font-medium text-emerald-600 dark:text-emerald-400">
              {form.title.trim() || t('items.phAction')}
            </span>
            {', '}
            <span className="font-medium text-violet-600 dark:text-violet-400">
              {form.cue.trim() || t('items.phWhen')}
            </span>
            {', '}
            {t('items.sentenceBecome')}{' '}
            <span className="font-medium text-amber-600 dark:text-amber-400">
              {form.identity.trim() || t('items.phIdentity')}
            </span>
            {'.'}
          </div>
          <div>
            <label className={labelCls}>{t('items.twoMin')}</label>
            <input
              className={inputCls}
              value={form.two_min}
              onChange={(e) => setForm((f) => ({ ...f, two_min: e.target.value }))}
              placeholder={t('items.twoMinPh')}
            />
          </div>
        </>
      )}

      <div>
        <label className={labelCls}>{t('items.notePh')}</label>
        <input
          className={inputCls}
          value={form.note}
          onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
          placeholder={t('items.notePh')}
        />
      </div>

      <div>
        <label className={labelCls}>{t('items.repeat')}</label>
        <Select
          value={form.repeat_rule}
          onChange={(v) => setForm((f) => ({ ...f, repeat_rule: v as RepeatRule }))}
          options={[
            ...(isHabitForm ? [] : [{ value: 'none', label: t('items.repeatNone') }]),
            { value: 'daily', label: t('items.repeatDaily') },
            { value: 'weekdays', label: t('items.repeatWeekdays') },
            { value: 'weekly', label: t('items.repeatWeekly') },
          ]}
        />
      </div>

      {form.repeat_rule === 'weekly' && (
        <div>
          <label className={labelCls}>{t('items.weekdays')}</label>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((w, idx) => {
              const d = idx + 1
              const on = form.weekdays.includes(d)
              return (
                <button
                  key={w}
                  type="button"
                  onClick={() => toggleWeekday(d)}
                  className={`h-9 w-9 rounded-lg text-xs font-medium transition ${
                    on
                      ? 'bg-emerald-500 text-neutral-950'
                      : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
                  }`}
                >
                  {w}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {form.repeat_rule === 'none' && !isHabitForm && (
        <div>
          <label className={labelCls}>{t('items.startDate')}</label>
          <DatePicker
            value={form.start_date}
            onChange={(v) => setForm((f) => ({ ...f, start_date: v }))}
          />
        </div>
      )}

      {(form.repeat_rule !== 'none' || isHabitForm) && (
        <div>
          <label className={labelCls}>{t('items.startFrom')}</label>
          <DatePicker
            value={form.start_date}
            onChange={(v) => setForm((f) => ({ ...f, start_date: v }))}
          />
        </div>
      )}

      <div>
        <label className={labelCls}>{t('items.priority')}</label>
        <Select
          value={form.priority}
          onChange={(v) => setForm((f) => ({ ...f, priority: v as Priority }))}
          options={[
            { value: 'none', label: t('items.prioNone') },
            { value: 'low', label: t('items.prioLow') },
            { value: 'medium', label: t('items.prioMedium') },
            { value: 'high', label: t('items.prioHigh') },
          ]}
        />
      </div>

      <div>
        <button
          type="button"
          onClick={() => setForm((f) => ({ ...f, important: !f.important }))}
          className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition ${
            form.important
              ? 'border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-500/60 dark:bg-amber-500/10 dark:text-amber-300'
              : 'border-neutral-300 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'
          }`}
        >
          <span>{form.important ? '⭐' : '☆'}</span>
          <span>{t('items.important')}</span>
        </button>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{t('items.importantHint')}</p>
      </div>

      <div>
        <label className={labelCls}>{t('items.section')}</label>
        <Select
          value={form.time_of_day ?? 'none'}
          onChange={(v) =>
            setForm((f) => ({ ...f, time_of_day: v === 'none' ? null : (v as TimeOfDay) }))
          }
          options={[
            { value: 'none', label: t('items.secNone') },
            { value: 'morning', label: t('items.secMorning') },
            { value: 'day', label: t('items.secDay') },
            { value: 'evening', label: t('items.secEvening') },
            { value: 'allday', label: t('items.secAllDay') },
          ]}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelCls}>{t('items.timeStart')}</label>
          <TimePicker
            value={form.at_time_start}
            onChange={(v) => setForm((f) => ({ ...f, at_time_start: v }))}
          />
        </div>
        <div>
          <label className={labelCls}>{t('items.timeEnd')}</label>
          <TimePicker
            value={form.at_time_end}
            onChange={(v) => setForm((f) => ({ ...f, at_time_end: v }))}
          />
        </div>
      </div>

      <div>
        <label className={labelCls}>{t('items.icon')}</label>
        <input
          className={inputCls}
          value={form.icon}
          onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))}
          placeholder="📖"
        />
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={cancel}
          className="rounded-lg border border-neutral-300 px-4 py-2 text-sm transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={submit}
          className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-60"
        >
          {saving ? t('common.saving') : t('items.save')}
        </button>
      </div>
    </div>
  )

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      {/* Закреплённая шапка: заголовок + кнопка добавления не движутся при прокрутке. */}
      <div className="sticky top-0 z-20 -mx-4 flex items-center justify-between gap-2 border-b border-neutral-200/70 bg-white/85 px-4 py-3 backdrop-blur dark:border-neutral-800/70 dark:bg-neutral-950/85">
        <h1 className="text-xl font-semibold">{t('pnav.items')}</h1>
        {!showForm && (
          <button
            type="button"
            onClick={openAdd}
            className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-neutral-950 transition hover:bg-emerald-400"
          >
            {t('items.add')}
          </button>
        )}
      </div>

      {/* Форма добавления — сверху; форма редактирования — встроена под делом ниже. */}
      {showForm && !editId && renderForm()}

      {loading ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('common.loading')}</p>
      ) : items.length === 0 && !showForm ? (
        <p className="rounded-xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
          {t('items.empty')}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((it) => {
            const dot = PRIORITY_DOT[it.priority]
            const time = timeLabel(it)
            const isHabitItem = it.type === 'habit'
            const editing = showForm && editId === it.id
            return (
              <div key={it.id} className="flex flex-col gap-2">
                <div
                  className={`flex items-start gap-3 ${cardCls}${
                    editing ? ' border-emerald-500/60 ring-1 ring-emerald-500/40' : ''
                  }`}
                >
                  {dot && <span className="mt-0.5 shrink-0 text-xs leading-none">{dot}</span>}
                  {it.icon && <span className="shrink-0">{it.icon}</span>}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="break-words text-sm font-medium">{it.title}</p>
                      {it.important && (
                        <span className="shrink-0 text-xs" title={t('items.important')}>⭐</span>
                      )}
                      {isHabitItem && (
                        <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                          🔁 {t('items.typeHabit')}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                      {describeRepeat(it)}
                      {time ? ` · ${time}` : ''}
                    </p>
                    {isHabitItem && it.identity && (
                      <p className="mt-0.5 break-words text-xs text-neutral-500 dark:text-neutral-400">
                        {t('items.sentenceBecomeShort')} {it.identity}
                      </p>
                    )}
                    {it.note && (
                      <p className="mt-0.5 truncate text-xs text-neutral-400">{it.note}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <IconButton icon="edit" title={t('common.edit')} onClick={() => openEdit(it)} />
                    <IconButton
                      icon="delete"
                      title={t('common.delete')}
                      onClick={() => setDelItem(it)}
                    />
                  </div>
                </div>
                {/* Выпадающее окно редактирования появляется прямо под этим делом. */}
                {editing && renderForm()}
              </div>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!delItem}
        title={delItem?.type === 'habit' ? t('items.deleteHabitTitle') : t('items.deleteTitle')}
        message={
          delItem
            ? delItem.type === 'habit'
              ? t('items.deleteHabitMsg', { n: delItem.title })
              : t('items.deleteMsg', { n: delItem.title })
            : ''
        }
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDelItem(null)}
      />
    </div>
  )
}
