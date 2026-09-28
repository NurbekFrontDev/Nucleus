import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { useLang } from '../lib/i18n'
import { showToast } from '../lib/toast'
import { isOnline } from '../lib/offlineSync'
import {
  deleteEntry,
  fetchActiveExperiments,
  fetchDayEntries,
  fetchEntriesRange,
  countUnsyncedEntries,
  resumePendingPipelines,
  retryEntry,
  saveEditedEntry,
  sendTextEntry,
  sendVoiceEntry,
  todayStr,
  type DiaryEntry,
  type DiaryExperiment,
} from '../lib/diary'
import {
  isRecordingSupported,
  recordingElapsedMs,
  startRecording,
  stopRecording,
} from '../lib/recorder'
import { isVaultSyncAvailable, removeEntryFromVault, syncVault } from '../lib/vaultSync'
import { onSyncEvent } from '../lib/realtimeSync'
import { log } from '../lib/logger'
import DiaryEntryCard from '../components/DiaryEntryCard'
import DiaryExperiments from '../components/DiaryExperiments'

// Экран «Сегодня»: чат-подобная лента записей дня + ввод текста/голоса.
// Главный жест — одна кнопка: нажал mic → сказал → пайплайн сам дотранскрибирует,
// довыжмёт AI и (на десктопе) запишет в вольт Second Brain.

const HISTORY_WINDOW_DAYS = 30

function fmtDate(lang: string, d: Date = new Date()): string {
  return d.toLocaleDateString(lang === 'en' ? 'en-US' : 'ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function fmtTimer(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = String(Math.floor(total / 60)).padStart(2, '0')
  const s = String(total % 60).padStart(2, '0')
  return `${m}:${s}`
}

export default function DiaryToday() {
  const { user } = useAuth()
  const { t, lang } = useLang()
  const navigate = useNavigate()
  const userId = user?.id

  const [entries, setEntries] = useState<DiaryEntry[]>([])
  const [experiments, setExperiments] = useState<DiaryExperiment[]>([])
  const [recentEntries, setRecentEntries] = useState<DiaryEntry[]>([])
  const [unsynced, setUnsynced] = useState(0)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [micDenied, setMicDenied] = useState(false)
  const vaultAvailable = isVaultSyncAvailable()

  const listRef = useRef<HTMLDivElement>(null)
  const vaultTimer = useRef<number | undefined>(undefined)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // ===== Загрузка =====
  const reload = useCallback(async () => {
    if (!userId) return
    const today = todayStr()
    const fromDate = new Date(Date.now() - HISTORY_WINDOW_DAYS * 86400_000)
      .toISOString()
      .slice(0, 10)
    const [day, recent, exp, count] = await Promise.all([
      fetchDayEntries(userId, today),
      fetchEntriesRange(userId, fromDate, today),
      fetchActiveExperiments(userId),
      countUnsyncedEntries(userId),
    ])
    setEntries(day)
    setRecentEntries(recent)
    setExperiments(exp)
    setUnsynced(count)
  }, [userId])

  useEffect(() => {
    void reload()
    void resumePendingPipelines(userId ?? '').then(() => reload())
  }, [reload, userId])

  // ===== Вольт-синк (только десктоп): после готовности записей и по кнопке =====
  // Счётчик unsynced всегда перечитываем из БД (а не декрементируем локально):
  // так он отражает реальное состояние, даже если синк отработал в другой
  // вкладке/на другом устройстве или упал посередине.
  const refreshUnsynced = useCallback(async () => {
    if (!userId) return
    const count = await countUnsyncedEntries(userId)
    setUnsynced(count)
  }, [userId])

  const runVaultSync = useCallback(
    async (manual: boolean) => {
      if (!vaultAvailable || !userId || !isOnline()) return
      try {
        const r = await syncVault(userId)
        await refreshUnsynced()
        if (manual) {
          showToast(
            r.failed > 0
              ? t('diary.vaultFail')
              : r.synced > 0
                ? `${t('diary.vaultOk')} (${r.synced})`
                : t('diary.vaultAll'),
          )
          log.info('vault', 'Manual vault sync', { synced: r.synced, failed: r.failed }, userId)
        }
      } catch {
        if (manual) showToast(t('diary.vaultFail'))
        log.error('vault', 'Vault sync threw', {}, userId)
      }
    },
    [vaultAvailable, userId, t, refreshUnsynced],
  )

  const scheduleVaultSync = useCallback(() => {
    if (!vaultAvailable) return
    if (vaultTimer.current !== undefined) window.clearTimeout(vaultTimer.current)
    vaultTimer.current = window.setTimeout(() => void runVaultSync(false), 2500)
  }, [vaultAvailable, runVaultSync])

  useEffect(() => {
    void runVaultSync(false)
    // Desktop: синк также при возврате сети.
    const onOnline = () => void runVaultSync(false)
    window.addEventListener('online', onOnline)
    return () => {
      window.removeEventListener('online', onOnline)
      if (vaultTimer.current !== undefined) window.clearTimeout(vaultTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, vaultAvailable])

  // ===== Realtime: живое обновление карточек и блока экспериментов =====
  useEffect(() => {
    return onSyncEvent(['diary_entries', 'diary_experiments'], (evt) => {
      void reload()
      // Готовая запись и ещё не в вольте — планируем синк (десктоп).
      const row = evt.new as { status?: string; vault_synced_at?: string | null } | undefined
      if (evt.table === 'diary_entries' && row?.status === 'ready' && !row.vault_synced_at) {
        scheduleVaultSync()
      }
    })
  }, [reload, scheduleVaultSync])

  // ===== Продолжение прерванных пайплайнов =====
  useEffect(() => {
    if (!userId) return
    const resume = () =>
      void resumePendingPipelines(userId)
        .then(() => reload())
        .catch(() => {})
    window.addEventListener('online', resume)
    window.addEventListener('nucleus:offline-flushed', resume)
    return () => {
      window.removeEventListener('online', resume)
      window.removeEventListener('nucleus:offline-flushed', resume)
    }
  }, [userId, reload])

  // ===== Текстовая запись =====
  const submitText = async () => {
    const value = text.trim()
    if (!value || !userId || sending) return
    setSending(true)
    try {
      log.info('diary', 'Text entry sent', { length: value.length }, userId)
      await sendTextEntry(userId, value)
      setText('')
      await reload()
      scheduleVaultSync()
    } catch {
      showToast(t('diary.aiFail'))
      log.error('diary', 'Text entry failed', { length: value.length }, userId)
    } finally {
      setSending(false)
    }
  }

  // ===== Голосовая запись =====
  useEffect(() => {
    if (!recording) return
    const timer = window.setInterval(() => setElapsed(recordingElapsedMs()), 500)
    return () => window.clearInterval(timer)
  }, [recording])

  const finishRecording = useCallback(
    async (clip: { blob: Blob; ext: string }) => {
      if (!userId) return
      setRecording(false)
      setMicDenied(false)
      try {
        log.info('diary', 'Voice entry recorded', { bytes: clip.blob.size, ext: clip.ext }, userId)
        await sendVoiceEntry(userId, clip)
        await reload()
        scheduleVaultSync()
      } catch {
        showToast(t('diary.aiFail'))
        log.error('diary', 'Voice entry pipeline failed', { bytes: clip.blob.size }, userId)
      }
    },
    [userId, reload, scheduleVaultSync, t],
  )

  const toggleMic = async () => {
    if (recording) {
      try {
        const clip = await stopRecording()
        await finishRecording(clip)
      } catch {
        setRecording(false)
        showToast(t('diary.aiFail'))
      }
      return
    }
    if (!isRecordingSupported()) {
      showToast(t('diary.micUnavailable'))
      return
    }
    try {
      await startRecording((autoClip) => {
        // Лимит 15 минут: запись не отбрасываем — отправляем как есть.
        void finishRecording(autoClip)
      })
      setElapsed(0)
      setRecording(true)
      setMicDenied(false)
    } catch (e) {
      const code = (e as Error)?.message
      if (code === 'mic-denied') {
        setMicDenied(true)
        showToast(t('diary.micDenied'))
        log.warn('diary', 'Microphone permission denied', {}, userId)
      } else {
        showToast(t('diary.micUnavailable'))
        log.warn('diary', 'Microphone unavailable', { code }, userId)
      }
    }
  }

  const retry = async (entry: DiaryEntry) => {
    if (!userId) return
    try {
      await retryEntry(userId, entry.id)
      await reload()
      scheduleVaultSync()
    } catch {
      showToast(t('diary.aiFail'))
    }
  }

  // ===== Удаление и редактирование =====
  const handleDelete = useCallback(
    async (entry: DiaryEntry) => {
      if (!userId) return
      try {
        await deleteEntry(userId, entry)
        // Вольт: убираем блок записи из заметки дня (только десктоп).
        if (isVaultSyncAvailable()) {
          await removeEntryFromVault(entry)
        }
        await reload()
        showToast(t('diary.deleted'))
        log.info('diary', 'Entry deleted', { id: entry.id, source: entry.source }, userId)
      } catch {
        showToast(t('diary.deleteFail'))
        log.error('diary', 'Entry delete failed', { id: entry.id }, userId)
      }
    },
    [userId, reload, t],
  )

  const handleEdit = useCallback(
    async (entry: DiaryEntry, newText: string) => {
      if (!userId) return
      showToast(t('diary.reSummarizing'))
      try {
        const updated = await saveEditedEntry(userId, entry.id, newText)
        await reload()
        if (isVaultSyncAvailable()) {
          // Выжимка изменилась — переписываем блок в вольте и снимаем флаг
          // синка, чтобы десктопный автосинк его подхватил.
          if (updated) await syncVault(userId).then(() => refreshUnsynced())
        }
        log.info('diary', 'Entry edited + re-summarized', { id: entry.id }, userId)
      } catch {
        showToast(t('diary.editFail'))
        log.error('diary', 'Entry edit failed', { id: entry.id }, userId)
        throw new Error('edit-failed')
      }
    },
    [userId, reload, refreshUnsynced],
  )

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [entries.length])

  // Авто-рост поля ввода по высоте: текстарь растёт вместе с контентом,
  // пока не упрётся в потолок (иначе длинная диктовка видна только двумя
  // строчками). Ширина остаётся фиксированной.
  const growInput = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [])

  useEffect(() => {
    growInput()
  }, [text, growInput])

  const micActive = recording

  return (
    <div className="flex h-full flex-col">
      {/* Шапка экрана: название и дата */}
      <div className="mb-3 flex items-baseline justify-between px-1 pt-1">
        <h1 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">
          📓 {t('mod.diary')}
        </h1>
        <span className="text-sm text-neutral-400">{fmtDate(lang)}</span>
      </div>

      {/* Статус вольта — только на десктопе. На мобильном вольт недоступен
          по архитектуре (Tauri FS), поэтому не показываем здесь ничего:
          ни счётчика, ни подсказки, чтобы не вводить в заблуждение. */}
      {vaultAvailable && (
        <div className="mb-3 flex items-center justify-between gap-2 px-1">
          <span className="text-xs text-neutral-400">
            {unsynced > 0 ? t('diary.vaultPending', { n: unsynced }) : t('diary.vaultAll')}
          </span>
          <button
            type="button"
            onClick={() => void runVaultSync(true)}
            className="rounded-lg border border-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            ☁️ {t('diary.vaultSync')}
          </button>
        </div>
      )}

      {/* Лента записей дня (сверху старые) */}
      <div ref={listRef} className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-2.5 pb-4">
          {entries.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-neutral-200 p-8 text-center text-sm text-neutral-400 dark:border-neutral-800">
              {t('diary.empty')}
            </div>
          ) : (
            entries.map((entry) => (
              <DiaryEntryCard
                key={entry.id}
                entry={entry}
                onRetry={retry}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            ))
          )}
        </div>

        {/* Прогресс экспериментов */}
        <DiaryExperiments experiments={experiments} recentEntries={recentEntries} />
      </div>

      {/* Ввод: текст + mic */}
      <div className="sticky bottom-0 -mx-4 border-t border-neutral-200 bg-white/95 px-4 pb-[env(safe-area-inset-bottom)] pt-3 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/95">
        {micDenied && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/80 px-3.5 py-2.5 dark:border-amber-900/60 dark:bg-amber-950/30">
            <span className="text-xs leading-snug text-amber-800 dark:text-amber-200">
              🎙 {t('diary.micDenied')}
            </span>
            <button
              type="button"
              onClick={() => {
                setMicDenied(false)
                navigate('/diary/settings')
              }}
              className="shrink-0 rounded-lg bg-amber-500 px-3 py-1 text-xs font-semibold text-white transition hover:bg-amber-600"
            >
              {t('diary.settingsMicAllow')}
            </button>
          </div>
        )}
        {micActive ? (
          <div className="flex items-center justify-center gap-3 pb-3">
            <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-red-500" />
            <span className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
              {t('diary.recording', { time: fmtTimer(elapsed) })}
            </span>
            <button
              type="button"
              onClick={() => void toggleMic()}
              className="flex h-11 items-center gap-2 rounded-xl bg-red-500 px-5 text-sm font-semibold text-white transition hover:bg-red-600"
            >
              ⏹ {t('diary.micStop')}
            </button>
          </div>
        ) : (
          <div className="flex items-end gap-2 pb-3">
            <textarea
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void submitText()
                }
              }}
              rows={1}
              placeholder={t('diary.inputPlaceholder')}
              className="max-h-52 min-h-[44px] flex-1 resize-none overflow-y-auto rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 text-[13px] leading-relaxed text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-600 sm:text-sm"
            />
            <button
              type="button"
              onClick={() => void toggleMic()}
              title={t('diary.micStart')}
              aria-label={t('diary.micStart')}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-lg text-white shadow-sm transition hover:bg-emerald-600 active:scale-95"
            >
              🎙
            </button>
            <button
              type="button"
              onClick={() => void submitText()}
              disabled={!text.trim() || sending}
              aria-label={t('diary.send')}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-lg text-white transition hover:bg-neutral-700 disabled:opacity-30 dark:bg-emerald-500 dark:hover:bg-emerald-600 dark:disabled:opacity-30"
            >
              ➤
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
