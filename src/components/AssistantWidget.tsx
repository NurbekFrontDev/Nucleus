import { useState } from 'react'
import { useLang } from '../lib/i18n'
import AssistantChat from './AssistantChat'

// Плавающий виджет ассистента: кнопка-пузырь в правом нижнем углу. По нажатию
// открывается компактное окно с диалогом (не на весь экран), с крестиком закрытия.
// Монтируется глобально в Layout, поэтому доступен на всех страницах.
export default function AssistantWidget() {
  const { t } = useLang()
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Кнопка-пузырь (на мобильном поднята над нижней навигацией). */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={t('ai.open')}
          aria-label={t('ai.open')}
          className="fixed bottom-28 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-2xl shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-400 active:scale-95 md:bottom-6 md:right-6"
        >
          💬
        </button>
      )}

      {/* Окно диалога с ассистентом. */}
      {open && (
        <div className="fixed bottom-24 right-3 z-30 flex h-[70vh] max-h-[560px] w-[85vw] max-w-sm flex-col overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-950 md:bottom-6 md:right-6 md:h-[600px] md:w-[400px]">
          <AssistantChat onClose={() => setOpen(false)} />
        </div>
      )}
    </>
  )
}
