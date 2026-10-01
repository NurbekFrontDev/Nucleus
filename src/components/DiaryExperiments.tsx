import { useMemo, useState } from 'react'
import { useLang } from '../lib/i18n'
import type { DiaryEntry, DiaryExperiment, ExperimentPatch } from '../lib/diary'
import ConfirmDialog from './ConfirmDialog'
import DatePicker from './DatePicker'

// Блок прогресса экспериментов/челленджей: название, день X из Y, серия
// успехов, последний совет коуча. Прогресс считается по готовым записям,
// связанным с экспериментом (day_number из выжимки AI).
// У каждой карточки есть ✏️ (полное редактирование: название, срок, критерии,
// дата старта) и 🗑 (удаление с отвязкой записей) — тот же эмодзи-стиль, что
// у карточек записей.

type ExperimentProgress = {
  experiment: DiaryExperiment
  dayNumber: number | null
  targetDays: number | null
  streak: number
  coachTip: string | null
}

function computeProgress(entries: DiaryEntry[], experiments: DiaryExperiment[]): ExperimentProgress[] {
  return experiments.map((experiment) => {
    const linked = entries
      .filter((e) => e.experiment_id === experiment.id && e.status === 'ready')
      .sort((a, b) => (a.entry_date < b.entry_date ? -1 : a.entry_date > b.entry_date ? 1 : 0))

    // День: из последней выжимки (AI считает его по поданному last_day_number).
    let dayNumber: number | null = null
    for (let i = linked.length - 1; i >= 0; i--) {
      const dn = linked[i].summary?.experiment?.day_number
      if (typeof dn === 'number') {
        dayNumber = dn
        break
      }
    }

    // Серия успехов: сколько дней подряд с конца соблюдено (❌/пропуск рвёт).
    let streak = 0
    for (let i = linked.length - 1; i >= 0; i--) {
      const st = linked[i].summary?.experiment?.success_status
      if (st === true) streak++
      else break
    }

    const lastTip = [...linked].reverse().find((e) => e.summary?.experiment?.coach_tip)
    return {
      experiment,
      dayNumber,
      targetDays: experiment.target_days ?? null,
      streak,
      coachTip: lastTip?.summary?.experiment?.coach_tip ?? null,
    }
  })
}

const inputCls =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100'

// Форма редактирования одной карточки: полный контроль над экспериментом.
function ExperimentEditForm({
  experiment,
  busy,
  onSave,
  onCancel,
}: {
  experiment: DiaryExperiment
  busy: boolean
  onSave: (patch: ExperimentPatch) => void
  onCancel: () => void
}) {
  const { t } = useLang()
  const [title, setTitle] = useState(experiment.title)
  const [days, setDays] = useState(experiment.target_days != null ? String(experiment.target_days) : '')
  const [criteria, setCriteria] = useState(experiment.criteria ?? '')
  const [startedOn, setStartedOn] = useState(experiment.started_on)

  const canSave = title.trim().length > 0 && !busy
  const save = () => {
    if (!canSave) return
    const n = parseInt(days, 10)
    onSave({
      title: title.trim(),
      criteria: criteria.trim() || null,
      target_days: Number.isFinite(n) && n > 0 ? n : null,
      started_on: startedOn || experiment.started_on,
    })
  }

  return (
    <div className="flex flex-col gap-2.5">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
          {t('diary.expTitleLabel')}
        </span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
      </label>
      <div className="flex gap-2">
        <label className="flex w-32 flex-col gap-1">
          <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
            {t('diary.expDaysLabel')}
          </span>
          <input
            type="number"
            min={1}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            placeholder="30"
            className={inputCls}
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
            {t('diary.expStartLabel')}
          </span>
          {/* Календарь в общем стиле приложения (никаких дефолтных <input type=date>) */}
          <DatePicker value={startedOn} onChange={setStartedOn} placement="top" />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
          {t('diary.expCriteriaLabel')}
        </span>
        <textarea
          value={criteria}
          onChange={(e) => setCriteria(e.target.value)}
          rows={2}
          placeholder={t('diary.expCriteriaPh')}
          className={`${inputCls} resize-none`}
        />
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className="rounded-lg bg-neutral-900 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-30 dark:bg-emerald-500 dark:hover:bg-emerald-600"
        >
          {busy ? '…' : t('diary.save')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-lg border border-neutral-300 px-3.5 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-30 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  )
}

export default function DiaryExperiments({
  experiments,
  recentEntries,
  onEdit,
  onDelete,
}: {
  experiments: DiaryExperiment[]
  recentEntries: DiaryEntry[]
  onEdit?: (experiment: DiaryExperiment, patch: ExperimentPatch) => Promise<void>
  onDelete?: (experiment: DiaryExperiment) => Promise<void>
}) {
  const { t } = useLang()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const progress = useMemo(
    () => computeProgress(recentEntries, experiments),
    [recentEntries, experiments],
  )

  if (experiments.length === 0) return null

  const saveEdit = async (experiment: DiaryExperiment, patch: ExperimentPatch) => {
    if (!onEdit || busyId) return
    setBusyId(experiment.id)
    try {
      await onEdit(experiment, patch)
      setEditingId(null)
    } catch {
      // toast показывает экран
    } finally {
      setBusyId(null)
    }
  }

  const doDelete = async (experiment: DiaryExperiment) => {
    if (!onDelete || busyId) return
    setBusyId(experiment.id)
    try {
      await onDelete(experiment)
      setConfirmingId(null)
    } catch {
      // toast показывает экран
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="mt-6">
      <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wider text-neutral-400">
        🧪 {t('diary.experimentsTitle')}
      </h2>
      <div className="flex flex-col gap-2">
        {progress.map(({ experiment, dayNumber, targetDays, streak, coachTip }) => {
          const pct =
            dayNumber && targetDays ? Math.min(100, Math.round((dayNumber / targetDays) * 100)) : null
          const busy = busyId === experiment.id
          return (
            <div
              key={experiment.id}
              className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/60"
            >
              {editingId === experiment.id ? (
                <ExperimentEditForm
                  experiment={experiment}
                  busy={busy}
                  onSave={(patch) => void saveEdit(experiment, patch)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <>
                  {/* Заголовок + ✏️/🗑 в правом верхнем углу: длинное название
                      просто переносится на новую строку, кнопки не сдвигаются */}
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                      {experiment.title}
                    </span>
                    {(onEdit || onDelete) && !busy && (
                      <span className="flex shrink-0 items-center gap-1">
                        {onEdit && (
                          <button
                            type="button"
                            onClick={() => setEditingId(experiment.id)}
                            title={t('diary.expEdit')}
                            aria-label={t('diary.expEdit')}
                            className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                          >
                            ✏️
                          </button>
                        )}
                        {onDelete && (
                          <button
                            type="button"
                            onClick={() => setConfirmingId(experiment.id)}
                            title={t('common.delete')}
                            aria-label={t('common.delete')}
                            className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
                          >
                            🗑
                          </button>
                        )}
                      </span>
                    )}
                  </div>
                  {/* День и страйк — отдельной строкой под названием */}
                  {(dayNumber !== null || streak > 0) && (
                    <div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                      {dayNumber !== null && t('diary.dayOf', { n: dayNumber, m: targetDays ?? '∞' })}
                      {streak > 0 && ` · 🔥 ${t('diary.streak', { n: streak })}`}
                    </div>
                  )}
                  {/* Критерии эксперимента — видны прямо в карточке */}
                  {experiment.criteria && (
                    <p className="mt-1.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
                      📋 {experiment.criteria}
                    </p>
                  )}
                  {pct !== null && (
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                  {coachTip && (
                    <p className="mt-2 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
                      💬 <span className="font-medium">{t('diary.coachTip')}:</span> {coachTip}
                    </p>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>

      {/* Подтверждение удаления — фирменная модалка */}
      <ConfirmDialog
        open={confirmingId !== null}
        title={t('common.delete')}
        message={t('diary.expDeleteConfirm')}
        confirmLabel={t('common.delete')}
        danger
        loading={busyId !== null}
        onConfirm={() => {
          const exp = experiments.find((e) => e.id === confirmingId)
          if (exp) void doDelete(exp)
        }}
        onCancel={() => setConfirmingId(null)}
      />
    </section>
  )
}
