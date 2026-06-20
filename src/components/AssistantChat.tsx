import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useLang } from '../lib/i18n'
import ConfirmDialog from './ConfirmDialog'
import { isVoiceSupported, startDictation, type Dictation } from '../lib/voice'
import {
  ASSISTANT_NAME,
  askAssistant,
  loadAiMessages,
  saveAiMessage,
  clearAiMessages,
  buildPurchaseQuestion,
  buildMonthlyReviewQuestion,
  PURCHASE_SKILL,
  AUTOCAT_SKILL,
  ANALYSIS_SKILL,
  extractAction,
  describeAction,
  runAction,
  type AiMessage,
  type AiAction,
} from '../lib/assistant'

// Основная «зелёная» кнопка в формах помощника (разбор покупки / быстрый ввод).
const btnPrimary =
  'rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-medium text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-60'

// Пункт всплывающего меню кнопки «+» (быстрые действия ассистента).
const menuItem =
  'flex w-full items-center rounded-xl px-3 py-2.5 text-left text-sm text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-60 dark:text-neutral-200 dark:hover:bg-neutral-800'

// Короткая подпись провайдера под ответом ассистента (какой мозг ответил).
function providerLabel(provider: string | null): string | null {
  if (!provider) return null
  if (provider === 'grok') return 'Grok'
  if (provider === 'nvidia') return 'GLM'
  return provider
}

export default function AssistantChat({ onClose }: { onClose?: () => void }) {
  const { user } = useAuth()
  const { t, lang } = useLang()

  const [messages, setMessages] = useState<AiMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [pendingAction, setPendingAction] = useState<AiAction | null>(null)

  // Меню быстрых действий (кнопка «+» в поле ввода).
  const [plusOpen, setPlusOpen] = useState(false)

  // Разбор покупки (ИИ-4): мини-форма помощника.
  const [showPurchase, setShowPurchase] = useState(false)
  const [pItem, setPItem] = useState('')
  const [pPrice, setPPrice] = useState('')

  // Быстрый ввод (ИИ-6): одна строка с авто-категоризацией.
  const [showQuick, setShowQuick] = useState(false)
  const [qText, setQText] = useState('')

  // Голосовой ввод (ИИ-6): диктовка через Web Speech API.
  const voiceSupported = useMemo(() => isVoiceSupported(), [])
  const [listening, setListening] = useState(false)
  const dictationRef = useRef<Dictation | null>(null)

  const endRef = useRef<HTMLDivElement | null>(null)
  const taRef = useRef<HTMLTextAreaElement | null>(null)

  // Загружаем историю чата при входе.
  useEffect(() => {
    if (!user) return
    let active = true
    ;(async () => {
      try {
        setLoading(true)
        const rows = await loadAiMessages(user.id)
        if (active) setMessages(rows)
      } catch (e) {
        if (active) setError((e as Error).message)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [user])

  // Автопрокрутка вниз при новых сообщениях.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  // Поле ввода растёт под текст (до предела), затем прокручивается внутри себя.
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'
  }, [input])

  // Останавливаем диктовку при размонтировании (закрытии окна).
  useEffect(() => {
    return () => {
      dictationRef.current?.stop()
      dictationRef.current = null
    }
  }, [])

  // Общая отправка сообщения ассистенту. options.skill подмешивает нужный навык.
  const sendMessage = async (text: string, options?: { skill?: string }) => {
    if (!text || sending || !user) return
    setError(null)
    const history = messages
    const userMsg: AiMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      provider: null,
      model: null,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, userMsg])
    setSending(true)
    try {
      void saveAiMessage(user.id, { role: 'user', content: text })
      const res = await askAssistant(user.id, text, history, options)
      if (res.error) {
        const msg =
          res.error === 'network'
            ? t('ai.errNetwork')
            : res.error === 'limit'
              ? t('ai.errLimit')
              : t('ai.errGeneric')
        setError(msg)
        return
      }
      const { text: cleanText, action } = extractAction(res.reply)
      const display =
        cleanText.length > 0
          ? cleanText
          : action
            ? 'Готов записать операцию, подтверди ниже 👇'
            : res.reply
      const aiMsg: AiMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: display,
        provider: res.provider,
        model: res.model,
        created_at: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, aiMsg])
      void saveAiMessage(user.id, {
        role: 'assistant',
        content: display,
        provider: res.provider,
        model: res.model,
      })
      if (action) setPendingAction(action)
    } catch {
      setError(t('ai.errNetwork'))
    } finally {
      setSending(false)
    }
  }

  const submit = async () => {
    const text = input.trim()
    if (!text || sending) return
    setInput('')
    await sendMessage(text)
  }

  const submitPurchase = async () => {
    const item = pItem.trim()
    if (!item || sending) return
    const text = buildPurchaseQuestion(item, pPrice)
    setShowPurchase(false)
    setPItem('')
    setPPrice('')
    await sendMessage(text, { skill: PURCHASE_SKILL })
  }

  // Голос: общий запуск/остановка диктовки. append говорит, куда дописывать текст.
  const stopVoice = () => {
    dictationRef.current?.stop()
    dictationRef.current = null
    setListening(false)
  }
  const beginDictation = (append: (text: string) => void) => {
    const d = startDictation(lang === 'en' ? 'en-US' : 'ru-RU', {
      onText: (text) => append(text),
      onEnd: () => {
        dictationRef.current = null
        setListening(false)
      },
      onError: () => {
        dictationRef.current = null
        setListening(false)
      },
    })
    if (d) {
      dictationRef.current = d
      setListening(true)
    }
  }
  // Микрофон в основном поле ввода: диктуем прямо в строку запроса.
  const toggleMainVoice = () => {
    if (listening) {
      stopVoice()
      return
    }
    beginDictation((text) => setInput((prev) => (prev ? prev + ' ' : '') + text))
  }
  // Микрофон в форме быстрого ввода: диктуем в её поле.
  const toggleQuickVoice = () => {
    if (listening) {
      stopVoice()
      return
    }
    beginDictation((text) => setQText((prev) => (prev ? prev + ' ' : '') + text))
  }

  const submitQuick = async () => {
    const text = qText.trim()
    if (!text || sending) return
    stopVoice()
    setShowQuick(false)
    setQText('')
    await sendMessage(text, { skill: AUTOCAT_SKILL })
  }

  const submitAnalysis = async () => {
    if (sending) return
    setShowPurchase(false)
    setShowQuick(false)
    await sendMessage(buildMonthlyReviewQuestion(), { skill: ANALYSIS_SKILL })
  }

  // Кнопка «+»: пункты открывают нужную форму или сразу запускают разбор месяца.
  const openPurchase = () => {
    setPlusOpen(false)
    setShowQuick(false)
    setShowPurchase(true)
  }
  const openQuick = () => {
    setPlusOpen(false)
    setShowPurchase(false)
    setShowQuick(true)
  }
  const openAnalysis = () => {
    setPlusOpen(false)
    void submitAnalysis()
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void submit()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter отправляет, Shift+Enter переносит строку (поле растёт вниз).
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  const doClear = async () => {
    setConfirmClear(false)
    if (!user) return
    const prev = messages
    setMessages([])
    try {
      await clearAiMessages(user.id)
    } catch (e) {
      setMessages(prev)
      setError((e as Error).message)
    }
  }

  const doAction = async () => {
    if (!user || !pendingAction) return
    const action = pendingAction
    setPendingAction(null)
    const res = await runAction(user.id, action)
    const note: AiMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: (res.ok ? '✅ ' : '⚠️ ') + res.message,
      provider: null,
      model: null,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, note])
    void saveAiMessage(user.id, { role: 'assistant', content: note.content })
  }

  const canSend = !!input.trim() && !sending

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Шапка окна: название, очистка и крестик закрытия (если окно-виджет). */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{t('ai.title')}</h2>
          <p className="truncate text-xs text-neutral-500">{ASSISTANT_NAME}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              title={t('ai.clear')}
              aria-label={t('ai.clear')}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-base text-neutral-500 transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              🗑️
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              title={t('ai.close')}
              aria-label={t('ai.close')}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-lg text-neutral-500 transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              ✕
            </button>
          )}
        </div>
      </header>

      {/* Прокручиваемая область: формы и сообщения. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        {showPurchase && (
          <div className="flex flex-col gap-2 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50">
            <p className="text-sm font-medium">{t('ai.purchaseTitle')}</p>
            <p className="text-xs text-neutral-500">{t('ai.purchaseHint')}</p>
            <input
              value={pItem}
              onChange={(e) => setPItem(e.target.value)}
              placeholder={t('ai.purchaseItem')}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950"
            />
            <input
              value={pPrice}
              onChange={(e) => setPPrice(e.target.value)}
              inputMode="decimal"
              placeholder={t('ai.purchasePrice')}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void submitPurchase()}
                disabled={sending || !pItem.trim()}
                className={btnPrimary}
              >
                {t('ai.purchaseGo')}
              </button>
              <button
                type="button"
                onClick={() => setShowPurchase(false)}
                className="rounded-lg border border-neutral-300 px-4 py-2.5 text-sm transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}

        {showQuick && (
          <div className="flex flex-col gap-2 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50">
            <p className="text-sm font-medium">{t('ai.quickTitle')}</p>
            <p className="text-xs text-neutral-500">{t('ai.quickHint')}</p>
            <div className="flex gap-2">
              <input
                value={qText}
                onChange={(e) => setQText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void submitQuick()
                  }
                }}
                placeholder={t('ai.quickPlaceholder')}
                className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950"
              />
              {voiceSupported && (
                <button
                  type="button"
                  onClick={toggleQuickVoice}
                  title={t('ai.voice')}
                  className={
                    listening
                      ? 'shrink-0 rounded-lg border border-red-400 bg-red-500/10 px-3 py-2.5 text-sm text-red-600 transition dark:text-red-400'
                      : 'shrink-0 rounded-lg border border-neutral-300 px-3 py-2.5 text-sm transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
                  }
                >
                  {listening ? '⏹' : '🎤'}
                </button>
              )}
            </div>
            {listening && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400">{t('ai.voiceListening')}</p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void submitQuick()}
                disabled={sending || !qText.trim()}
                className={btnPrimary}
              >
                {t('ai.quickGo')}
              </button>
              <button
                type="button"
                onClick={() => {
                  stopVoice()
                  setShowQuick(false)
                }}
                className="rounded-lg border border-neutral-300 px-4 py-2.5 text-sm transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-neutral-500 dark:text-neutral-400">{t('common.loading')}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.length === 0 && (
              <div className="rounded-2xl border border-neutral-200 bg-white p-4 text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/50 dark:text-neutral-300">
                <p>{t('ai.empty')}</p>
                <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">{t('ai.privacy')}</p>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={
                    m.role === 'user'
                      ? 'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-emerald-500 px-4 py-2.5 text-sm text-neutral-950'
                      : 'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 text-sm dark:border-neutral-800 dark:bg-neutral-900/50'
                  }
                >
                  {m.content}
                  {m.role === 'assistant' && providerLabel(m.provider) && (
                    <span className="mt-1.5 block text-[10px] text-neutral-400">
                      {providerLabel(m.provider)}
                      {m.model ? ` · ${m.model}` : ''}
                    </span>
                  )}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/50">
                  {t('ai.thinking')}
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
        )}

        {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}
      </div>

      {/* Поле ввода (минималистичное, в стиле ChatGPT): текст сверху, кнопки снизу. */}
      <div className="relative shrink-0 px-3 pt-1">
        {plusOpen && (
          <>
            {/* Невидимый слой: клик мимо меню закрывает его. */}
            <button
              type="button"
              aria-hidden="true"
              tabIndex={-1}
              onClick={() => setPlusOpen(false)}
              className="fixed inset-0 z-10 cursor-default"
            />
            <div className="absolute bottom-full left-3 z-20 mb-2 w-64 overflow-hidden rounded-2xl border border-neutral-200 bg-white p-1 shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
              <button type="button" onClick={openPurchase} className={menuItem}>
                {t('ai.purchase')}
              </button>
              <button type="button" onClick={openQuick} className={menuItem}>
                {t('ai.quick')}
              </button>
              <button type="button" onClick={openAnalysis} disabled={sending} className={menuItem}>
                {t('ai.analysis')}
              </button>
            </div>
          </>
        )}

        {listening && (
          <p className="mb-1 px-2 text-xs text-emerald-600 dark:text-emerald-400">{t('ai.voiceListening')}</p>
        )}

        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-2 rounded-3xl border border-neutral-300 bg-white px-3 py-2 transition focus-within:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-900"
        >
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={t('ai.placeholder')}
            className="max-h-40 w-full resize-none bg-transparent px-1 pt-1 text-sm outline-none placeholder:text-neutral-400 dark:placeholder:text-neutral-500"
          />
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setPlusOpen((v) => !v)}
              title={t('common.add')}
              aria-label={t('common.add')}
              aria-expanded={plusOpen}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-neutral-300 text-neutral-600 transition hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <span className={`text-xl leading-none transition-transform ${plusOpen ? 'rotate-45' : ''}`}>+</span>
            </button>
            <div className="flex items-center gap-1">
              {voiceSupported && (
                <button
                  type="button"
                  onClick={toggleMainVoice}
                  title={t('ai.voice')}
                  aria-label={t('ai.voice')}
                  className={
                    listening
                      ? 'flex h-9 w-9 items-center justify-center rounded-full bg-red-500/10 text-base text-red-600 transition dark:text-red-400'
                      : 'flex h-9 w-9 items-center justify-center rounded-full text-base text-neutral-500 transition hover:bg-neutral-100 dark:hover:bg-neutral-800'
                  }
                >
                  {listening ? '⏹' : '🎤'}
                </button>
              )}
              <button
                type="submit"
                disabled={!canSend}
                aria-label={t('ai.send')}
                title={t('ai.send')}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500 text-neutral-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 dark:disabled:bg-neutral-800 dark:disabled:text-neutral-600"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 19V5" />
                  <path d="M5 12l7-7 7 7" />
                </svg>
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* ИИ-8: дисклеймер - подсказки образовательные, а не финансовая консультация. */}
      <p className="shrink-0 px-4 pb-2 pt-1.5 text-center text-[10px] leading-tight text-neutral-400 dark:text-neutral-500">
        {t('ai.disclaimer')}
      </p>

      <ConfirmDialog
        open={confirmClear}
        title={t('ai.clearTitle')}
        message={t('ai.clearMsg')}
        confirmLabel={t('common.delete')}
        danger
        onConfirm={doClear}
        onCancel={() => setConfirmClear(false)}
      />

      <ConfirmDialog
        open={!!pendingAction}
        title={t('ai.actionTitle')}
        message={pendingAction ? describeAction(pendingAction) : ''}
        confirmLabel={t('ai.actionConfirm')}
        onConfirm={() => void doAction()}
        onCancel={() => setPendingAction(null)}
      />
    </div>
  )
}
