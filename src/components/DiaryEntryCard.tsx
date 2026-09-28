import { useLang } from '../lib/i18n'
import { entryTimeHM, type DiaryEntry } from '../lib/diary'

// Карточка записи дневника: статус-машина пайплайна (пишем / транскрибируем /
// думаем / готово / ошибка-повтор), выжимка сверху, оригинал свёрнут снизу.

function MoodEmoji({ score }: { score: number }) {
  const clamped = Math.max(1, Math.min(10, Math.round(score)))
  const emoji = clamped >= 9 ? '🤩' : clamped >= 7 ? '😊' : clamped >= 5 ? '😐' : clamped >= 3 ? '😔' : '😣'
  return (
    <span className="inline-flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400">
      <span className="text-sm leading-none">{emoji}</span>
      {clamped}/10
    </span>
  )
}

function ExperimentBadge({ entry }: { entry: DiaryEntry }) {
  const { t } = useLang()
  const exp = entry.summary?.experiment
  if (!exp?.has_experiment_update) return null
  const day = exp.day_number
    ? exp.target_days
      ? t('diary.dayOf', { n: exp.day_number, m: exp.target_days })
      : t('diary.dayN', { n: exp.day_number })
    : ''
  return (
    <div
      className={`mt-2 flex flex-wrap items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs ${
        exp.success_status === false
          ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
          : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
      }`}
    >
      {exp.experiment_title && <span className="font-semibold">🧪 {exp.experiment_title}</span>}
      {day && <span>{exp.experiment_title ? '·' : '🧪'} {day}</span>}
      {exp.success_status === true && <span>✅</span>}
      {exp.success_status === false && <span>❌</span>}
      {exp.coach_tip && <span className="w-full opacity-90">💬 {exp.coach_tip}</span>}
    </div>
  )
}

export default function DiaryEntryCard({ entry, onRetry }: { entry: DiaryEntry; onRetry?: (entry: DiaryEntry) => void }) {
  const { t } = useLang()

  // Время: по зоне устройства, создавшего запись (закон вольта — не UTC).
  const time = entryTimeHM(entry.created_at, entry.timezone)

  if (entry.status !== 'ready' && entry.status !== 'failed') {
    const label =
      entry.status === 'pending'
        ? t('diary.status.pending')
        : entry.status === 'transcribing'
          ? t('diary.status.transcribing')
          : t('diary.status.summarizing')
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/60">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-neutral-400">{time}</span>
          <span className="flex items-center gap-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
            {label}
          </span>
        </div>
      </div>
    )
  }

  if (entry.status === 'failed') {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50/60 p-4 dark:border-red-900 dark:bg-red-950/30">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-neutral-400">{time}</span>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-red-600 dark:text-red-400">{t('diary.status.failed')}</span>
            {onRetry && (
              <button
                type="button"
                onClick={() => onRetry(entry)}
                className="rounded-lg bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-200 dark:bg-red-900/50 dark:text-red-200 dark:hover:bg-red-900"
              >
                ↻ {t('diary.retry')}
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  const s = entry.summary
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/60">
      {/* Шапка: время и источник */}
      <div className="mb-1.5 flex items-center gap-2 text-xs text-neutral-400">
        <span>{time}</span>
        <span>·</span>
        <span>{entry.source === 'voice' ? `🎙 ${t('diary.voice')}` : `⌨️ ${t('diary.textSrc')}`}</span>
      </div>

      {/* Выжимка */}
      <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{s?.title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">{s?.summary_text}</p>

      {/* Теги и настроение */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {(s?.tags ?? []).map((tag) => (
          <span
            key={tag}
            className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
          >
            #{tag}
          </span>
        ))}
        {typeof s?.mood_score === 'number' && <MoodEmoji score={s.mood_score} />}
      </div>

      <ExperimentBadge entry={entry} />

      {/* Оригинал — свёрнут, дословно */}
      {entry.original_text && (
        <details className="group mt-3 border-t border-neutral-100 pt-2 dark:border-neutral-800">
          <summary className="cursor-pointer list-none text-xs font-medium text-neutral-400 transition hover:text-neutral-600 dark:hover:text-neutral-300">
            <span className="inline-block transition group-open:rotate-90">▸</span> {t('diary.original')}
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
            {entry.original_text}
          </p>
        </details>
      )}
    </div>
  )
}
