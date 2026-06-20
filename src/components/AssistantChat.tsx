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

const btnPrimary =
  'rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-medium text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-60'

const chipBtn =
  'rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-700 transition hover:bg-emerald-500/20 disabled:opacity-60 dark:text-emerald-400'

// Короткая подпись провайдера под ответом ассистента (какой мозг ответил).
function providerLabel(provider: string | null): string | null {
  if (!provider) return null
  if (provider === 'grok') return 'Grok'
  if (provider === 'nvidia') return 'GLM'
  return provider
}

// Чат с ассистентом «FinLit Бухгалтер». Заполняет контейнер по высоте, поэтому одинаково
// хорошо работает и на всю страницу, и внутри плавающего окна-виджета (ИИ-7 / виджет).
// onClose, если передан, показывает крестик закрытия в шапке (для окна-виджета).
export default function AssistantChat({ onClose }: { onClose?: () => void }) {
  const { user } = useAuth()
  const { t, lang } = useLang()

  const [messages, setMessages] = useState<AiMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  // Действие (ИИ-5), предложенное ассистентом и ждущее подтверждения.
  const [pendingAction, setPendingAction] = useState<AiAction | null>(null)

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
      // Сохраняем вопрос пользователя (не блокируем ответ ожиданием записи).
      void saveAiMessage(user.id, { role: 'user', content: text })
      const res = await askAssistant(user.id, text, history, options)
      if (res.error) {
        setError(res.error === 'network' ? t('ai.errNetwork') : t('ai.errGeneric'))
        return
      }
      // ИИ-5: вытаскиваем возможное действие и показываем чистый текст без служебного блока.
      const { text: cleanText, action } = extractAction(res.reply)
      const display =
        cleanText.length > 0
          ? cleanText
          : action
            ? 'Готов записать операцию, подтвердите ниже 👇'
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

  // Разбор покупки: собираем читаемый вопрос и шлём с навыком PURCHASE_SKILL.
  const submitPurchase = async () => {
    const item = pItem.trim()
    if (!item || sending) return
    const text = buildPurchaseQuestion(item, pPrice)
    setShowPurchase(false)
    setPItem('')
    setPPrice('')
    await sendMessage(text, { skill: PURCHASE_SKILL })
  }

  // Голос: запуск/остановка диктовки. Распознанный текст добавляем в поле быстрого ввода.
  const stopVoice = () => {
    dictationRef.current?.stop()
    dictationRef.current = null
    setListening(false)
  }
  const toggleVoice = () => {
    if (listening) {
      stopVoice()
      return
    }
    const d = startDictation(lang === 'en' ? 'en-US' : 'ru-RU', {
      onText: (text) => setQText((prev) => (prev ? prev + ' ' : '') + text),
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

  // Быстрый ввод (ИИ-6): шлём фразу с навыком авто-категоризации.
  const submitQuick = async () => {
    const text = qText.trim()
    if (!text || sending) return
    stopVoice()
    setShowQuick(false)
    setQText('')
    await sendMessage(text, { skill: AUTOCAT_SKILL })
  }

  // Разбор месяца (ИИ-7): одной кнопкой просим анализ и инсайты по сводке.
  const submitAnalysis = async () => {
    if (sending) return
    setShowPurchase(false)
    setShowQuick(false)
    await sendMessage(buildMonthlyReviewQuestion(), { skill: ANALYSIS_SKILL })
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void submit()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
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

  // ИИ-5: пользователь подтвердил действие - выполняем запись и пишем результат в чат.
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

      {/* Прокручиваемая область: быстрые кнопки, формы и сообщения. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setShowPurchase((v) => !v)
              setShowQuick(false)
            }}
            className={chipBtn}
          >
            {t('ai.purchase')}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowQuick((v) => !v)
              setShowPurchase(false)
            }}
            className={chipBtn}
          >
            {t('ai.quick')}
          </button>
          <button type="button" onClick={() => void submitAnalysis()} disabled={sending} className={chipBtn}>
            {t('ai.analysis')}
          </button>
        </div>

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
                  onClick={toggleVoice}
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
                {t('ai.empty')}
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

      {/* Поле ввода внизу окна. */}
      <form
        onSubmit={onSubmit}
        className="flex shrink-0 items-end gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={t('ai.placeholder')}
          className="max-h-40 min-h-[44px] flex-1 resize-none rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950"
        />
        <button type="submit" disabled={sending || !input.trim()} className={btnPrimary}>
          {t('ai.send')}
        </button>
      </form>

      {/* ИИ-8: дисклеймер - ассистент даёт образовательные подсказки, а не финансовую консультацию. */}
      <p className="shrink-0 px-4 pb-2 text-center text-[10px] leading-tight text-neutral-400 dark:text-neutral-500">
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
