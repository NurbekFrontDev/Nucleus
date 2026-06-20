import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useLang } from '../lib/i18n'
import ConfirmDialog from '../components/ConfirmDialog'
import {
  ASSISTANT_NAME,
  askAssistant,
  loadAiMessages,
  saveAiMessage,
  clearAiMessages,
  buildPurchaseQuestion,
  PURCHASE_SKILL,
  type AiMessage,
} from '../lib/assistant'

const btnPrimary =
  'rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-medium text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-60'

// Короткая подпись провайдера под ответом ассистента (какой мозг ответил).
function providerLabel(provider: string | null): string | null {
  if (!provider) return null
  if (provider === 'grok') return 'Grok'
  if (provider === 'nvidia') return 'GLM'
  return provider
}

export default function Assistant() {
  const { user } = useAuth()
  const { t } = useLang()

  const [messages, setMessages] = useState<AiMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)

  // Разбор покупки (ИИ-4): мини-форма помощника.
  const [showPurchase, setShowPurchase] = useState(false)
  const [pItem, setPItem] = useState('')
  const [pPrice, setPPrice] = useState('')

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
      const aiMsg: AiMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: res.reply,
        provider: res.provider,
        model: res.model,
        created_at: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, aiMsg])
      void saveAiMessage(user.id, {
        role: 'assistant',
        content: res.reply,
        provider: res.provider,
        model: res.model,
      })
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('ai.title')}</h1>
          <p className="text-xs text-neutral-500">{ASSISTANT_NAME}</p>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            className="shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {t('ai.clear')}
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setShowPurchase((v) => !v)}
          className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-700 transition hover:bg-emerald-500/20 dark:text-emerald-400"
        >
          {t('ai.purchase')}
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

      <form
        onSubmit={onSubmit}
        className="sticky bottom-20 flex items-end gap-2 bg-white/80 py-1 backdrop-blur md:bottom-0 dark:bg-neutral-950/80"
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

      <ConfirmDialog
        open={confirmClear}
        title={t('ai.clearTitle')}
        message={t('ai.clearMsg')}
        confirmLabel={t('common.delete')}
        danger
        onConfirm={doClear}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  )
}
