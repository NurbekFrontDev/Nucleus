import { useEffect, useRef, useState } from 'react'
import { useLang } from '../lib/i18n'
import { entryTimeHM, type DiaryEntry } from '../lib/diary'
import { log } from '../lib/logger'
import ConfirmDialog from './ConfirmDialog'

// Карточка записи дневника: статус-машина пайплайна (пишем / транскрибируем /
// думаем / готово / ошибка-повтор), выжимка сверху, оригинал свёрнут снизу.
// У готовой записи есть кнопки редактирования оригинала и удаления (эмодзи
// ✏️/🗑 — общий стиль приложения, как в «Моих делах»). Редактирование
// перегоняет выжимку заново — см. saveEditedEntry. Удаление подтверждается
// фирменной модалкой ConfirmDialog (никаких window.confirm).

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

export default function DiaryEntryCard({
  entry,
  onRetry,
  onEdit,
  onDelete,
}: {
  entry: DiaryEntry
  onRetry?: (entry: DiaryEntry) => void
  onEdit?: (entry: DiaryEntry, newText: string) => Promise<void>
  onDelete?: (entry: DiaryEntry) => Promise<void>
}) {
  const { t } = useLang()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(entry.original_text ?? '')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Высота поля редактирования подстраивается под текст (как у основного ввода).
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 320) + 'px'
  }, [draft, editing])

  const dirty = draft.trim() !== (entry.original_text ?? '').trim()

  const startEdit = () => {
    setDraft(entry.original_text ?? '')
    setEditing(true)
  }

  const cancelEdit = () => {
    setEditing(false)
    setDraft(entry.original_text ?? '')
  }

  const saveEdit = async () => {
    if (!onEdit || !dirty || busy) return
    setBusy(true)
    try {
      await onEdit(entry, draft)
      setEditing(false)
    } catch {
      // toast показывает вызывающий экран
    } finally {
      setBusy(false)
    }
  }

  // Удаление: сначала фирменное подтверждение, потом сама работа.
  const askRemove = () => {
    if (!onDelete || busy) return
    setConfirming(true)
  }

  const doRemove = async () => {
    if (!onDelete || busy) return
    setBusy(true)
    try {
      await onDelete(entry)
      setConfirming(false)
    } catch {
      log.error('diary', 'Entry delete failed in card', { id: entry.id })
    } finally {
      setBusy(false)
    }
  }

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
      {/* Шапка: время, источник и действия */}
      <div className="mb-1.5 flex items-center gap-2 text-xs text-neutral-400">
        <span>{time}</span>
        <span>·</span>
        <span>{entry.source === 'voice' ? `🎙 ${t('diary.voice')}` : `⌨️ ${t('diary.textSrc')}`}</span>
        {busy && <span className="animate-pulse">…</span>}
        {!editing && !busy && (onEdit || onDelete) && (
          <span className="ml-auto flex items-center gap-1">
            {onEdit && (
              <button
                type="button"
                onClick={startEdit}
                title={t('diary.edit')}
                aria-label={t('diary.edit')}
                className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
              >
                ✏️
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={askRemove}
                title={t('diary.delete')}
                aria-label={t('diary.delete')}
                className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
              >
                🗑
              </button>
            )}
          </span>
        )}
      </div>

      {/* Режим редактирования оригинала */}
      {editing ? (
        <div className="flex flex-col gap-2.5">
          <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
            ✏️ {t('diary.editOriginal')}
          </p>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            className="resize-none rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm leading-relaxed text-neutral-900 outline-none transition focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void saveEdit()}
              disabled={!dirty || busy}
              className="rounded-lg bg-neutral-900 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-30 dark:bg-emerald-500 dark:hover:bg-emerald-600 dark:disabled:opacity-30"
            >
              {t('diary.save')}
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              disabled={busy}
              className="rounded-lg border border-neutral-300 px-3.5 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              {t('diary.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <>
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
        </>
      )}

      {/* Подтверждение удаления — в стиле приложения */}
      <ConfirmDialog
        open={confirming}
        title={t('diary.delete')}
        message={t('diary.deleteConfirm')}
        confirmLabel={t('common.delete')}
        danger
        loading={busy}
        onConfirm={() => void doRemove()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}
