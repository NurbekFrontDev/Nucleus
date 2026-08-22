import { useEffect, useState } from 'react'
import { useLang } from '../lib/i18n'
import { formatDateHuman } from '../lib/db'
import { useAnimatedMount } from '../lib/useAnimatedMount'
import ConfirmDialog from './ConfirmDialog'
import { fmt12 } from './TimePicker'
import {
  loadDayTemplates,
  loadDayTemplateItems,
  saveDayTemplate,
  applyDayTemplate,
  deleteDayTemplate,
  formatDuration,
  todayStr,
  type PlannerItem,
  type DayTemplate,
  type DayTemplateItem,
  type TimeOfDay,
} from '../lib/planner'

// Окно «Шаблоны дня» с возможностью быстрого раскрытия состава шаблона (▼ / ▲).
type Props = {
  userId: string
  date: string
  items: PlannerItem[]
  onClose: () => void
  onApplied: () => void
}

export default function DayTemplateSheet({ userId, date, items, onClose, onApplied }: Props) {
  const { t, lang } = useLang()
  const ru = lang === 'ru'
  const [open, setOpen] = useState(true)
  const visible = useAnimatedMount(open, 220)

  const [templates, setTemplates] = useState<DayTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')

  // Кэш элементов шаблонов для быстрого отображения
  const [itemsCache, setItemsCache] = useState<Record<string, DayTemplateItem[]>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Сохранение текущего дня как шаблона.
  const [saveMode, setSaveMode] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  // Подтверждение удаления.
  const [delTpl, setDelTpl] = useState<DayTemplate | null>(null)

  const close = () => setOpen(false)
  useEffect(() => {
    if (!visible) onClose()
  }, [visible, onClose])

  // Пока окно открыто — блокируем прокрутку фона.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  const load = async () => {
    try {
      const list = await loadDayTemplates(userId)
      setTemplates(list)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  const dayLabel = date === todayStr() ? (ru ? 'сегодня' : 'today') : formatDateHuman(date)

  const fetchItemsFor = async (tplId: string): Promise<DayTemplateItem[]> => {
    if (itemsCache[tplId]) return itemsCache[tplId]
    const data = await loadDayTemplateItems(userId, tplId)
    setItemsCache((prev) => ({ ...prev, [tplId]: data }))
    return data
  }

  const toggleExpand = async (tplId: string) => {
    if (expandedId === tplId) {
      setExpandedId(null)
      return
    }
    setExpandedId(tplId)
    if (!itemsCache[tplId]) {
      try {
        await fetchItemsFor(tplId)
      } catch (e) {
        console.error(e)
      }
    }
  }

  const doSave = async () => {
    const nm = name.trim()
    if (!nm || saving) return
    setSaving(true)
    setError('')
    try {
      await saveDayTemplate(userId, nm, items)
      setName('')
      setSaveMode(false)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const doApply = async (tpl: DayTemplate) => {
    if (busyId) return
    setBusyId(tpl.id)
    setError('')
    try {
      await applyDayTemplate(userId, tpl.id, date)
      onApplied()
      close()
    } catch (e) {
      setError((e as Error).message)
      setBusyId(null)
    }
  }

  const doDelete = async () => {
    if (!delTpl) return
    try {
      await deleteDayTemplate(userId, delTpl.id)
      if (expandedId === delTpl.id) setExpandedId(null)
      setDelTpl(null)
      await load()
    } catch (e) {
      setError((e as Error).message)
      setDelTpl(null)
    }
  }

  const sectionLabel = (tod: TimeOfDay | null): string => {
    switch (tod) {
      case 'morning':
        return t('today.morning')
      case 'day':
        return t('today.day')
      case 'evening':
        return t('today.evening')
      case 'allday':
        return t('today.allday')
      default:
        return t('today.noTime')
    }
  }

  const timeLabel = (it: { at_time_start: string | null; at_time_end: string | null }): string => {
    const s = it.at_time_start ? fmt12(it.at_time_start) : ''
    const e = it.at_time_end ? fmt12(it.at_time_end) : ''
    if (s && e) return `${s} – ${e}`
    return s || e || ''
  }

  return (
    <div
      className={`${open ? 'animate-fade' : 'animate-fade-out'} fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:p-4`}
      onClick={close}
    >
      <div
        className={`${open ? 'animate-dialog' : 'animate-dialog-out'} flex max-h-[90vh] w-full flex-col overscroll-contain rounded-t-3xl border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-800 dark:bg-neutral-900 sm:max-w-lg sm:rounded-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Шапка */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              {t('tpl.title')}
            </h2>
            <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
              {t('tpl.applyTo')}
              {dayLabel}
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

        {/* Список шаблонов */}
        <div className="mt-4 flex-1 space-y-2.5 overflow-y-auto pr-1">
          {loading ? (
            <p className="py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
              {t('common.loading')}
            </p>
          ) : templates.length === 0 ? (
            <p className="rounded-xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
              {t('tpl.empty')}
            </p>
          ) : (
            templates.map((tpl) => {
              const isExpanded = expandedId === tpl.id
              const cached = itemsCache[tpl.id]

              return (
                <div
                  key={tpl.id}
                  className="rounded-xl border border-neutral-200/90 bg-white shadow-sm transition dark:border-neutral-800 dark:bg-neutral-900"
                >
                  {/* Верхняя плашка карточки */}
                  <div className="flex items-center gap-2 p-3">
                    <button
                      type="button"
                      onClick={() => toggleExpand(tpl.id)}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                    >
                      <span className="shrink-0 text-xl">{tpl.icon || '📋'}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-neutral-800 dark:text-neutral-100">
                          {tpl.name}
                        </span>
                        <span className="block truncate text-xs text-neutral-500 dark:text-neutral-400">
                          {t('tpl.tasksCount', { n: tpl.item_count })}
                        </span>
                      </span>
                    </button>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {/* Кнопка быстрого применения */}
                      <button
                        type="button"
                        onClick={() => doApply(tpl)}
                        disabled={!!busyId}
                        className="flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-neutral-950 shadow-sm transition hover:bg-emerald-400 disabled:opacity-60"
                        title={t('tpl.apply')}
                      >
                        {busyId === tpl.id ? (
                          '⏳'
                        ) : (
                          <>
                            <span>✓</span>
                            <span>{t('tpl.apply')}</span>
                          </>
                        )}
                      </button>

                      {/* Раскрыть / Свернуть (треугольник) */}
                      <button
                        type="button"
                        onClick={() => toggleExpand(tpl.id)}
                        className="rounded-lg border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                        title={isExpanded ? (ru ? 'Свернуть' : 'Collapse') : ru ? 'Раскрыть' : 'Expand'}
                      >
                        {isExpanded ? '▲' : '▼'}
                      </button>

                      {/* Удаление */}
                      <button
                        type="button"
                        onClick={() => setDelTpl(tpl)}
                        aria-label={t('common.delete')}
                        title={t('common.delete')}
                        className="shrink-0 rounded-lg p-1.5 text-neutral-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
                      >
                        🗑
                      </button>
                    </div>
                  </div>

                  {/* Инлайн-раскрытие дел внутри карточки */}
                  {isExpanded && (
                    <div className="border-t border-neutral-100 bg-neutral-50/70 p-3 dark:border-neutral-800/80 dark:bg-neutral-800/30">
                      {!cached ? (
                        <p className="py-2 text-center text-xs text-neutral-400">
                          {t('common.loading')}
                        </p>
                      ) : cached.length === 0 ? (
                        <p className="py-2 text-center text-xs text-neutral-400">
                          {ru ? 'В шаблоне нет дел' : 'No items'}
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {cached.map((ci, cidx) => {
                            const dur = formatDuration(ci.duration_min, lang === 'en' ? 'en' : 'ru')
                            const tme = timeLabel(ci)

                            return (
                              <div
                                key={cidx}
                                className="flex items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-1.5 text-xs shadow-2xs dark:bg-neutral-900"
                              >
                                <div className="flex min-w-0 items-center gap-1.5">
                                  <span className="text-[10px] text-neutral-400">#{cidx + 1}</span>
                                  {ci.icon && <span>{ci.icon}</span>}
                                  <span className="truncate font-medium text-neutral-800 dark:text-neutral-200">
                                    {ci.title}
                                  </span>
                                </div>
                                <div className="flex shrink-0 items-center gap-1.5 text-[10px] text-neutral-400">
                                  {tme && <span>🕒 {tme}</span>}
                                  {dur && <span>⏱️ {dur}</span>}
                                  <span className="rounded bg-neutral-100 px-1 py-0.5 dark:bg-neutral-800">
                                    {sectionLabel(ci.time_of_day)}
                                  </span>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

        {/* Сохранить текущий день как шаблон */}
        <div className="mt-4 border-t border-neutral-200 pt-4 dark:border-neutral-800">
          {saveMode ? (
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                {t('tpl.nameLabel')}
              </label>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('tpl.namePlaceholder')}
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void doSave()
                }}
              />
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                {t('tpl.willSaveCount', { n: items.length })}
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSaveMode(false)
                    setName('')
                  }}
                  className="rounded-lg border border-neutral-300 px-4 py-2 text-sm transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  onClick={doSave}
                  disabled={saving || !name.trim()}
                  className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-60"
                >
                  {saving ? t('common.saving') : t('common.save')}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setSaveMode(true)}
              disabled={items.length === 0}
              className="w-full rounded-xl border border-neutral-300 py-2.5 text-sm font-medium text-neutral-600 transition hover:border-emerald-500 hover:text-emerald-600 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300"
            >
              {items.length === 0
                ? ru
                  ? 'Добавьте дела, чтобы сохранить день как шаблон'
                  : 'Add tasks to save this day as a template'
                : ru
                  ? '💾 Сохранить текущий день как шаблон'
                  : '💾 Save current day as template'}
            </button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!delTpl}
        title={t('tpl.deleteConfirmTitle')}
        message={
          delTpl
            ? t('tpl.deleteConfirmMsg', { name: delTpl.name })
            : ''
        }
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={doDelete}
        onCancel={() => setDelTpl(null)}
      />
    </div>
  )
}
