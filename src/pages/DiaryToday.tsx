import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { useLang } from '../lib/i18n'
import { showToast } from '../lib/toast'
import { isOnline } from '../lib/offlineSync'
import {
  deleteEntry,
  deleteExperiment,
  fetchActiveExperiments,
  fetchDayEntries,
  fetchEntriesRange,
  countUnsyncedEntries,
  resumePendingPipelines,
  retryEntry,
  runEntryPipeline,
  saveEditedEntry,
  sendTextEntry,
  sendVoiceEntry,
  todayStr,
  updateExperiment,
  type DiaryEntry,
  type DiaryExperiment,
  type ExperimentPatch,
} from '../lib/diary'
import {
  cancelRecording,
  isRecordingSupported,
  recordingElapsedMs,
  startRecording,
  stopRecording,
} from '../lib/recorder'
import { isVaultSyncAvailable, removeEntryFromVault, syncVault } from '../lib/vaultSync'
import { driveConfigFrom } from '../lib/drive'
import type { DiarySettings } from '../lib/diarySettings'
import { onSyncEvent } from '../lib/realtimeSync'
import { readCache, writeCache } from '../lib/offlineCache'
import { log } from '../lib/logger'
import DiaryEntryCard from '../components/DiaryEntryCard'
import DiaryExperiments from '../components/DiaryExperiments'

// Экран «Сегодня»: чат-подобная лента записей дня + ввод текста/голоса.
// Главный жест — одна кнопка: нажал mic → сказал → пайплайн сам дотранскрибирует,
// довыжмёт AI и (на десктопе) запишет в вольт Second Brain. Local-first:
// содержимое мгновенно hydrate'ится из кэша последней загрузки.

const HISTORY_WINDOW_DAYS = 30

type CachedToday = {
  day: DiaryEntry[]
  recent: DiaryEntry[]
  exp: DiaryExperiment[]
  unsynced: number
}

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

  // Local-first (stale-while-revalidate): при открытии мгновенно показываем
  // кэш последней загрузки, сеть потом догоняет свежими данными.
  const [entries, setEntries] = useState<DiaryEntry[]>(
    () => readCache<CachedToday>(`diary:today:${user?.id ?? ''}`)?.day ?? [],
  )
  const [experiments, setExperiments] = useState<DiaryExperiment[]>(
    () => readCache<CachedToday>(`diary:today:${user?.id ?? ''}`)?.exp ?? [],
  )
  const [recentEntries, setRecentEntries] = useState<DiaryEntry[]>(
    () => readCache<CachedToday>(`diary:today:${user?.id ?? ''}`)?.recent ?? [],
  )
  const [unsynced, setUnsynced] = useState(0)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [micDenied, setMicDenied] = useState(false)
  // Поле ввода развернулось до предела (длинная диктовка): фон замораживаем,
  // чтобы скролл внутри/снаружи поля не двигал ленту за ним.
  const [inputExpanded, setInputExpanded] = useState(false)
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
    // Local-first: сохраняем снапшот для мгновенного открытия в следующий раз.
    writeCache<CachedToday>(`diary:today:${userId}`, { day, recent, exp, unsynced: count })
  }, [userId])

  useEffect(() => {
    void reload()
    void resumePendingPipelines(userId ?? '').then(() => reload())
  }, [reload, userId])

  // Живой статус карточек: пока есть записи в обработке (pending/transcribing/
  // summarizing), опрашиваем базу каждые 3с — карточка сама сменится на
  // готовую, без перехода в другую вкладку и обратно. Realtime остаётся
  // как быстрый канал, опрос — страховка от пропущенного события.
  const hasPending = entries.some(
    (e) => e.status === 'pending' || e.status === 'transcribing' || e.status === 'summarizing',
  )
  useEffect(() => {
    if (!hasPending || !userId) return
    const timer = window.setInterval(() => void reload(), 3000)
    return () => window.clearInterval(timer)
  }, [hasPending, userId, reload])

  // ===== Вольт-синк (только десктоп): после готовности записей и по кнопке =====
  // Счётчик unsynced всегда перечитываем из БД (а не декрементируем локально):
  // так он отражает реальное состояние, даже если синк отработал в другой
  // вкладке/на другом устройстве или упал посередине.
  const refreshUnsynced = useCallback(async () => {
    if (!userId) return
    const count = await countUnsyncedEntries(userId)
    setUnsynced(count)
  }, [userId])

  // Синк идемпотентен и запускается автоматически: при входе на экран, после
  // каждой новой записи/правки/повтора, по realtime-событию готовой записи и
  // при возврате сети. Ручной кнопки больше нет — она запускала ровно тот же
  // syncVault, что и эти триггеры.
  const runVaultSync = useCallback(async () => {
    if (!vaultAvailable || !userId || !isOnline()) return
    try {
      await syncVault(userId)
      await refreshUnsynced()
    } catch {
      log.error('vault', 'Vault sync threw', {}, userId)
    }
  }, [vaultAvailable, userId, refreshUnsynced])

  const scheduleVaultSync = useCallback(() => {
    if (!vaultAvailable) return
    if (vaultTimer.current !== undefined) window.clearTimeout(vaultTimer.current)
    vaultTimer.current = window.setTimeout(() => void runVaultSync(), 2500)
  }, [vaultAvailable, runVaultSync])

  useEffect(() => {
    void runVaultSync()
    // Desktop: синк также при возврате сети.
    const onOnline = () => void runVaultSync()
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
      const { entry } = await sendTextEntry(userId, value)
      setText('')
      await reload()
      scheduleVaultSync()
      // Пайплайн гоним сами и перерисовываем карточку по завершении —
      // статус «думает» не зависает до перевхода на вкладку.
      if (isOnline()) {
        void runEntryPipeline(userId, entry.id).then(() => {
          void reload()
          scheduleVaultSync()
        })
      }
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
    async (clip: { blob: Blob; ext: string; durationMs?: number }) => {
      if (!userId) return
      setRecording(false)
      setMicDenied(false)
      try {
        log.info('diary', 'Voice entry recorded', { bytes: clip.blob.size, ext: clip.ext }, userId)
        const { entry } = await sendVoiceEntry(userId, clip)
        await reload()
        scheduleVaultSync()
        if (isOnline()) {
          void runEntryPipeline(userId, entry.id).then(() => {
            void reload()
            scheduleVaultSync()
          })
        }
      } catch (e) {
        showToast(t('diary.aiFail'))
        log.error('diary', `Voice entry pipeline failed: ${String((e as Error)?.message ?? e)}`, { bytes: clip.blob.size }, userId)
      }
    },
    [userId, reload, scheduleVaultSync, t],
  )

  // Отмена записи: клип уничтожается, ничего не отправляется и не сохраняется.
  const cancelRecordingNow = useCallback(() => {
    cancelRecording()
    setRecording(false)
    setElapsed(0)
    log.info('diary', 'Voice recording cancelled', {}, userId)
  }, [userId])

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
    // Аудио с v0.1.62 живёт только в Google Drive: без ключей запись не
    // начинаем, чтобы клип не пропал. Кэш настроек — offline-безопасно (при
    // отсутствии кэша запись не блокируем, пайплайн сообщит точнее).
    const cachedSettings = userId ? readCache<DiarySettings>(`diary:settings:${userId}`) : null
    if (cachedSettings && !driveConfigFrom(cachedSettings)) {
      showToast(t('diary.driveNotConfigured'))
      log.warn('diary', 'Voice recording blocked: Google Drive not configured', {}, userId)
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
    // Оптимистично: карточка сразу оживает — спиннер + живой статус вместо
    // статичной «Failed». Как только появляется pending, запускается опрос
    // базы каждые 3с, и статус сам едет: «В очереди» → «Транскрибация» →
    // «AI-выжимка» → готово. Без этого до конца пайплайна ничего не двигается.
    const markPending = (list: DiaryEntry[]) =>
      list.map((e) => (e.id === entry.id ? { ...e, status: 'pending' as const } : e))
    setEntries(markPending)
    setRecentEntries(markPending)
    try {
      await retryEntry(userId, entry.id)
      await reload()
      scheduleVaultSync()
    } catch {
      showToast(t('diary.aiFail'))
      // Сбрасываем оптимистичный статус на актуальный из БД (снова failed).
      void reload()
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

  // ===== Редактирование и удаление экспериментов =====
  const handleExpEdit = useCallback(
    async (exp: DiaryExperiment, patch: ExperimentPatch) => {
      if (!userId) return
      try {
        await updateExperiment(userId, exp.id, patch)
        await reload()
        showToast(t('diary.expSaved'))
        log.info('diary', 'Experiment updated', { id: exp.id, title: patch.title }, userId)
      } catch {
        showToast(t('diary.editFail'))
        log.error('diary', 'Experiment update failed', { id: exp.id }, userId)
        throw new Error('experiment-update-failed')
      }
    },
    [userId, reload, t],
  )

  const handleExpDelete = useCallback(
    async (exp: DiaryExperiment) => {
      if (!userId) return
      try {
        // Записи остаются в дневнике — снимается только ссылка на эксперимент.
        await deleteExperiment(userId, exp.id)
        await reload()
        showToast(t('diary.expDeleted'))
        log.info('diary', 'Experiment deleted', { id: exp.id, title: exp.title }, userId)
      } catch {
        showToast(t('diary.deleteFail'))
        log.error('diary', 'Experiment delete failed', { id: exp.id }, userId)
        throw new Error('experiment-delete-failed')
      }
    },
    [userId, reload, t],
  )

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [entries.length])

  // Авто-рост поля ввода по высоте: текстарь растёт вместе с контентом до
  // самого низа страницы (резерв — шапка, статус вольта и обвязка композера),
  // но не дальше. Работает и на телефоне: потолок замеряем на «чистом»
  // вьюпорте и пересчитываем только в большую сторону — виртуальная
  // клавиатура сжимает innerHeight, из-за чего потолок раньше схлопывался.
  const inputCapRef = useRef(0)
  const growInput = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    // Потолок измеряем по факту, а не константой: высота экрана минус шапка
    // минус вся обвязка композера (кнопки, отступы, зона пузыря ассистента).
    // Раньше на телефоне константа давала композер выше доступного места —
    // колонка переполняла main, main начинал скроллиться, и фон «ехал» под
    // заморозкой. Замер гарантирует: шапка + композер ≤ экрана.
    const composer = el.closest<HTMLElement>('[data-composer]')
    const main = el.closest<HTMLElement>('main')
    const header = document.querySelector<HTMLElement>('[data-diary-header]')
    let base = 150
    if (composer) base = composer.offsetHeight - el.offsetHeight
    let avail = (main?.clientHeight ?? window.innerHeight) - (header?.offsetHeight ?? 0) - base
    if (main) {
      const cs = getComputedStyle(main)
      avail -= parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
    }
    const cap = Math.max(120, Math.floor(avail))
    if (inputCapRef.current === 0 || cap > inputCapRef.current) inputCapRef.current = cap
    el.style.height = Math.min(el.scrollHeight, inputCapRef.current) + 'px'
    setInputExpanded(el.scrollHeight > inputCapRef.current)
  }, [])

  useEffect(() => {
    growInput()
  }, [text, growInput])

  const micActive = recording

  return (
    <div className="flex h-full flex-col">
      {/* Шапка экрана: закреплена сверху (название, дата и статус вольта) */}
      <div
        data-diary-header
        className="sticky top-0 z-20 -mx-4 mb-3 shrink-0 border-b border-neutral-200/70 bg-white/85 px-4 py-3 backdrop-blur dark:border-neutral-800/70 dark:bg-neutral-950/85"
      >
        <div className="flex items-baseline justify-between">
          <h1 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">
            📓 {t('mod.diary')}
          </h1>
          <span className="text-sm text-neutral-400">{fmtDate(lang)}</span>
        </div>
        {/* Статус вольта — только на десктопе. На мобильном вольт недоступен
            по архитектуре (Tauri FS), поэтому не показываем здесь ничего:
            ни счётчика, ни подсказки, чтобы не вводить в заблуждение. Синк
            автоматический, кнопки «Синхронизировать» больше нет. */}
        {vaultAvailable && (
          <div className="mt-0.5">
            <span className="text-xs text-neutral-400">
              {unsynced > 0 ? t('diary.vaultPending', { n: unsynced }) : t('diary.vaultAll')}
            </span>
          </div>
        )}
      </div>

      {/* Лента записей дня (сверху старые). min-h-0 обязателен: без него
          flex-высота не сжимается, список не скроллится внутри, и едет вся
          раскладка (шапка уезжала при скролле). Когда поле ввода развёрнуто
          до предела — фон заморожен (overflow-hidden): скролл не двигает
          содержимое за гигантским полем. */}
      <div
        ref={listRef}
        className={`min-h-0 flex-1 ${inputExpanded ? 'overflow-hidden' : 'overflow-y-auto'}`}
      >
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

        {/* Прогресс экспериментов + воздух до разделителя композера */}
        <div className="pb-6">
          <DiaryExperiments
            experiments={experiments}
            recentEntries={recentEntries}
            onEdit={handleExpEdit}
            onDelete={handleExpDelete}
          />
        </div>
      </div>

      {/* Ввод: текст + mic. На мобильном под полем оставлена компактная зона
          пузыря ассистента (bottom-28 right-4): кнопки чуть выше пузыря. Полоса
          ПОЛНОСТЬЮ НЕПРОЗРАЧНА (bg без /95 и без blur) — сквозь неё не видно
          контент. touch-none гасит жесты скролла, начатые на поле/под ним:
          скроллить можно только саму ленту и текст внутри поля (цепочка
          touch-action упирается в текстарь — его скролл не страдает). */}
      <div
        data-composer
        className="sticky bottom-0 -mx-4 touch-none border-t border-neutral-200 bg-white px-4 pb-[calc(env(safe-area-inset-bottom)+6rem)] pt-3 dark:border-neutral-800 dark:bg-neutral-950 md:pb-3"
      >
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
          <div className="flex items-center justify-center gap-2 pb-3">
            <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-red-500" />
            <span className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
              {t('diary.recording', { time: fmtTimer(elapsed) })}
            </span>
            <button
              type="button"
              onClick={cancelRecordingNow}
              title={t('diary.micCancel')}
              className="ml-2 flex h-11 items-center gap-2 rounded-xl border border-neutral-300 px-4 text-sm font-medium text-neutral-600 transition hover:border-red-300 hover:bg-red-50 hover:text-red-600 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-red-900 dark:hover:bg-red-950/30 dark:hover:text-red-400"
            >
              ✕ {t('diary.micCancel')}
            </button>
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
              className="min-h-[44px] flex-1 resize-none overscroll-contain overflow-y-auto rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 text-[13px] leading-relaxed text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-600 sm:text-sm"
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
