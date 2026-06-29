import { useLang } from '../lib/i18n'

// Placeholder screen for Planner pages. Real content arrives in stages P-3..P-9.
export default function PlannerStub({ titleKey, icon }: { titleKey: string; icon: string }) {
  const { t } = useLang()
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">
        {icon} {t(titleKey)}
      </h1>
      <div className="rounded-2xl border border-neutral-200 bg-white p-6 text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/50 dark:text-neutral-400">
        {t('planner.soon')}
      </div>
    </div>
  )
}
