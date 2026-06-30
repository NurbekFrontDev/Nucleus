import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useLang } from '../lib/i18n'
import {
  loadDay,
  todayStr,
  itemQuadrant,
  PRIORITY_DOT,
  type PlannerItem,
  type Quadrant,
} from '../lib/planner'

// Экран «Матрица» (П-8): зеркало дня по матрице Эйзенхауэра.
//   Берём дела сегодняшнего дня (как на экране «Сегодня») и раскладываем по
//   4 квадрантам: срочность (🔴 красная важность) × важность (⭐ метка «Важно»).
//   Это не второй список, а проверка баланса: хватает ли дел для роста (q2).
//   Подсказка коуча сверху помогает не утонуть в срочной суете.

type QuadMeta = {
  key: Quadrant
  ring: string
  dot: string
}

const QUADS: QuadMeta[] = [
  { key: 'q1', ring: 'border-red-300 dark:border-red-500/40', dot: '🔴' },
  { key: 'q2', ring: 'border-emerald-300 dark:border-emerald-500/40', dot: '🟢' },
  { key: 'q3', ring: 'border-sky-300 dark:border-sky-500/40', dot: '🔵' },
  { key: 'q4', ring: 'border-neutral-300 dark:border-neutral-700', dot: '⚪' },
]

export default function PlannerMatrix() {
  const { user } = useAuth()
  const { t } = useLang()
  const today = todayStr()

  const [items, setItems] = useState<PlannerItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    let active = true
    ;(async () => {
      try {
        setLoading(true)
        const day = await loadDay(user.id, today)
        if (!active) return
        setItems(day.items)
        setError(null)
      } catch (e) {
        if (active) setError((e as Error).message)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [user, today])

  // Раскладываем дела по квадрантам.
  const byQuad = useMemo(() => {
    const map: Record<Quadrant, PlannerItem[]> = { q1: [], q2: [], q3: [], q4: [] }
    for (const it of items) map[itemQuadrant(it)].push(it)
    return map
  }, [items])

  // Подсказка коуча по балансу дня.
  const coach = useMemo(() => {
    if (items.length === 0) return null
    if (byQuad.q2.length === 0) return t('matrix.coachNoGrowth')
    if (byQuad.q1.length >= 4) return t('matrix.coachOverload')
    if (byQuad.q3.length + byQuad.q4.length > byQuad.q1.length + byQuad.q2.length)
      return t('matrix.coachBusy')
    return t('matrix.coachBalanced')
  }, [byQuad, items.length, t])

  const renderQuad = (meta: QuadMeta) => {
    const list = byQuad[meta.key]
    return (
      <div key={meta.key} className={`flex flex-col gap-2 rounded-2xl border p-3 ${meta.ring}`}>
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <span>{meta.dot}</span>
            <span>{t(`matrix.${meta.key}`)}</span>
          </p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">{t(`matrix.${meta.key}do`)}</p>
        </div>
        {list.length === 0 ? (
          <p className="rounded-lg border border-dashed border-neutral-300 px-2 py-3 text-center text-xs text-neutral-400 dark:border-neutral-700">
            {t('matrix.emptyQuad')}
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {list.map((it) => (
              <div
                key={it.id}
                className="flex items-center gap-1.5 rounded-lg bg-neutral-50 px-2 py-1.5 text-sm dark:bg-neutral-800/40"
              >
                {PRIORITY_DOT[it.priority] && (
                  <span className="shrink-0 text-xs leading-none">{PRIORITY_DOT[it.priority]}</span>
                )}
                {it.important && <span className="shrink-0 text-xs leading-none">⭐</span>}
                {it.icon && <span className="shrink-0">{it.icon}</span>}
                <span className="truncate">{it.title}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div className="sticky top-0 z-20 -mx-4 border-b border-neutral-200/70 bg-white/85 px-4 py-3 backdrop-blur dark:border-neutral-800/70 dark:bg-neutral-950/85">
        <h1 className="text-xl font-semibold">{t('pnav.matrix')}</h1>
      </div>

      {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}

      {loading ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
          {t('matrix.todayEmpty')}
        </p>
      ) : (
        <>
          {coach && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
              <p className="mb-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
                {t('matrix.coachTitle')}
              </p>
              <p className="text-neutral-700 dark:text-neutral-200">{coach}</p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{QUADS.map(renderQuad)}</div>

          <p className="text-center text-[11px] text-neutral-400 dark:text-neutral-500">{t('matrix.legend')}</p>
        </>
      )}
    </div>
  )
}
