import { useMemo } from 'react'
import { useLang } from '../lib/i18n'
import type { DiaryEntry, DiaryExperiment } from '../lib/diary'

// Блок прогресса экспериментов/челленджей: название, день X из Y, серия
// успехов, последний совет коуча. Прогресс считается по готовым записям,
// связанным с экспериментом (day_number из выжимки AI).

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

export default function DiaryExperiments({
  experiments,
  recentEntries,
}: {
  experiments: DiaryExperiment[]
  recentEntries: DiaryEntry[]
}) {
  const { t } = useLang()
  const progress = useMemo(
    () => computeProgress(recentEntries, experiments),
    [recentEntries, experiments],
  )

  if (experiments.length === 0) return null

  return (
    <section className="mt-6">
      <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wider text-neutral-400">
        🧪 {t('diary.experimentsTitle')}
      </h2>
      <div className="flex flex-col gap-2">
        {progress.map(({ experiment, dayNumber, targetDays, streak, coachTip }) => {
          const pct =
            dayNumber && targetDays ? Math.min(100, Math.round((dayNumber / targetDays) * 100)) : null
          return (
            <div
              key={experiment.id}
              className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/60"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {experiment.title}
                </span>
                <span className="text-xs text-neutral-500 dark:text-neutral-400">
                  {dayNumber !== null && t('diary.dayOf', { n: dayNumber, m: targetDays ?? '∞' })}
                  {streak > 0 && ` · 🔥 ${t('diary.streak', { n: streak })}`}
                </span>
              </div>
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
            </div>
          )
        })}
      </div>
    </section>
  )
}
