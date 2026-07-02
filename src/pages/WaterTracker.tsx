import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useLang } from '../lib/i18n'
import { addDays, todayStr } from '../lib/planner'
import {
  loadWaterDay,
  saveWaterGoal,
  loadWaterPortion,
  saveWaterPortion,
  addWaterLog,
  removeWaterLog,
  loadWaterRange,
  type WaterDay,
  type WaterLog,
} from '../lib/water'
import Select from '../components/Select'
import TimePicker from '../components/TimePicker'
import {
  loadNotifSettings,
  saveNotifSettings,
  rescheduleAll,
  NOTIF_DEFAULTS,
  WATER_EVERY_OPTIONS,
  type NotifSettings,
} from '../lib/notifications'

const cardCls =
  'rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50'

const QUICK_STEPS = [150, 200, 250, 300, 350, 400, 450, 500, 550, 600]

const R = 100
const C = 2 * Math.PI * R

const WD_SHORT_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

const pad2 = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => `${y}-${pad2(m + 1)}-${pad2(d)}`
const dm = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}`

// Стакан с уровнем воды (по референсу Mi «Drink water»).
function GlassIcon({
  fill,
  active,
  plus,
}: {
  fill: number
  active: boolean
  plus?: boolean
}) {
  const uid = useId().replace(/[:]/g, '')
  const clip = `glass-${uid}`
  const grad = `glassg-${uid}`
  const top = 7
  const bottom = 45
  const level = Math.max(0, Math.min(1, fill))
  const waterTop = bottom - (bottom - top) * level
  const path = 'M10 7 L30 7 L27 43 Q27 45 25 45 L15 45 Q13 45 13 43 Z'
  return (
    <svg
      viewBox="0 0 40 50"
      className={`h-16 w-12 transition-colors ${
        active ? 'text-sky-400' : 'text-neutral-300 dark:text-neutral-600'
      }`}
    >
      <defs>
        <clipPath id={clip}>
          <path d={path} />
        </clipPath>
        <linearGradient id={grad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7dd3fc" />
          <stop offset="100%" stopColor="#2563eb" />
        </linearGradient>
      </defs>
      {level > 0 && (
        <rect
          x="6"
          y={waterTop}
          width="28"
          height={bottom - waterTop}
          fill={`url(#${grad})`}
          clipPath={`url(#${clip})`}
          className="transition-all duration-300"
        />
      )}
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {plus && (
        <text
          x="20"
          y="31"
          textAnchor="middle"
          fontSize="15"
          className="fill-sky-400 font-bold"
        >
          +
        </text>
      )}
    </svg>
  )
}

export default function WaterTracker() {
  const { user } = useAuth()
  const { t, lang } = useLang()
  const today = todayStr()

  const [day, setDay] = useState<WaterDay | null>(null)
  const [trend, setTrend] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [selMl, setSelMl] = useState(250)
  const [goalEdit, setGoalEdit] = useState(false)
  const [goalDraft, setGoalDraft] = useState('')
  // Настройки напоминаний пить воду (перенесены сюда из настроек планировщика).
  const [notif, setNotif] = useState<NotifSettings>(NOTIF_DEFAULTS)
  const [notifReady, setNotifReady] = useState(false)
  const [statMode, setStatMode] = useState<'week' | 'month'>('week')
  const [statOffset, setStatOffset] = useState(0)

  // Горизонтальный список порций: держим выбранную порцию по центру.
  const quickRef = useRef<HTMLDivElement>(null)
  const chipRefs = useRef<Map<number, HTMLButtonElement>>(new Map())
  useEffect(() => {
    const cont = quickRef.current
    const el = chipRefs.current.get(selMl)
    if (!cont || !el) return
    const target =
      cont.scrollLeft +
      el.getBoundingClientRect().left -
      cont.getBoundingClientRect().left -
      (cont.clientWidth - el.clientWidth) / 2
    cont.scrollTo({ left: Math.max(0, target), behavior: 'smooth' })
  }, [selMl, loading])

  // Загрузка дня (сегодня)
  useEffect(() => {
    if (!user) {
      setDay(null)
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    ;(async () => {
      try {
        const [d, portion] = await Promise.all([
          loadWaterDay(user.id, today),
          loadWaterPortion(user.id),
        ])
        if (!active) return
        setDay(d)
        setGoalDraft(String(d.goal))
        setSelMl(portion)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [user, today])

  // Загрузка настроек напоминаний воды (для модалки ⚙️).
  useEffect(() => {
    if (!user) return
    let active = true
    ;(async () => {
      try {
        const s = await loadNotifSettings(user.id)
        if (active) setNotif(s)
      } catch {
        // оставляем значения по умолчанию
      } finally {
        if (active) setNotifReady(true)
      }
    })()
    return () => {
      active = false
    }
  }, [user])

  const drunk = day?.drunk ?? 0
  const goal = day?.goal ?? 2000
  const pct = goal > 0 ? Math.min(100, Math.round((drunk / goal) * 100)) : 0
  const left = Math.max(0, goal - drunk)

  // Диапазон статистики (неделя или месяц) с учётом смещения
  const period = useMemo(() => {
    if (statMode === 'week') {
      const anchor = addDays(today, statOffset * 7)
      const ad = new Date(anchor + 'T00:00:00')
      const wd = (ad.getDay() + 6) % 7
      const start = addDays(anchor, -wd)
      const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
      return { start: days[0], end: days[6], days }
    }
    const base = new Date(today + 'T00:00:00')
    base.setDate(1)
    base.setMonth(base.getMonth() + statOffset)
    const y = base.getFullYear()
    const m = base.getMonth()
    const dim = new Date(y, m + 1, 0).getDate()
    const days = Array.from({ length: dim }, (_, i) => iso(y, m, i + 1))
    return { start: days[0], end: days[dim - 1], days }
  }, [statMode, statOffset, today])

  // Загрузка сумм по дням для выбранного диапазона
  useEffect(() => {
    if (!user) {
      setTrend({})
      return
    }
    let active = true
    ;(async () => {
      try {
        const r = await loadWaterRange(user.id, period.start, period.end)
        if (active) setTrend(r)
      } catch {
        /* ignore */
      }
    })()
    return () => {
      active = false
    }
  }, [user, period.start, period.end])

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

  const nextEmpty = cupFills.findIndex((f) => f < 0.999)

  const syncTrendToday = (total: number) =>
    setTrend((prev) => ({ ...prev, [today]: Math.max(0, total) }))

  // Точно выставляет итог за сегодня: убирает свежие логи и при нехватке добавляет один.
  const setTotal = async (target: number) => {
    if (!user || !day) return
    const tgt = Math.max(0, Math.round(target))
    const logs = [...day.logs]
    let current = day.drunk
    const removeIds: string[] = []
    while (current > tgt && logs.length > 0) {
      const l = logs.shift() as WaterLog
      removeIds.push(l.id)
      current -= l.amount
    }
    let newLogs = logs
    if (current < tgt) {
      const added = await addWaterLog(user.id, today, tgt - current)
      current = tgt
      newLogs = [added, ...newLogs]
    }
    for (const id of removeIds) {
      try {
        await removeWaterLog(user.id, id)
      } catch {
        /* ignore */
      }
    }
    setDay((prev) => (prev ? { ...prev, drunk: current, logs: newLogs } : prev))
    syncTrendToday(current)
  }

  // Кумулятивный тап: до этого бокала — наполнить, по полному — обнулить от него.
  const tapCup = async (idx: number) => {
    let through = 0
    for (let k = 0; k <= idx; k++) through += cupVolumes[k] ?? 0
    const before = through - (cupVolumes[idx] ?? 0)
    const target = drunk >= through ? before : through
    await setTotal(target)
  }

  const chooseMl = (ml: number) => {
    setSelMl(ml)
    if (user) void saveWaterPortion(user.id, ml)
  }

  // Сохраняем настройки уведомлений и сразу пересобираем расписание на устройстве.
  const updateNotif = async (patch: Partial<NotifSettings>) => {
    if (!user) return
    const next = { ...notif, ...patch }
    setNotif(next)
    try {
      await saveNotifSettings(user.id, next)
      await rescheduleAll(user.id)
    } catch {
      // на вебе расписание не создаётся — это нормально
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

  // Данные графика
  const statValues = period.days.map((d) => trend[d] ?? 0)
  const nonZero = statValues.filter((v) => v > 0)
  const avg = nonZero.length
    ? Math.round(nonZero.reduce((s, v) => s + v, 0) / nonZero.length)
    : 0
  const periodLabel =
    statMode === 'week'
      ? `${dm(period.start)} – ${dm(period.end)}`
      : `${period.start.slice(5, 7)}.${period.start.slice(0, 4)}`

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="sticky top-0 z-20 -mx-4 flex items-center justify-between border-b border-neutral-200/70 bg-white/85 px-4 py-3 backdrop-blur dark:border-neutral-800/70 dark:bg-neutral-950/85">
        <h1 className="text-2xl font-semibold">{t('water.title')}</h1>
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

      {loading ? (
        <p className="text-sm text-neutral-500">{t('common.loading')}</p>
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
            <div ref={quickRef} className="flex gap-1.5 overflow-x-auto pb-1">
              {QUICK_STEPS.map((ml) => (
                <button
                  key={ml}
                  ref={(el) => {
                    if (el) chipRefs.current.set(ml, el)
                    else chipRefs.current.delete(ml)
                  }}
                  type="button"
                  onClick={() => chooseMl(ml)}
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
                <span className="text-3xl">💧</span>
                <p className="text-3xl font-bold">{pct}%</p>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  {drunk} / {goal} ml
                </p>
                <p className="mt-1 text-xs text-neutral-400">
                  {left} ml {t('water.left')}
                </p>
              </div>
            </div>

            <div className="grid w-full grid-cols-4 gap-1 sm:grid-cols-5">
              {cupVolumes.map((cupMl, i) => {
                const fill = cupFills[i] ?? 0
                const active = fill > 0.001
                return (
                  <button
                    key={`${cupMl}-${i}`}
                    type="button"
                    onClick={() => tapCup(i)}
                    className="flex cursor-pointer flex-col items-center gap-0.5 rounded-2xl py-1 transition active:scale-90"
                  >
                    <GlassIcon fill={fill} active={active} plus={i === nextEmpty} />
                    <span className="text-[10px] font-medium text-neutral-400">
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
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
              onClick={() => setGoalEdit(false)}
            >
              <div
                className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
                onClick={(e) => e.stopPropagation()}
              >
                <p className="mb-3 text-base font-semibold">🎯 {t('water.dailyGoal')}</p>
                <div className="flex items-center gap-2">
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
                    className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-950"
                  />
                  <span className="text-sm text-neutral-400">ml</span>
                </div>

                {/* 💧 Напоминания пить воду (перенесено сюда из настроек планировщика). */}
                <div className="mt-5 border-t border-neutral-200 pt-4 dark:border-neutral-800">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold">
                      🔔 {lang === 'en' ? 'Water reminders' : 'Напоминания пить воду'}
                    </p>
                    <button
                      type="button"
                      onClick={() => updateNotif({ waterEnabled: !notif.waterEnabled })}
                      disabled={!user || !notifReady}
                      className={`shrink-0 cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${
                        notif.waterEnabled
                          ? 'bg-sky-500 text-white hover:bg-sky-400'
                          : 'border border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
                      }`}
                    >
                      {notif.waterEnabled ? t('set.on') : t('set.off')}
                    </button>
                  </div>
                  {notif.waterEnabled && (
                    <div className="mt-3 flex flex-col gap-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm text-neutral-600 dark:text-neutral-300">
                          {t('notif.every')}
                        </p>
                        <Select
                          className="w-fit"
                          value={String(notif.waterEveryHours)}
                          onChange={(v) => updateNotif({ waterEveryHours: Number(v) })}
                          options={WATER_EVERY_OPTIONS.map((h) => ({
                            value: String(h),
                            label: t('notif.hours', { n: String(h) }),
                          }))}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm text-neutral-600 dark:text-neutral-300">
                          {t('notif.from')}
                        </p>
                        <TimePicker
                          value={notif.waterFrom}
                          onChange={(v) => updateNotif({ waterFrom: v })}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm text-neutral-600 dark:text-neutral-300">
                          {t('notif.to')}
                        </p>
                        <TimePicker
                          value={notif.waterTo}
                          onChange={(v) => updateNotif({ waterTo: v })}
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setGoalEdit(false)}
                    className="cursor-pointer rounded-lg border border-neutral-300 px-3 py-1.5 text-sm transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={saveGoal}
                    className="cursor-pointer rounded-lg bg-sky-500 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-sky-400"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Статистика — всегда снизу */}
          <div className={`${cardCls} flex flex-col gap-4`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">📊 Статистика</p>
                <p className="text-xs text-neutral-400">
                  Сред. {avg} мл/день
                </p>
              </div>
              <div className="flex rounded-lg bg-neutral-100 p-0.5 text-xs font-medium dark:bg-neutral-800">
                {(['week', 'month'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setStatMode(m)
                      setStatOffset(0)
                    }}
                    className={`cursor-pointer rounded-md px-3 py-1 transition ${
                      statMode === m
                        ? 'bg-white text-sky-600 shadow-sm dark:bg-neutral-900 dark:text-sky-400'
                        : 'text-neutral-500'
                    }`}
                  >
                    {m === 'week' ? 'Неделя' : 'Месяц'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-neutral-400">
              <button
                type="button"
                onClick={() => setStatOffset((o) => o - 1)}
                className="cursor-pointer rounded px-2 py-1 transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                ‹
              </button>
              <span className="font-medium text-neutral-500 dark:text-neutral-300">
                {periodLabel}
              </span>
              <button
                type="button"
                disabled={statOffset >= 0}
                onClick={() => setStatOffset((o) => Math.min(0, o + 1))}
                className="cursor-pointer rounded px-2 py-1 transition hover:bg-neutral-100 disabled:opacity-30 dark:hover:bg-neutral-800"
              >
                ›
              </button>
            </div>

            <div className="flex flex-col gap-1">
              <div className="relative flex h-40 items-end gap-1">
                <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-sky-400/40" />
                {avg > 0 && goal > 0 && (
                  <div
                    className="pointer-events-none absolute inset-x-0 border-t border-dashed border-emerald-400/60"
                    style={{ bottom: `${Math.min(100, (avg / goal) * 100)}%` }}
                  />
                )}
                {period.days.map((d, i) => {
                  const v = statValues[i]
                  const hp = goal > 0 ? Math.min(100, (v / goal) * 100) : 0
                  const isToday = d === today
                  return (
                    <div
                      key={d}
                      className="flex h-full flex-1 items-end"
                      title={`${dm(d)}: ${v} ml`}
                    >
                      <div
                        className={`w-full rounded-t transition-all ${
                          isToday
                            ? 'bg-gradient-to-t from-sky-600 to-sky-400'
                            : v > 0
                              ? 'bg-sky-300 dark:bg-sky-500/70'
                              : 'bg-neutral-100 dark:bg-neutral-800'
                        }`}
                        style={{ height: `${v > 0 ? Math.max(4, hp) : 2}%` }}
                      />
                    </div>
                  )
                })}
              </div>
              <div className="flex gap-1">
                {period.days.map((d) => {
                  const dayNum = Number(d.slice(8, 10))
                  const label =
                    statMode === 'week'
                      ? WD_SHORT_RU[(new Date(d + 'T00:00:00').getDay() + 6) % 7]
                      : dayNum === 1 || dayNum % 5 === 0
                        ? String(dayNum)
                        : ''
                  return (
                    <span
                      key={d}
                      className="flex-1 text-center text-[9px] text-neutral-400"
                    >
                      {label}
                    </span>
                  )
                })}
              </div>
            </div>

            <div className="flex items-center justify-center gap-4 text-[11px] text-neutral-400">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-sky-400" /> Выпито
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-3 border-t border-dashed border-emerald-400" /> Среднее
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-3 border-t border-dashed border-sky-400" /> Цель
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
