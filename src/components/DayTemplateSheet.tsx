import { useEffect, useState } from 'react'
import { useLang } from '../lib/i18n'
import { formatDateHuman } from '../lib/db'
import { useAnimatedMount } from '../lib/useAnimatedMount'
import ConfirmDialog from './ConfirmDialog'
import {
  loadDayTemplates,
  saveDayTemplate,
  applyDayTemplate,
  deleteDayTemplate,
  todayStr,
  type PlannerItem,
  type DayTemplate,
} from '../lib/planner'

// Окно «Шаблоны дня».
// Идея: набор дел, задающий «форму» дня (напр. «Со сном утром»
// и «Без сна утром»). Шаблон создаётся снимком текущего дня, а
// применяется к выбранной дате — дела добавляются на этот день как
// разовые. Ничего лишнего: снимок текущего дня + применение + удаление.

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
      setDelTpl(null)
      await load()
    } catch (e) {
      setError((e as Error).message)
      setDelTpl(null)
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
            <h2 className="truncate text-lg font-semibold">{ru ? 'Шаблоны дня' : 'Day templates'}</h2>
            <p className="truncate text-xs text-neutral-500">
              {ru ? 'Применить к: ' : 'Apply to: '}
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
        <div className="mt-4 flex flex-col gap-2">
          {loading ? (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('common.loading')}</p>
          ) : templates.length === 0 ? (
            <p className="rounded-xl border border-dashed border-neutral-300 p-4 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
              {ru
                ? 'Пока нет шаблонов. Настройте день и сохраните его как шаблон.'
                : 'No templates yet. Set up a day and save it as a template.'}
            </p>
          ) : (
            templates.map((tpl) => (
              <div
                key={tpl.id}
                className="flex items-start gap-2 rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
              >
                <button
                  type="button"
                  onClick={() => doApply(tpl)}
                  disabled={!!busyId}
                  className="flex min-w-0 flex-1 items-start gap-2 text-left disabled:opacity-60"
                >
                  <span className="shrink-0 text-lg">{tpl.icon || '📋'}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-sm font-medium">{tpl.name}</span>
                    <span className="block truncate text-xs text-neutral-500 dark:text-neutral-400">
                      {busyId === tpl.id
                        ? ru
                          ? 'Применяю…'
                          : 'Applying…'
                        : ru
                          ? `${tpl.item_count} дел · нажмите, чтобы применить`
                          : `${tpl.item_count} tasks · tap to apply`}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setDelTpl(tpl)}
                  aria-label={t('common.delete')}
                  title={t('common.delete')}
                  className="shrink-0 rounded-lg px-2 py-1 text-neutral-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
                >
                  🗑
                </button>
              </div>
            ))
          )}
        </div>

        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

        {/* Сохранить текущий день как шаблон */}
        <div className="mt-4 border-t border-neutral-200 pt-4 dark:border-neutral-800">
          {saveMode ? (
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                {ru ? 'Название шаблона' : 'Template name'}
              </label>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={ru ? 'Напр. Со сном утром' : 'e.g. Sleep-in morning'}
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void doSave()
                }}
              />
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                {ru ? `Будет сохранено дел: ${items.length}` : `Will save ${items.length} tasks`}
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
        title={ru ? 'Удалить шаблон?' : 'Delete template?'}
        message={
          delTpl
            ? ru
              ? `Шаблон «${delTpl.name}» будет удалён. Уже добавленные в дни дела останутся.`
              : `Template "${delTpl.name}" will be deleted. Tasks already added to days will remain.`
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
