import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useLang } from '../lib/i18n'
import { showToast } from '../lib/toast'
import {
  loadDiarySettings,
  saveDiarySettings,
  DIARY_SETTINGS_DEFAULTS,
  type DiarySettings,
} from '../lib/diarySettings'
import {
  getMicPermissionState,
  probeMicPermission,
  resolveMicState,
  type MicPermissionState,
} from '../lib/micPermission'
import { openAppDetailsSettings } from '../lib/battery'
import { isDesktop, openMicSystemSettings } from '../lib/native'
import { DEFAULT_SUMMARY_PROMPT, SERVER_DIARY_KEYS } from '../lib/diaryDefaults'
import { readCache, writeCache } from '../lib/offlineCache'
import { onSyncEvent } from '../lib/realtimeSync'
import { log } from '../lib/logger'

// Настройки модуля «Дневник»: microphone, smart transcription, промпт выжимки,
// API-ключи. Всё хранится в app_settings и синхронизируется между устройствами
// через Realtime — изменение с ПК моментально применяется на телефоне.
// Local-first: при открытии мгновенно показываем кэш последней загрузки,
// сеть/Realtime обновляют в фоне.

const cardCls = 'rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50'
const labelCls = 'text-sm font-semibold text-neutral-900 dark:text-neutral-100'
const hintCls = 'mt-1 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400'
const inputCls =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100'

export default function DiarySettings() {
  const { user } = useAuth()
  const { t } = useLang()
  const userId = user?.id

  // Local-first: гидрируемся из кэша сразу (до сети), чтобы экран не мигал
  // «Loading» при плохом интернете.
  const settingsCacheKey = `diary:settings:${user?.id ?? ''}`

  const [settings, setSettings] = useState<DiarySettings>(
    () => readCache<DiarySettings>(`diary:settings:${user?.id ?? ''}`) ?? DIARY_SETTINGS_DEFAULTS,
  )
  const [ready, setReady] = useState(() => readCache<DiarySettings>(`diary:settings:${user?.id ?? ''}`) !== null)
  const [micState, setMicState] = useState<MicPermissionState>('unknown')

  // Локальные правки промпта/ключей: сохраняем по кнопке, а не на каждый чих.
  const cached = readCache<DiarySettings>(settingsCacheKey)
  const [promptDraft, setPromptDraft] = useState(
    () =>
      cached?.summaryPrompt ??
      (cached ? DEFAULT_SUMMARY_PROMPT : ''),
  )
  const [geminiDraft, setGeminiDraft] = useState(() => cached?.geminiKey ?? '')
  const [groqDraft, setGroqDraft] = useState(() => cached?.groqKey ?? '')
  const [savingPrompt, setSavingPrompt] = useState(false)
  const [savingKeys, setSavingKeys] = useState(false)
  const [togglingSmart, setTogglingSmart] = useState(false)

  const applySettings = (s: DiarySettings) => {
    setSettings(s)
    // Поле показывает РЕАЛЬНЫЙ промпт: пользовательский оверрайд, а если его
    // нет — канонический дефолт, который edge-функция использует под капотом.
    setPromptDraft(s.summaryPrompt ?? DEFAULT_SUMMARY_PROMPT)
    // Ключи: если пользователь не задал своих — показываем серверные,
    // реально используемые edge-функцией (тот же приоритет, что в diary-ai).
    setGeminiDraft(s.geminiKey ?? SERVER_DIARY_KEYS.gemini)
    setGroqDraft(s.groqKey ?? SERVER_DIARY_KEYS.groq)
  }

  const reload = async () => {
    if (!userId) return
    try {
      const s = await loadDiarySettings(userId)
      applySettings(s)
      writeCache(settingsCacheKey, s)
    } catch {
      // остаются кэш/дефолты
    } finally {
      setReady(true)
    }
  }

  useEffect(() => {
    void reload()
    // Realtime: настройки могли изменить с другого устройства — перечитываем.
    return onSyncEvent(['app_settings'], () => void reload())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  // Состояние микрофона (Permissions API, либо пробный getUserMedia).
  useEffect(() => {
    let active = true
    void (async () => {
      const state = await resolveMicState()
      if (active) setMicState(state)
    })()
    // Перепроверяем при возврате на экран (пользователь мог раздать права в ОС).
    const onFocus = () => {
      void getMicPermissionState().then((s) => {
        if (active && s !== 'unknown') setMicState(s)
      })
    }
    window.addEventListener('focus', onFocus)
    return () => {
      active = false
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  // ===== Микрофон =====
  /** Пробует получить доступ; false — доступ не выдан (диалог отклонён/блокирует ОС). */
  const requestMic = async (): Promise<boolean> => {
    const granted = await probeMicPermission()
    const next: MicPermissionState = granted ? 'granted' : 'denied'
    setMicState(next)
    if (granted) {
      showToast(t('diary.settingsMicGranted'))
      log.info('settings', 'Microphone permission granted', {}, userId)
    } else {
      log.warn('settings', 'Microphone permission denied by user', {}, userId)
    }
    return granted
  }

  const onAllowClick = async () => {
    // Android: если пользователь ранее выбрал «Отказать и больше не спрашивать»,
    // повторный getUserMedia не покажет диалог — открываем настройки приложения.
    if (micState === 'denied' && !isDesktop()) {
      try {
        await openAppDetailsSettings()
      } catch {
        await requestMic()
      }
      return
    }
    const granted = await requestMic()
    if (!granted && isDesktop()) {
      // WebView2/ОС отклонили запрос молча: ведём в настройки Windows,
      // где доступ к микрофону включается для десктопных приложений.
      await openMicSystemSettings().catch(() => {})
      showToast(t('diary.settingsMicDesktopHint'))
    }
  }

  const onOpenSystemClick = async () => {
    await openMicSystemSettings().catch(() => {})
  }

  // ===== Smart transcription =====
  const toggleSmart = async (next: boolean) => {
    if (!userId || togglingSmart) return
    setTogglingSmart(true)
    const prev = settings.smartTranscription
    setSettings((s) => ({ ...s, smartTranscription: next }))
    try {
      await saveDiarySettings(userId, { smartTranscription: next })
      log.info('settings', `Smart transcription ${next ? 'enabled' : 'disabled'}`, {}, userId)
    } catch {
      setSettings((s) => ({ ...s, smartTranscription: prev }))
      showToast(t('diary.editFail'))
    } finally {
      setTogglingSmart(false)
    }
  }

  // ===== Промпт =====
  const savePrompt = async () => {
    if (!userId || savingPrompt) return
    setSavingPrompt(true)
    try {
      await saveDiarySettings(userId, { summaryPrompt: promptDraft })
      log.info('settings', 'Summary prompt updated', { length: promptDraft.length }, userId)
      showToast(t('diary.settingsPromptSaved'))
      await reload()
    } catch {
      showToast(t('diary.editFail'))
    } finally {
      setSavingPrompt(false)
    }
  }

  const resetPrompt = async () => {
    if (!userId || savingPrompt) return
    setPromptDraft(DEFAULT_SUMMARY_PROMPT)
    try {
      // Оверрайд снимается: в поле и в diary-ai снова работает дефолт из кода.
      await saveDiarySettings(userId, { summaryPrompt: null })
      log.info('settings', 'Summary prompt reset to default', {}, userId)
      showToast(t('diary.settingsPromptSaved'))
      await reload()
    } catch {
      showToast(t('diary.editFail'))
    }
  }

  const promptDirty = promptDraft.trim() !== (settings.summaryPrompt ?? DEFAULT_SUMMARY_PROMPT).trim()

  // Поле промпта растёт под содержимое (до потолка 420px): весь реальный
  // промпт виден целиком, без скролла внутри маленького бокса.
  const promptRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = promptRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 420) + 'px'
  }, [promptDraft, ready])

  // ===== Ключи =====
  const saveKeys = async () => {
    if (!userId || savingKeys) return
    setSavingKeys(true)
    try {
      await saveDiarySettings(userId, { geminiKey: geminiDraft, groqKey: groqDraft })
      log.info('settings', 'Diary API keys updated', {}, userId)
      showToast(t('diary.keysSaved'))
      await reload()
    } catch {
      showToast(t('diary.editFail'))
    } finally {
      setSavingKeys(false)
    }
  }

  const keysDirty =
    geminiDraft.trim() !== (settings.geminiKey ?? SERVER_DIARY_KEYS.gemini).trim() ||
    groqDraft.trim() !== (settings.groqKey ?? SERVER_DIARY_KEYS.groq).trim()

  // Глазик: показать/скрыть содержимое обоих полей ключей.
  const [showKeys, setShowKeys] = useState(false)

  if (!ready) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <h1 className="px-1 pt-1 text-lg font-bold text-neutral-900 dark:text-neutral-100">
          ⚙️ {t('diary.settingsTitle')}
        </h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('common.loading')}</p>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      {/* Закреплённая шапка: заголовок не уезжает при скролле */}
      <div className="sticky top-0 z-20 -mx-4 border-b border-neutral-200/70 bg-white/85 px-4 py-3 backdrop-blur dark:border-neutral-800/70 dark:bg-neutral-950/85">
        <h1 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">
          ⚙️ {t('diary.settingsTitle')}
        </h1>
      </div>

      {/* Микрофон: карточка нужна только пока доступ не выдан. */}
      {micState !== 'granted' && (
        <section className={cardCls}>
          <h2 className={labelCls}>🎙️ {t('diary.settingsMic')}</h2>
          <p className={hintCls}>
            {micState === 'denied' ? t('diary.settingsMicDenied') : t('diary.settingsMicPrompt')}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void onAllowClick()}
              className="rounded-lg bg-emerald-500 px-3.5 py-1.5 text-sm font-semibold text-white transition hover:bg-emerald-600"
            >
              {t('diary.settingsMicAllow')}
            </button>
            {micState === 'denied' && (
              <button
                type="button"
                onClick={() => void onOpenSystemClick()}
                className="rounded-lg border border-neutral-300 px-3.5 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                ⚙️ {t('diary.settingsMicOpenSystem')}
              </button>
            )}
          </div>
        </section>
      )}

      {/* Транскрибация: smart transcription */}
      <section className={cardCls}>
        <h2 className={labelCls}>🎧 {t('diary.settingsTranscription')}</h2>
        <div className="mt-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
              {t('diary.smartTranscription')}
            </p>
            <p className={hintCls}>{t('diary.smartTranscriptionHint')}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.smartTranscription}
            disabled={togglingSmart}
            onClick={() => void toggleSmart(!settings.smartTranscription)}
            className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${
              settings.smartTranscription ? 'bg-emerald-500' : 'bg-neutral-300 dark:bg-neutral-700'
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                settings.smartTranscription ? 'left-[22px]' : 'left-0.5'
              }`}
            />
          </button>
        </div>
      </section>

      {/* Словарь Voxel (Ф3): редактируется в Voxel, сюда пушится автоматически */}
      <section className={cardCls}>
        <h2 className={labelCls}>📚 {t('diary.vocabTitle')}</h2>
        {settings.vocabulary.length > 0 ? (
          <>
            <p className="mt-1 text-sm font-medium text-emerald-600 dark:text-emerald-400">
              {t('diary.vocabCount', { n: settings.vocabulary.length })}
            </p>
            <p className={hintCls}>{t('diary.vocabHint')}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {settings.vocabulary.slice(0, 12).map((phrase) => (
                <span
                  key={phrase}
                  className="rounded-md bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                >
                  {phrase}
                </span>
              ))}
              {settings.vocabulary.length > 12 && (
                <span className="rounded-md px-2 py-0.5 text-xs text-neutral-400 dark:text-neutral-500">
                  +{settings.vocabulary.length - 12}
                </span>
              )}
            </div>
          </>
        ) : (
          <p className={hintCls}>{t('diary.vocabEmpty')}</p>
        )}
      </section>

      {/* Промпт выжимки */}
      <section className={cardCls}>
        <h2 className={labelCls}>✨ {t('diary.settingsPrompt')}</h2>
        <p className={hintCls}>
          {t('diary.settingsPromptHint', { placeholder: '{active_experiments_json}' })}
        </p>
        <textarea
          ref={promptRef}
          value={promptDraft}
          onChange={(e) => setPromptDraft(e.target.value)}
          placeholder={t('diary.settingsPromptPlaceholder')}
          rows={6}
          className={`${inputCls} mt-3 resize-y overflow-y-auto font-mono text-xs leading-relaxed`}
        />
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void savePrompt()}
            disabled={!promptDirty || savingPrompt}
            className="rounded-lg bg-neutral-900 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-30 dark:bg-emerald-500 dark:hover:bg-emerald-600"
          >
            {savingPrompt ? '…' : t('diary.save')}
          </button>
          <button
            type="button"
            onClick={() => void resetPrompt()}
            disabled={savingPrompt || promptDraft.trim() === DEFAULT_SUMMARY_PROMPT.trim()}
            className="rounded-lg border border-neutral-300 px-3.5 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-30 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {t('diary.settingsPromptReset')}
          </button>
        </div>
      </section>

      {/* API-ключи */}
      <section className={cardCls}>
        <div className="flex items-center justify-between gap-2">
          <h2 className={labelCls}>🔑 {t('diary.settingsApiKeys')}</h2>
          <button
            type="button"
            onClick={() => setShowKeys((v) => !v)}
            aria-label={showKeys ? t('diary.keysHide') : t('diary.keysShow')}
            title={showKeys ? t('diary.keysHide') : t('diary.keysShow')}
            className="rounded-lg p-1.5 text-base leading-none text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            {showKeys ? '🙈' : '👁️'}
          </button>
        </div>
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-neutral-600 dark:text-neutral-300">
              {t('diary.geminiKey')}
            </span>
            <input
              type={showKeys ? 'text' : 'password'}
              value={geminiDraft}
              onChange={(e) => setGeminiDraft(e.target.value)}
              placeholder="AIza…"
              autoComplete="off"
              spellCheck={false}
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-neutral-600 dark:text-neutral-300">
              {t('diary.groqKey')}
            </span>
            <input
              type={showKeys ? 'text' : 'password'}
              value={groqDraft}
              onChange={(e) => setGroqDraft(e.target.value)}
              placeholder="gsk_…"
              autoComplete="off"
              spellCheck={false}
              className={inputCls}
            />
          </label>
          <button
            type="button"
            onClick={() => void saveKeys()}
            disabled={!keysDirty || savingKeys}
            className="self-start rounded-lg bg-neutral-900 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-30 dark:bg-emerald-500 dark:hover:bg-emerald-600"
          >
            {savingKeys ? '…' : t('diary.save')}
          </button>
        </div>
      </section>
    </div>
  )
}
