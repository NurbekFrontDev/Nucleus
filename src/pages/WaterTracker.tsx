import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useLang } from '../lib/i18n'
import { addDays, todayStr } from '../lib/planner'
import {
  loadWaterDay,
  saveWaterGoal,
  addWaterLog,
  removeWaterLog,
  loadWaterWeek,
  type WaterDay,
} from '../lib/water'

const cardCls =
  'rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50'

const QUICK_STEPS = [150, 200, 250, 300, 350, 400, 450, 500, 550, 600]

const R = 100
const C = 2 * Math.PI * R

export default function WaterTracker() {
  const { user } = useAuth()
  const { t } = useLang()
  const today = todayStr()

  const [day, setDay] = useState<WaterDay | null>(null)
  const [weekData, setWeekData] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [selMl, setSelMl] = useState(250)
  const [goalEdit, setGoalEdit] = useState(false)
  const [goalDraft, setGoalDraft] = useState('')
  const [viewMode, setViewMode] = useState<'today' | 'history'>('today')
  const [histOffset, setHistOffset] = useState(0)

  useEffect(() => {
    if (!user) {
      setDay(null)
      setWeekData({})
      setLoading(false)
      return
    }

    let active = true
    setLoading(true)

    ;(async () => {
      try {
        const [d, w] = await Promise.all([
          loadWaterDay(user.id, today),
          loadWaterWeek(user.id, addDays(today, histOffset * 7)),
        ])
        if (!active) return
        setDay(d)
        setGoalDraft(String(d.goal))
        const nextWeek: Record<string, number> = {}
        for (const [date, ml] of Object.entries(w)) nextWeek[date] = ml
        setWeekData(nextWeek)
      } finally {
        if (active) setLoading(false)
      }
    })()

    return () => {
      active = false
    }
  }, [user, today, histOffset])

  const drunk = day?.drunk ?? 0
  const goal = day?.goal ?? 2000
  const pct = goal > 0 ? Math.min(100, Math.round((drunk / goal) * 100)) : 0
  const left = Math.max(0, goal - drunk)

  const cupVolumes = useMemo(() => {
    const step = Math.max(1, selMl)
    const target = Math.max(step, goal)
    const parts: number[] = []
    let remaining = target
    while (remaining > 0) {
      const part = Math.min(step, remaining)
      parts.push(part)
      remaining -= part
    }
    return parts
  }, [goal, selMl])

  const cupFills = useMemo(() => {
    let remaining = drunk
    return cupVolumes.map((cap) => {
      const fill = Math.max(0, Math.min(cap, remaining))
      remaining = Math.max(0, remaining - cap)
      return cap > 0 ? fill / cap : 0
    })
  }, [drunk, cupVolumes])

  const updateWeekDay = (date: string, delta: number) => {
    setWeekData((prev) => ({
      ...prev,
      [date]: Math.max(0, (prev[date] ?? 0) + delta),
    }))
  }

  const quickAdd = async (ml: number) => {
    if (!user) return
    try {
      const log = await addWaterLog(user.id, today, ml)
      setDay((prev) =>
        prev ? { ...prev, drunk: prev.drunk + ml, logs: [log, ...prev.logs] } : prev,
      )
      updateWeekDay(today, ml)
    } catch {
      /* ignore */
    }
  }

  const removeAmount = async (amount: number) => {
    if (!user || !day || day.logs.length === 0) return
    const log = day.logs.find((entry) => entry.amount === amount) ?? day.logs[0]
    try {
      await removeWaterLog(user.id, log.id)
      setDay((prev) =>
        prev
          ? {
              ...prev,
              drunk: Math.max(0, prev.drunk - log.amount),
              logs: prev.logs.filter((entry) => entry.id !== log.id),
            }
          : prev,
      )
      updateWeekDay(today, -log.amount)
    } catch {
      /* ignore */
    }
  }

  const toggleGlass = async (idx: number) => {
    const cupMl = cupVolumes[idx] ?? selMl
    const fill = cupFills[idx] ?? 0
    if (fill > 0) {
      await removeAmount(cupMl)
    } else {
      await quickAdd(cupMl)
    }
  }

  const saveGoal = async () => {
    const v = Number(goalDraft)
    if (!user || !v || v <= 0) return
    await saveWaterGoal(user.id, v)
    setDay((prev) => (prev ? { ...prev, goal: v } : prev))
    setGoalDraft(String(v))
    setGoalEdit(false)
  }

  const isFull = pct >= 100
  const dashOffset = C * (1 - pct / 100)

  const WD_SHORT_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
  const weekLabel = (d: string) => WD_SHORT_RU[(new Date(d + 'T00:00:00').getDay() + 6) % 7]

  const anchor = addDays(today, histOffset * 7)
  const histDays = Array.from({ length: 7 }, (_, i) => addDays(anchor, -6 + i))
  const shiftHist = (by: number) => setHistOffset((o) => o + by)

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('water.title')}</h1>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setViewMode(viewMode === 'today' ? 'history' : 'today')}
            className="cursor-pointer rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {viewMode === 'today' ? '📊' : '🕒'}
          </button>
          <button
            type="button"
            onClick={() => {
              setGoalEdit(!goalEdit)
              setGoalDraft(String(goal))
            }}
            className="cursor-pointer rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            ⚙️
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-neutral-500">{t('common.loading')}</p>
      ) : viewMode === 'history' ? (
        <div className={`${cardCls} flex flex-col gap-4`}>
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => shiftHist(-1)}
              className="cursor-pointer rounded px-2 py-1 text-sm transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              ‹
            </button>
            <span className="text-sm font-medium">
              {histDays[0]} – {histDays[6]}
            </span>
            <button
              type="button"
              onClick={() => shiftHist(1)}
              className="cursor-pointer rounded px-2 py-1 text-sm transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              ›
            </button>
          </div>
          <div className="flex items-end justify-between gap-2">
            {histDays.map((d) => {
              const ml = weekData[d] || 0
              const dayPct = goal > 0 ? Math.min(100, (ml / goal) * 100) : 0
              return (
                <div key={d} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-xs font-medium">{Math.round(dayPct)}%</span>
                  <div className="flex h-40 w-full flex-col justify-end overflow-hidden rounded-xl bg-neutral-100 dark:bg-neutral-800">
                    <div
                      className="w-full rounded-t-xl bg-sky-400 transition-all"
                      style={{
                        height: `${Math.max(ml > 0 ? 8 : 0, dayPct)}%`,
                      }}
                    />
                  </div>
                  <span className="text-[10px] text-neutral-400">{weekLabel(d)}</span>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <>
          <div className={`${cardCls} flex flex-col gap-3`}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
                {t('water.quickAdd')}
              </p>
              <span className="text-lg font-semibold text-sky-600 dark:text-sky-400">
                {selMl} ml
              </span>
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {QUICK_STEPS.map((ml) => (
                <button
                  key={ml}
                  type="button"
                  onClick={() => setSelMl(ml)}
                  className={`shrink-0 cursor-pointer rounded-xl px-4 py-2.5 text-sm font-medium transition ${
                    selMl === ml
                      ? 'bg-sky-500 text-white shadow-md'
                      : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300'
                  }`}
                >
                  {ml}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => quickAdd(selMl)}
              className="cursor-pointer rounded-xl bg-sky-500 py-3 text-sm font-semibold text-white transition hover:bg-sky-400 active:scale-[.97]"
            >
              +{selMl} ml
            </button>
          </div>

          <div className={`${cardCls} flex flex-col items-center gap-5`}>
            <div className="relative">
              <svg className="h-56 w-56 -rotate-90" viewBox="0 0 240 240">
                <defs>
                  <linearGradient id="waterGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#38bdf8" />
                    <stop offset="100%" stopColor="#2563eb" />
                  </linearGradient>
                </defs>
                <circle
                  cx="120"
                  cy="120"
                  r={R}
                  fill="none"
                  strokeWidth="14"
                  className="text-neutral-200 dark:text-neutral-800"
                  stroke="currentColor"
                />
                <circle
                  cx="120"
                  cy="120"
                  r={R}
                  fill="none"
                  strokeWidth="14"
                  strokeLinecap="round"
                  stroke="url(#waterGrad)"
                  strokeDasharray={C}
                  strokeDashoffset={dashOffset}
                  className="transition-[stroke-dashoffset] duration-700"
                />
              </svg>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <p className="text-4xl font-bold">{pct}%</p>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  {drunk} / {goal} ml
                </p>
                <p className="mt-1 text-xs text-neutral-400">
                  {left} ml {t('water.left')}
                </p>
              </div>
            </div>

            <div className="grid w-full grid-cols-3 gap-3 sm:grid-cols-4">
              {cupVolumes.map((cupMl, i) => {
                const fill = cupFills[i] ?? 0
                const filledMl = Math.round(fill * cupMl)
                const active = fill > 0
                return (
                  <button
                    key={`${cupMl}-${i}`}
                    type="button"
                    onClick={() => toggleGlass(i)}
                    className={`flex cursor-pointer flex-col items-center gap-1 rounded-2xl px-2 py-1 transition active:scale-[.97] ${
                      active ? 'opacity-100' : 'opacity-80 hover:opacity-100'
                    }`}
                  >
                    <span
                      className={`relative flex h-20 w-14 items-end overflow-hidden rounded-[18px] border-2 transition ${
                        active
                          ? 'border-sky-400 bg-sky-50 shadow-sm shadow-sky-200/70 dark:border-sky-500/70 dark:bg-sky-950/20'
                          : 'border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-950'
                      }`}
                    >
                      <span
                        className="absolute inset-x-1 bottom-1 rounded-[12px] bg-gradient-to-t from-sky-500 to-sky-300 transition-all duration-300"
                        style={{ height: fill > 0 ? `${Math.max(10, Math.round(fill * 100))}%` : '0%' }}
                      />
                      <span
                        className={`absolute inset-0 flex items-center justify-center text-[11px] font-semibold ${
                          fill > 0.55 ? 'text-white' : 'text-neutral-500 dark:text-neutral-300'
                        }`}
                      >
                        {filledMl}
                      </span>
                    </span>
                    <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
                      {cupMl} ml
                    </span>
                  </button>
                )
              })}
            </div>

            {isFull && (
              <p className="text-sm font-semibold text-sky-600 dark:text-sky-400">
                {t('water.goalReached')}
              </p>
            )}
          </div>

          {goalEdit && (
            <div className={`${cardCls} flex flex-col gap-2`}>
              <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
                🎯 {t('water.dailyGoal')}
              </p>
              <div className="flex gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  value={goalDraft}
                  onChange={(e) => setGoalDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      saveGoal()
                    }
                  }}
                  className="w-28 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-950"
                />
                <span className="self-center text-sm text-neutral-400">ml</span>
                <button
                  type="button"
                  onClick={saveGoal}
                  className="cursor-pointer rounded-lg bg-sky-400 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-sky-300"
                >
                  {t('common.save')}
                </button>
                <button
                  type="button"
                  onClick={() => setGoalEdit(false)}
                  className="cursor-pointer rounded-lg border border-neutral-300 px-3 py-1.5 text-sm transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          )}

          {day && day.logs.length > 0 && (
            <div className={`${cardCls} flex flex-col gap-2`}>
              <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
                {t('water.todayLogs')}
              </p>
              {day.logs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-center justify-between gap-3 rounded-lg bg-neutral-50 px-3 py-2 dark:bg-neutral-900/40"
                >
                  <span className="text-sm">+{log.amount} ml</span>
                  <button
                    type="button"
                    onClick={() => removeAmount(log.amount)}
                    className="cursor-pointer text-xs text-red-500 transition hover:text-red-400"
                  >
                    {t('common.delete')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
