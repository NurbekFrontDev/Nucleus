import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useLang } from '../lib/i18n'
import {
  loadPlannerStats,
  loadHabits,
  type PlannerStats,
  type StatsPeriod,
  type HabitStats,
} from '../lib/planner'
import { readCache, writeCache } from '../lib/offlineCache'

// Экран «Статистика» (П-9): сводка выполнения дел и привычек за период,
//   фокус-время из Помодоро, столбики по дням и стрики привычек.
//   Это зеркало прогресса для мотивации и совет коуча по проценту выполнения.

const cardCls =
  'rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50'

const PERIODS: StatsPeriod[] = ['week', 'month', 'all']

type StatsCache = { stats: PlannerStats; habits: HabitStats[] }

export default function PlannerStats() {
  const { user } = useAuth()
  const { t, lang } = useLang()

  const [period, setPeriod] = useState<StatsPeriod>('week')
  const [stats, setStats] = useState<PlannerStats | null>(null)
  const [habits, setHabits] = useState<HabitStats[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    let active = true
    // Мгновенно показываем кэш (без спиннера и без интернета), сеть обновляет в фоне.
    const ck = `planstats:${user.id}:${period}`
    const cached = readCache<StatsCache>(ck)
    if (cached) {
      setStats(cached.stats)
      setHabits(cached.habits)
      setLoading(false)
    } else {
      setLoading(true)
    }
    ;(async () => {
      try {
        const [s, h] = await Promise.all([
          loadPlannerStats(user.id, period),
          loadHabits(user.id),
        ])
        if (!active) return
        setStats(s)
        setHabits(h)
        setError(null)
        writeCache(ck, { stats: s, habits: h })
      } catch (e) {
        if (active) setError((e as Error).message)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [user, period])

  const pct = (done: number, total: number) => (total > 0 ? Math.round((done / total) * 100) : 0)
  const totalPlanned = stats ? stats.taskPlanned + stats.habitPlanned : 0
  const totalDone = stats ? stats.taskDone + stats.habitDone : 0
  const overallPct = pct(totalDone, totalPlanned)

  const periodLabel = (p: StatsPeriod) =>
    p === 'week'
      ? t('stats.periodWeek')
      : p === 'month'
        ? t('stats.periodMonth')
        : t('stats.periodAll')

  // Подсказка коуча по общему проценту выполнения.
  const coach = useMemo(() => {
    if (!stats || totalPlanned === 0) return null
    if (overallPct >= 80) return t('stats.coachGreat')
    if (overallPct >= 50) return t('stats.coachGood')
    if (overallPct >= 20) return t('stats.coachLow')
    return t('stats.coachStart')
  }, [stats, totalPlanned, overallPct, t])

  // Привычки по убыванию текущего стрика, затем рекорда.
  const sortedHabits = useMemo(
    () => habits.slice().sort((a, b) => b.current - a.current || b.best - a.best),
    [habits],
  )

  const showChart = !!stats && stats.perDay.length <= 31
  const maxRange = stats ? Math.max(1, ...stats.perDay.map((x) => x.planned)) : 1

  const focusLabel = (min: number): string => {
    const h = Math.floor(min / 60)
    const m = min % 60
    if (h > 0) return t('stats.focusTime', { h, m })
    return t('stats.focusTimeMin', { m })
  }

  const dayLabel = (date: string): string => {
    const dt = new Date(date + 'T00:00:00')
    const wd = (dt.getDay() + 6) % 7
    const ru = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
    const en = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
    return (lang === 'en' ? en : ru)[wd]
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      {/* Закреплённая шапка: заголовок + переключатель периода не двигаются. */}
      <div className="sticky top-0 z-20 -mx-4 flex flex-col gap-3 border-b border-neutral-200/70 bg-white/85 px-4 py-3 backdrop-blur dark:border-neutral-800/70 dark:bg-neutral-950/85">
        <h1 className="text-xl font-semibold">{t('pnav.stats')}</h1>

      {/* Переключатель периода */}
      <div className="flex gap-1 rounded-xl border border-neutral-200 p-1 dark:border-neutral-800">
        {PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              period === p
                ? 'bg-emerald-500 text-neutral-950'
                : 'text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800'
            }`}
          >
            {periodLabel(p)}
          </button>
        ))}
      </div>
      </div>

      {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}

      {loading || !stats ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('common.loading')}</p>
      ) : totalPlanned === 0 && stats.focusSessions === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
          {t('stats.empty')}
        </p>
      ) : (
        <>
          {/* Общий процент выполнения */}
          <div className={cardCls}>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">{t('stats.overall')}</p>
              <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                {overallPct}%
              </span>
            </div>
            <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${overallPct}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
              {t('stats.doneOf', { done: totalDone, total: totalPlanned })} {t('stats.overallSub')}
            </p>
          </div>

          {/* Дела / Привычки / Фокус */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className={cardCls}>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">✅ {t('stats.tasks')}</p>
              <p className="mt-1 text-2xl font-semibold">{pct(stats.taskDone, stats.taskPlanned)}%</p>
              <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                {t('stats.doneOf', { done: stats.taskDone, total: stats.taskPlanned })}
              </p>
            </div>
            <div className={cardCls}>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">🔁 {t('stats.habits')}</p>
              <p className="mt-1 text-2xl font-semibold">{pct(stats.habitDone, stats.habitPlanned)}%</p>
              <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                {t('stats.doneOf', { done: stats.habitDone, total: stats.habitPlanned })}
              </p>
            </div>
            <div className={cardCls}>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">🍅 {t('stats.focus')}</p>
              <p className="mt-1 text-2xl font-semibold">{focusLabel(stats.focusMin)}</p>
              <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                {t('stats.focusSessions', { n: stats.focusSessions })}
              </p>
            </div>
          </div>

          {/* Совет коуча */}
          {coach && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
              <p className="mb-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
                {t('stats.coachTitle')}
              </p>
              <p className="text-neutral-700 dark:text-neutral-200">{coach}</p>
            </div>
          )}

          {/* График по дням */}
          <div className={cardCls}>
            <p className="mb-3 text-sm font-medium">{t('stats.byDay')}</p>
            {showChart ? (
              <div className="flex items-end gap-1" style={ { height: '80px' } }>
                {stats.perDay.map((day) => {
                  const h = maxRange > 0 ? Math.round((day.planned / maxRange) * 64) : 0
                  const dh = day.planned > 0 ? Math.round((day.done / day.planned) * h) : 0
                  return (
                    <div key={day.date} className="flex flex-1 flex-col items-center gap-1">
                      <div
                        className="flex w-full flex-col justify-end overflow-hidden rounded-md bg-neutral-200 dark:bg-neutral-800"
                        style={{ height: `${Math.max(h, 3)}px` }}
                        title={`${day.date}: ${day.done}/${day.planned}`}
                      >
                        <div className="w-full bg-emerald-500" style={{ height: `${dh}px` }} />
                      </div>
                      {stats.perDay.length <= 14 && (
                        <span className="text-[9px] text-neutral-400">{dayLabel(day.date)}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-xs text-neutral-500 dark:text-neutral-400">{t('stats.byDayLong')}</p>
            )}
          </div>

          {/* Стрики привычек */}
          <div className={cardCls}>
            <p className="mb-3 text-sm font-medium">{t('stats.streaks')}</p>
            {sortedHabits.length === 0 ? (
              <p className="text-xs text-neutral-500 dark:text-neutral-400">{t('stats.noHabits')}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {sortedHabits.map((h) => (
                  <div key={h.item.id} className="flex items-center gap-2 text-sm">
                    {h.item.icon && <span className="shrink-0">{h.item.icon}</span>}
                    <span className="min-w-0 flex-1 truncate">{h.item.title}</span>
                    <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">🏆 {h.best}</span>
                    <span className="shrink-0 rounded-md bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700 dark:bg-orange-500/15 dark:text-orange-300">
                      🔥 {h.current}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
