import { useState } from 'react'
import { useLang } from '../lib/i18n'

// Напоминалка о бэкапе раз в месяц.
// Дата последнего бэкапа и «отложить» хранятся в localStorage (на этом устройстве).
const BACKUP_KEY = 'finlit_last_backup'
const SNOOZE_KEY = 'finlit_backup_snooze'
const PERIOD_DAYS = 30
const SNOOZE_DAYS = 3
const TABLES = 'incomes, expenses, goals, goal_contributions, currencies, months, categories'
const PROJECT_REF = 'ewgrcmswwvbtoxdxkvuv'

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / 86400000)
}

function computeShouldShow(): boolean {
  const now = new Date()
  const snooze = localStorage.getItem(SNOOZE_KEY)
  if (snooze && new Date(snooze).getTime() > now.getTime()) return false
  const last = localStorage.getItem(BACKUP_KEY)
  if (!last) return true
  return daysBetween(now, new Date(last)) >= PERIOD_DAYS
}

const codeCls = 'rounded bg-neutral-100 px-1 py-0.5 text-[11px] dark:bg-neutral-800'

export default function BackupReminder() {
  const { t } = useLang()
  const [visible, setVisible] = useState(computeShouldShow)
  const [open, setOpen] = useState(false)

  if (!visible) return null

  const markDone = () => {
    localStorage.setItem(BACKUP_KEY, new Date().toISOString())
    localStorage.removeItem(SNOOZE_KEY)
    setVisible(false)
  }

  const snoozeLater = () => {
    const until = new Date()
    until.setDate(until.getDate() + SNOOZE_DAYS)
    localStorage.setItem(SNOOZE_KEY, until.toISOString())
    setVisible(false)
  }

  return (
    <div className="fixed bottom-24 right-4 z-20 w-[calc(100vw-2rem)] max-w-sm md:bottom-4">
      <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-start gap-3">
          <span className="text-xl">🛡️</span>
          <div className="flex-1">
            <p className="text-sm font-semibold">{t('backup.title')}</p>
            <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
              {t('backup.sub')}
            </p>
          </div>
        </div>

        <button
          onClick={() => setOpen((v) => !v)}
          className="mt-3 flex w-full items-center justify-between rounded-lg bg-neutral-100 px-3 py-2 text-xs font-medium text-neutral-600 transition hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
        >
          <span>{t('backup.how')}</span>
          <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
        </button>

        {open && (
          <div className="mt-3 space-y-3 text-xs text-neutral-600 dark:text-neutral-300">
            <div>
              <p className="font-semibold text-neutral-800 dark:text-neutral-100">{t('backup.way1')}</p>
              <ol className="mt-1 list-decimal space-y-1 pl-4">
                <li>{t('backup.way1s1')}</li>
                <li>{t('backup.way1s2', { t: TABLES })}</li>
                <li>{t('backup.way1s3')}</li>
              </ol>
            </div>
            <div>
              <p className="font-semibold text-neutral-800 dark:text-neutral-100">{t('backup.way2')}</p>
              <ol className="mt-1 list-decimal space-y-1 pl-4">
                <li>{t('backup.once')} <code className={codeCls}>supabase login</code></li>
                <li>{t('backup.once')} <code className={codeCls}>supabase link --project-ref {PROJECT_REF}</code></li>
                <li>{t('backup.each')} <code className={codeCls}>supabase db dump --data-only -f finlit-backup.sql</code></li>
              </ol>
            </div>
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
              {t('backup.warn')}
            </p>
          </div>
        )}

        <div className="mt-3 flex gap-2">
          <button
            onClick={markDone}
            className="flex-1 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-neutral-950 transition hover:bg-emerald-400"
          >
            {t('backup.done')}
          </button>
          <button
            onClick={snoozeLater}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-xs text-neutral-500 transition hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            {t('backup.later')}
          </button>
        </div>
      </div>
    </div>
  )
}
