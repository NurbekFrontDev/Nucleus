import { useEffect, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useLang } from '../lib/i18n'
import { loadCryptoAutoExpense, saveCryptoAutoExpense } from '../lib/db'
import SettingsModal from '../components/SettingsModal'

// Экран «Настройки» FinLit: настройки, относящиеся именно к модулю финансов.
// Общие настройки (язык, валюта, тема, бэкап, хранилище) перенесены в глобальное
// модальное окно настроек (доступно из профиля в левом нижнем углу или шапке).

export default function Settings() {
  const { user } = useAuth()
  const { t, lang } = useLang()
  const [cryptoAuto, setCryptoAuto] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)

  useEffect(() => {
    if (!user) return
    let active = true
    ;(async () => {
      try {
        const v = await loadCryptoAutoExpense(user.id)
        if (active) setCryptoAuto(v)
      } catch {
        if (active) setCryptoAuto(true)
      }
    })()
    return () => {
      active = false
    }
  }, [user])

  const toggleCryptoAuto = async () => {
    if (!user) return
    const next = !cryptoAuto
    setCryptoAuto(next)
    try {
      await saveCryptoAutoExpense(user.id, next)
    } catch {
      setCryptoAuto(!next)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="sticky top-0 z-20 -mx-4 border-b border-neutral-200/70 bg-white/85 px-4 py-3 backdrop-blur dark:border-neutral-800/70 dark:bg-neutral-950/85">
        <h1 className="text-2xl font-semibold">⚙️ {t('set.title')} (FinLit)</h1>
      </div>

      {/* Крипто: авто-расход при покупке */}
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900/50">
        <div className="min-w-0">
          <p className="font-medium">🪙 {t('set.cryptoAuto')}</p>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            {lang === 'en'
              ? 'Automatically create an expense transaction when buying cryptocurrency'
              : 'Автоматически создавать расход в истории при покупке криптовалюты'}
          </p>
        </div>
        <button
          onClick={toggleCryptoAuto}
          disabled={!user}
          className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${
            cryptoAuto
              ? 'bg-emerald-500 text-neutral-950 hover:bg-emerald-400'
              : 'border border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
          }`}
        >
          {cryptoAuto ? t('set.cryptoAutoOn') : t('set.cryptoAutoOff')}
        </button>
      </div>

      {/* Кнопка открытия общих настроек */}
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900/50">
        <div className="min-w-0">
          <p className="font-medium">🌐 {lang === 'en' ? 'Global Settings' : 'Общие настройки'}</p>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            {lang === 'en'
              ? 'Language, theme, display currency, backups, storage limits'
              : 'Язык, тема, валюта отображения, бэкапы, лимиты хранилища'}
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="shrink-0 rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          {lang === 'en' ? 'Open' : 'Открыть'}
        </button>
      </div>

      {modalOpen && <SettingsModal onClose={() => setModalOpen(false)} />}
    </div>
  )
}
