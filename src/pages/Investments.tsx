import { useState } from 'react'
import { useLang } from '../lib/i18n'
import CryptoPortfolio from '../components/CryptoPortfolio'
import CryptoFutures from '../components/CryptoFutures'
import CryptoOverview from '../components/CryptoOverview'

// Под-вкладки раздела «Инвестиции». Наполнение добавляем по этапам:
// overview -- обзор портфеля и месячная сводка; spot/meme -- активы и сделки; futures -- фьючерсы.
type SubTab = 'overview' | 'spot' | 'meme' | 'futures'

const SUB_TABS: { id: SubTab; key: string; icon: string }[] = [
  { id: 'overview', key: 'inv.tab.overview', icon: '📊' },
  { id: 'spot', key: 'inv.tab.spot', icon: '🪙' },
  { id: 'meme', key: 'inv.tab.meme', icon: '🐸' },
  { id: 'futures', key: 'inv.tab.futures', icon: '⚡' },
]

export default function Investments() {
  const { t } = useLang()
  const [tab, setTab] = useState<SubTab>('overview')

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <span className="text-lg">📈</span>
        <h1 className="text-xl font-semibold">{t('inv.title')}</h1>
      </div>

      {/* Под-вкладки */}
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-neutral-200 bg-neutral-100/60 p-1 dark:border-neutral-800 dark:bg-neutral-900/50">
        {SUB_TABS.map((s) => (
          <button
            key={s.id}
            onClick={() => setTab(s.id)}
            className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition ${
              tab === s.id
                ? 'bg-white text-emerald-700 shadow-sm dark:bg-neutral-800 dark:text-emerald-400'
                : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100'
            }`}
          >
            <span>{s.icon}</span>
            {t(s.key)}
          </button>
        ))}
      </div>

      {/* Контент под-вкладки */}
      {tab === 'spot' ? (
        <CryptoPortfolio portfolio="main" />
      ) : tab === 'meme' ? (
        <CryptoPortfolio portfolio="meme" />
      ) : tab === 'futures' ? (
        <CryptoFutures />
      ) : (
        <CryptoOverview />
      )}
    </div>
  )
}
