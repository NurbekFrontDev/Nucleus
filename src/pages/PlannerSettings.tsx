import { useEffect, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useLang } from '../lib/i18n'
import { loadDaySections, saveDaySections } from '../lib/planner'

// Экран «Настройки» планировщика (П-10): настройки, относящиеся
//   именно к планировщику. Пока здесь переключатель деления дня на
//   Утро/День/Вечер (перенесён сюда из общих настроек FinLit).

const cardCls =
  'rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50'

export default function PlannerSettings() {
  const { user } = useAuth()
  const { t } = useLang()

  const [daySections, setDaySections] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!user) return
    let active = true
    ;(async () => {
      try {
        const sections = await loadDaySections(user.id)
        if (active) setDaySections(sections)
      } catch {
        // оставляем выключенным
      } finally {
        if (active) setReady(true)
      }
    })()
    return () => {
      active = false
    }
  }, [user])

  const toggleDaySections = async () => {
    if (!user) return
    const next = !daySections
    setDaySections(next)
    try {
      await saveDaySections(user.id, next)
    } catch {
      setDaySections(!next)
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div className="sticky top-0 z-20 -mx-4 border-b border-neutral-200/70 bg-white/85 px-4 py-3 backdrop-blur dark:border-neutral-800/70 dark:bg-neutral-950/85">
        <h1 className="text-xl font-semibold">⚙️ {t('pnav.settings')}</h1>
      </div>

      <div className={`flex items-center justify-between gap-3 ${cardCls}`}>
        <div className="min-w-0">
          <p className="font-medium">✅ {t('set.daySections')}</p>
        </div>
        <button
          onClick={toggleDaySections}
          disabled={!user || !ready}
          className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition active:scale-[.97] disabled:opacity-50 ${
            daySections
              ? 'bg-emerald-500 text-neutral-950 hover:bg-emerald-400'
              : 'border border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
          }`}
        >
          {daySections ? t('set.on') : t('set.off')}
        </button>
      </div>
    </div>
  )
}
