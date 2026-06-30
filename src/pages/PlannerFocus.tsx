import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useLang } from '../lib/i18n'
import Select from '../components/Select'
import {
  loadDay,
  loadPomoSettings,
  savePomoSettings,
  logPomodoro,
  loadPomoToday,
  todayStr,
  POMO_DEFAULTS,
  type PlannerItem,
  type PomoSettings,
  type PomoKind,
} from '../lib/planner'

// Экран «Фокус» (П-7): таймер Помодоро 25/5 с длинным перерывом.
//   Большое кольцо прогресса + крупное время. Три фазы: фокус / перерыв /
//   длинный перерыв (каждые N фокусов). Старт/Пауза/Сброс/Пропустить.
//   Можно привязать сессию к делу из «Сегодня». Завершённые фокусы пишутся
//   в pomodoro_sessions, настройки длительностей — в app_settings.

const cardCls =
  'rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50'
const inputCls =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950'
const btnGhost =
  'rounded-xl border border-neutral-300 px-4 py-2.5 text-sm transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'

// Цвет кольца по фазе.
const ringColor = (m: PomoKind): string =>
  m === 'focus' ? 'text-emerald-500' : m === 'break' ? 'text-sky-500' : 'text-violet-500'

const mmss = (sec: number): string => {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

const clamp = (n: number, lo: number, hi: number): number =>
  Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : lo

// Доступные сигналы окончания фазы (id должны совпадать с ключами i18n focus.sound_*).
const POMO_SOUNDS = ['chime', 'bell', 'double'] as const
type PomoSound = (typeof POMO_SOUNDS)[number]

type ToneSpec = { freq: number; start: number; dur: number; type?: OscillatorType; gain?: number }

// Каждый сигнал — набор коротких тонов (чистый синтез через Web Audio, без файлов).
// 'notification' — несколько «пиков» подряд, как пачка уведомлений на телефоне.
const SOUND_SPECS: Record<PomoSound, ToneSpec[]> = {
  chime: [
    { freq: 523, start: 0, dur: 0.55, gain: 1.7 },
    { freq: 659, start: 0.2, dur: 0.55, gain: 1.7 },
    { freq: 784, start: 0.4, dur: 0.8, gain: 1.7 },
  ],
  bell: [
    { freq: 1046, start: 0, dur: 1.4, gain: 1.2 },
    { freq: 1568, start: 0, dur: 1.4, gain: 1.2 },
  ],
  double: [
    { freq: 880, start: 0, dur: 0.25, gain: 1.7 },
    { freq: 1175, start: 0.28, dur: 0.35, gain: 1.7 },
  ],
}

// Проигрывает выбранный сигнал с заданной громкостью (0-100) через Web Audio.
function playPomoSound(sound: string, volume: number) {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const vol = Math.max(0, Math.min(1, volume / 100))
    if (vol <= 0) return
    const ac = new Ctx()
    const specs = SOUND_SPECS[(sound as PomoSound)] ?? SOUND_SPECS.double
    let end = 0
    for (const n of specs) {
      const o = ac.createOscillator()
      const g = ac.createGain()
      o.connect(g)
      g.connect(ac.destination)
      o.type = n.type ?? 'sine'
      o.frequency.value = n.freq
      const t0 = ac.currentTime + n.start
      const peak = Math.max(0.0005, Math.min(1, 0.75 * (n.gain ?? 1) * vol))
      g.gain.setValueAtTime(0.0001, t0)
      g.gain.exponentialRampToValueAtTime(peak, t0 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.dur)
      o.start(t0)
      o.stop(t0 + n.dur + 0.03)
      end = Math.max(end, n.start + n.dur)
    }
    window.setTimeout(() => ac.close(), (end + 0.4) * 1000)
  } catch {
    // звук недоступен — не критично
  }
}

export default function PlannerFocus() {
  const { user } = useAuth()
  const { t } = useLang()

  const [settings, setSettings] = useState<PomoSettings>(POMO_DEFAULTS)
  const [mode, setMode] = useState<PomoKind>('focus')
  const [running, setRunning] = useState(false)
  const [remaining, setRemaining] = useState(POMO_DEFAULTS.focusMin * 60)
  const [focusDone, setFocusDone] = useState(0)
  const [focusMinToday, setFocusMinToday] = useState(0)
  const [items, setItems] = useState<PlannerItem[]>([])
  const [itemId, setItemId] = useState<string>('')
  const [showSettings, setShowSettings] = useState(false)
  const [draft, setDraft] = useState<PomoSettings>(POMO_DEFAULTS)
  const [ready, setReady] = useState(false)

  const endRef = useRef<number | null>(null)
  const completeRef = useRef<() => void>(() => {})

  const durMin = (m: PomoKind, s: PomoSettings = settings): number =>
    m === 'focus' ? s.focusMin : m === 'break' ? s.breakMin : s.longBreakMin

  // Начальная загрузка: настройки, дела на сегодня, статистика фокуса.
  useEffect(() => {
    if (!user) return
    let active = true
    ;(async () => {
      try {
        const [s, day, today] = await Promise.all([
          loadPomoSettings(user.id),
          loadDay(user.id, todayStr()),
          loadPomoToday(user.id),
        ])
        if (!active) return
        setSettings(s)
        setDraft(s)
        setRemaining(s.focusMin * 60)
        setItems(day.items)
        setFocusDone(today.focusCount)
        setFocusMinToday(today.focusMin)
      } catch {
        // оставляем значения по умолчанию
      } finally {
        if (active) setReady(true)
      }
    })()
    return () => {
      active = false
    }
  }, [user])

  // Логика завершения фазы (через ref, чтобы тик всегда видел свежее состояние).
  completeRef.current = () => {
    setRunning(false)
    endRef.current = null
    playPomoSound(settings.sound, settings.volume)
    if (mode === 'focus') {
      const mins = settings.focusMin
      if (user) {
        logPomodoro(user.id, {
          kind: 'focus',
          durationMin: mins,
          itemId: itemId || null,
          completed: true,
        }).catch(() => {})
      }
      const done = focusDone + 1
      setFocusDone(done)
      setFocusMinToday((v) => v + mins)
      const next: PomoKind = done % settings.cycles === 0 ? 'long_break' : 'break'
      setMode(next)
      setRemaining(durMin(next) * 60)
    } else {
      if (user) {
        logPomodoro(user.id, {
          kind: mode,
          durationMin: durMin(mode),
          itemId: null,
          completed: true,
        }).catch(() => {})
      }
      setMode('focus')
      setRemaining(settings.focusMin * 60)
    }
  }

  // Тик таймера: считаем от целевого времени, чтобы не плыло в фоне.
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => {
      if (endRef.current == null) return
      const left = Math.round((endRef.current - Date.now()) / 1000)
      if (left <= 0) {
        setRemaining(0)
        completeRef.current()
      } else {
        setRemaining(left)
      }
    }, 250)
    return () => window.clearInterval(id)
  }, [running])

  const start = () => {
    const base = remaining > 0 ? remaining : durMin(mode) * 60
    setRemaining(base)
    endRef.current = Date.now() + base * 1000
    setRunning(true)
  }
  const pause = () => {
    setRunning(false)
    endRef.current = null
  }
  const reset = () => {
    setRunning(false)
    endRef.current = null
    setRemaining(durMin(mode) * 60)
  }
  const switchMode = (m: PomoKind) => {
    setRunning(false)
    endRef.current = null
    setMode(m)
    setRemaining(durMin(m) * 60)
  }
  const skip = () => {
    if (mode === 'focus') switchMode('break')
    else switchMode('focus')
  }

  const saveSettings = async () => {
    const sound = (POMO_SOUNDS as readonly string[]).includes(draft.sound)
      ? draft.sound
      : 'double'
    const clean: PomoSettings = {
      focusMin: clamp(draft.focusMin, 1, 180),
      breakMin: clamp(draft.breakMin, 1, 60),
      longBreakMin: clamp(draft.longBreakMin, 1, 90),
      cycles: clamp(draft.cycles, 1, 12),
      sound,
      volume: clamp(draft.volume, 0, 100),
    }
    setSettings(clean)
    setDraft(clean)
    setShowSettings(false)
    if (!running) {
      setRemaining(durMin(mode, clean) * 60)
    }
    if (user) await savePomoSettings(user.id, clean).catch(() => {})
  }

  // ===== Разметка =====
  const total = durMin(mode) * 60
  const frac = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0
  const R = 120
  const C = 2 * Math.PI * R
  const offset = C * (1 - frac)

  const phaseLabel =
    mode === 'focus' ? t('focus.focus') : mode === 'break' ? t('focus.break') : t('focus.longBreak')
  const hint = running
    ? mode === 'focus'
      ? t('focus.inFocus')
      : t('focus.inBreak')
    : mode === 'focus'
      ? t('focus.readyFocus')
      : mode === 'break'
        ? t('focus.readyBreak')
        : t('focus.readyLong')

  const cycleNow = (focusDone % settings.cycles) + 1
  const filledDots = focusDone % settings.cycles

  const taskOptions = [
    { value: '', label: t('focus.noTask') },
    ...items.map((it) => ({
      value: it.id,
      label: `${it.icon ? it.icon + ' ' : ''}${it.title}`,
    })),
  ]

  const tabCls = (active: boolean): string =>
    `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
      active
        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
        : 'text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800'
    }`

  if (!ready) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">🍅 {t('pnav.focus')}</h1>
        <div className={`${cardCls} text-sm text-neutral-500 dark:text-neutral-400`}>
          {t('common.loading')}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">🍅 {t('pnav.focus')}</h1>
        <button
          type="button"
          onClick={() => {
            setDraft(settings)
            setShowSettings((v) => !v)
          }}
          className={btnGhost}
          title={t('focus.settings')}
        >
          ⚙️
        </button>
      </div>

      {/* Переключатель фаз */}
      <div className="flex justify-center">
        <div className="inline-flex gap-1 rounded-xl border border-neutral-200 bg-white p-1 dark:border-neutral-800 dark:bg-neutral-900/50">
          <button type="button" className={tabCls(mode === 'focus')} onClick={() => switchMode('focus')}>
            {t('focus.focus')}
          </button>
          <button type="button" className={tabCls(mode === 'break')} onClick={() => switchMode('break')}>
            {t('focus.break')}
          </button>
          <button
            type="button"
            className={tabCls(mode === 'long_break')}
            onClick={() => switchMode('long_break')}
          >
            {t('focus.longBreak')}
          </button>
        </div>
      </div>

      {/* Кольцо таймера */}
      <div className={`${cardCls} flex flex-col items-center gap-4`}>
        <div className="relative h-72 w-72">
          <svg className="h-full w-full -rotate-90" viewBox="0 0 280 280">
            <circle
              cx="140"
              cy="140"
              r={R}
              fill="none"
              strokeWidth="14"
              className="text-neutral-200 dark:text-neutral-800"
              stroke="currentColor"
            />
            <circle
              cx="140"
              cy="140"
              r={R}
              fill="none"
              strokeWidth="14"
              strokeLinecap="round"
              className={`${ringColor(mode)} transition-[stroke-dashoffset] duration-300`}
              stroke="currentColor"
              strokeDasharray={C}
              strokeDashoffset={offset}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-xs uppercase tracking-wide text-neutral-400">{phaseLabel}</div>
            <div className="text-6xl font-bold tabular-nums">{mmss(remaining)}</div>
            <div className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              {t('focus.cycleDots', { n: cycleNow, m: settings.cycles })}
            </div>
          </div>
        </div>

        {/* Точки циклов */}
        <div className="flex items-center gap-2">
          {Array.from({ length: settings.cycles }).map((_, i) => (
            <span
              key={i}
              className={`h-2.5 w-2.5 rounded-full ${
                i < filledDots ? 'bg-emerald-500' : 'bg-neutral-300 dark:bg-neutral-700'
              }`}
            />
          ))}
        </div>

        <p className="text-center text-sm text-neutral-500 dark:text-neutral-400">{hint}</p>

        {/* Управление */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          {running ? (
            <button
              type="button"
              onClick={pause}
              className="rounded-xl bg-emerald-500 px-8 py-3 text-base font-semibold text-white transition hover:bg-emerald-600"
            >
              {t('focus.pause')}
            </button>
          ) : (
            <button
              type="button"
              onClick={start}
              className="rounded-xl bg-emerald-500 px-8 py-3 text-base font-semibold text-white transition hover:bg-emerald-600"
            >
              {remaining < total ? t('focus.resume') : t('focus.start')}
            </button>
          )}
          <button type="button" onClick={reset} className={btnGhost}>
            {t('focus.reset')}
          </button>
          <button type="button" onClick={skip} className={btnGhost}>
            {t('focus.skip')}
          </button>
        </div>
      </div>

      {/* Дело, на котором фокус */}
      <div className={`${cardCls} flex flex-col gap-2`}>
        <div className="text-sm font-medium">{t('focus.taskLabel')}</div>
        <Select value={itemId} options={taskOptions} onChange={(v) => setItemId(v)} />
      </div>

      {/* Статистика за сегодня */}
      <div className={`${cardCls} flex items-center justify-between`}>
        <span className="text-sm text-neutral-500 dark:text-neutral-400">{t('focus.today')}</span>
        <span className="text-sm font-semibold">
          🍅 {focusDone} · {t('focus.todayMin', { n: focusMinToday })}
        </span>
      </div>

      {/* Настройки таймера */}
      {showSettings && (
        <div className={`${cardCls} flex flex-col gap-3`}>
          <div className="text-sm font-medium">{t('focus.settings')}</div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs text-neutral-500 dark:text-neutral-400">
              {t('focus.focusMin')}
              <input
                type="number"
                min={1}
                className={inputCls}
                value={draft.focusMin}
                onChange={(e) => setDraft({ ...draft, focusMin: Number(e.target.value) })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-neutral-500 dark:text-neutral-400">
              {t('focus.breakMin')}
              <input
                type="number"
                min={1}
                className={inputCls}
                value={draft.breakMin}
                onChange={(e) => setDraft({ ...draft, breakMin: Number(e.target.value) })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-neutral-500 dark:text-neutral-400">
              {t('focus.longBreakMin')}
              <input
                type="number"
                min={1}
                className={inputCls}
                value={draft.longBreakMin}
                onChange={(e) => setDraft({ ...draft, longBreakMin: Number(e.target.value) })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-neutral-500 dark:text-neutral-400">
              {t('focus.cycles')}
              <input
                type="number"
                min={1}
                className={inputCls}
                value={draft.cycles}
                onChange={(e) => setDraft({ ...draft, cycles: Number(e.target.value) })}
              />
            </label>
          </div>

          {/* Звук сигнала + громкость */}
          <div className="flex flex-col gap-2">
            <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
              {t('focus.sound')}
            </div>
            <div className="flex flex-col gap-1.5">
              {POMO_SOUNDS.map((s) => (
                <div
                  key={s}
                  className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                    draft.sound === s
                      ? 'border-emerald-500 bg-emerald-500/10'
                      : 'border-neutral-300 dark:border-neutral-700'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setDraft({ ...draft, sound: s })}
                    className="flex flex-1 items-center gap-2 text-left"
                  >
                    <span>{draft.sound === s ? '🔘' : '⚪'}</span>
                    {t(`focus.sound_${s}`)}
                  </button>
                  <button
                    type="button"
                    onClick={() => playPomoSound(s, draft.volume)}
                    className="rounded-lg border border-neutral-300 px-2.5 py-1 text-xs transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                    title={t('focus.preview')}
                  >
                    ▶
                  </button>
                </div>
              ))}
            </div>
            <label className="mt-1 flex flex-col gap-1 text-xs text-neutral-500 dark:text-neutral-400">
              {t('focus.volume')}: {draft.volume}%
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={draft.volume}
                onChange={(e) => setDraft({ ...draft, volume: Number(e.target.value) })}
                onMouseUp={() => playPomoSound(draft.sound, draft.volume)}
                onTouchEnd={() => playPomoSound(draft.sound, draft.volume)}
                className="w-full accent-emerald-500"
              />
            </label>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowSettings(false)} className={btnGhost}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={saveSettings}
              className="rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-600"
            >
              {t('common.save')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
