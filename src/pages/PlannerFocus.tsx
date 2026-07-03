import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useLang } from '../lib/i18n'
import Select from '../components/Select'
import { showToast } from '../lib/toast'
import { enableFocusDnd, disableFocusDnd, dndHasPermission, openDndSettings } from '../lib/dnd'
import { showFocusNotification, hideFocusNotification, focusNotifyAvailable } from '../lib/focusNotify'
import {
  loadDay,
  loadPomoSettings,
  loadPomoSettingsCache,
  savePomoSettings,
  logPomodoro,
  loadPomoToday,
  todayStr,
  type PlannerItem,
  type PomoSettings,
  type PomoKind,
} from '../lib/planner'

// Экран «Фокус» (П-7 + редизайн П-10): Помодоро в стиле GoodTime.
//   Без вкладок и кнопок: нажатие на время = старт/пауза, управление жестами.
//   Тянешь от центра — появляется круглый «пульт» с 4 секторами: вверх ＋ (+1
//   минута), вправо › (вперёд/следующая фаза), влево ‹ (назад), вниз ✕ (стоп).
//   Отпускаешь на секторе — действие. Фазы (фокус/перерыв/длинный перерыв)
//   переключаются автоматически и жестами.

const cardCls =
  'rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50'
const inputCls =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950'
const btnGhost =
  'rounded-xl border border-neutral-300 px-4 py-2.5 text-sm transition hover:bg-neutral-100 active:scale-[.97] dark:border-neutral-700 dark:hover:bg-neutral-800'

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

type Dir = 'add' | 'skip' | 'back' | 'stop' | null
const PHASE_ORDER: PomoKind[] = ['focus', 'break', 'long_break']
const DEADZONE = 26
const DIAL_R = 78

export default function PlannerFocus() {
  const { user } = useAuth()
  const { t, lang } = useLang()

  // Кэш настроек таймера: экран «Фокус» открывается мгновенно и работает
  // офлайн — сразу показываем сохранённые настройки, сеть обновит их в фоне.
  const [settings, setSettings] = useState<PomoSettings>(() => loadPomoSettingsCache())
  const [mode, setMode] = useState<PomoKind>('focus')
  const [running, setRunning] = useState(false)
  const [remaining, setRemaining] = useState(() => loadPomoSettingsCache().focusMin * 60)
  const [focusDone, setFocusDone] = useState(0)
  const [focusMinToday, setFocusMinToday] = useState(0)
  const [items, setItems] = useState<PlannerItem[]>([])
  const [itemId, setItemId] = useState<string>('')
  const [showSettings, setShowSettings] = useState(false)
  const [draft, setDraft] = useState<PomoSettings>(() => loadPomoSettingsCache())
  // Экран доступен сразу (без спиннера ожидания сети): таймер по кэшу, а свежие
  // данные подгружаются в фоне.
  const [ready, setReady] = useState(true)
  const [pressed, setPressed] = useState(false)

  // Жестовый «пульт».
  const [dial, setDial] = useState<{ active: boolean; dx: number; dy: number; dir: Dir }>({
    active: false,
    dx: 0,
    dy: 0,
    dir: null,
  })
  const startRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const pressedRef = useRef(false)
  // Таймер, удерживающий анимацию нажатия видимой хотя бы ~160 мс даже при
  // быстром тапе (иначе scale возвращается мгновенно и анимации не видно).
  const pressTimer = useRef<number | null>(null)
  const dialRef = useRef<{ active: boolean; dx: number; dy: number; dir: Dir }>({
    active: false,
    dx: 0,
    dy: 0,
    dir: null,
  })

  const endRef = useRef<number | null>(null)
  const completeRef = useRef<() => void>(() => {})

  const durMin = (m: PomoKind, s: PomoSettings = settings): number =>
    m === 'focus' ? s.focusMin : m === 'break' ? s.breakMin : s.longBreakMin

  // Подпись постоянного уведомления таймера: показываем задачу, на которой
  // сейчас фокус (вместо старой подсказки «нажми, чтобы открыть»). Если задача
  // не выбрана — мягкая подсказка открыть экран.
  const focusNotifBody = (): string => {
    const it = items.find((i) => i.id === itemId)
    if (it) return `${it.icon ? it.icon + ' ' : ''}${it.title}`
    return lang === 'ru' ? 'Нажми, чтобы открыть' : 'Tap to open'
  }

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
        setItems(day.items)
        setFocusDone(today.focusCount)
        setFocusMinToday(today.focusMin)
        // Обновляем оставшееся время из настроек только если таймер ещё не
        // запускали — чтобы не затирать идущий/приостановленный отсчёт.
        if (endRef.current == null && !running) {
          setRemaining(s.focusMin * 60)
        }
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

  // Очистка таймера анимации нажатия при размонтировании.
  useEffect(() => {
    return () => {
      if (pressTimer.current) window.clearTimeout(pressTimer.current)
    }
  }, [])

  // ===== Тихий режим (DND) во время фокуса =====
  // Пока таймер идёт — на телефоне включаем режим «только звонки»: обычные
  // уведомления и звуки не шумят, звонки слышны. По паузе/остановке/выходу —
  // возвращаем звук. Работает только в приложении (Android); в браузере ничего
  // не делает. Требуется разовое разрешение «Доступ к режиму Не беспокоить».
  const dndPromptedRef = useRef(false)
  useEffect(() => {
    let cancelled = false
    if (running) {
      ;(async () => {
        const ok = await enableFocusDnd()
        if (!ok && !cancelled && !dndPromptedRef.current) {
          const granted = await dndHasPermission()
          if (!granted && !cancelled) {
            dndPromptedRef.current = true
            showToast(
              lang === 'ru'
                ? 'Разреши «Доступ к режиму Не беспокоить», чтобы во время фокуса всё, кроме звонков, было беззвучно'
                : 'Allow "Do Not Disturb access" so everything except calls stays silent during focus',
            )
            await openDndSettings()
          }
        }
      })()
    } else {
      void disableFocusDnd()
    }
    return () => {
      cancelled = true
    }
  }, [running, lang])

  // ===== Постоянное уведомление о состоянии Помодоро (Android) =====
  // Пока идёт таймер — показываем несмахиваемое уведомление с названием фазы и
  // живым обратным отсчётом времени справа (как в GoodTime). Работает в фоне
  // благодаря нативному foreground-сервису. На паузе — «Пауза», при остановке
  // или уходе с экрана — убираем. Только в приложении (в браузере нет).
  // Ref со свежим значением running — нужен в очистке при размонтировании
  // (у эффекта очистки пустой список зависимостей и он не видит актуальный state).
  const runningRef = useRef(false)
  useEffect(() => {
    runningRef.current = running
  }, [running])

  // Было ли уведомление реально показано. Нужно, чтобы при первом заходе на
  // экран (таймер ещё не запускали) НЕ дёргать сервис вызовом stop зря — иначе
  // foreground-сервис стартует и тут же гасится, что и роняло приложение.
  const notifShownRef = useRef(false)
  useEffect(() => {
    if (!focusNotifyAvailable()) return
    const label =
      mode === 'focus' ? t('focus.focus') : mode === 'break' ? t('focus.break') : t('focus.longBreak')
    if (running && endRef.current != null) {
      notifShownRef.current = true
      void showFocusNotification({
        title: label,
        body: focusNotifBody(),
        remainingSec: Math.max(0, Math.round((endRef.current - Date.now()) / 1000)),
        running: true,
      })
    } else if (remaining > 0 && remaining < durMin(mode) * 60) {
      notifShownRef.current = true
      const it = items.find((i) => i.id === itemId)
      const task = it ? `${it.icon ? it.icon + ' ' : ''}${it.title}` : ''
      void showFocusNotification({
        title: label,
        body: (lang === 'ru' ? 'Пауза' : 'Paused') + (task ? ` · ${task}` : ''),
        remainingSec: 0,
        running: false,
      })
    } else if (notifShownRef.current) {
      notifShownRef.current = false
      void hideFocusNotification()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, mode, lang, itemId, items])

  // Уход с экрана «Фокус». Если таймер ИДЁТ — оставляем тихий режим и
  // уведомление активными, чтобы фокус продолжался в фоне (при переходе на
  // другие вкладки и в другие приложения). Если таймер не идёт — возвращаем
  // обычный звук и убираем уведомление.
  useEffect(() => {
    return () => {
      if (!runningRef.current) {
        void disableFocusDnd()
        void hideFocusNotification()
      }
    }
  }, [])

  // Логика завершения фазы (через ref, чтобы тик всегда видел свежие значения).
  completeRef.current = () => {
    setRunning(false)
    endRef.current = null
    playPomoSound(settings.sound, settings.volume)
    if (mode === 'focus') {
      const elapsedSec = Math.max(0, total - remaining)
      const mins = Math.round(elapsedSec / 60)
      if (user && mins > 0) {
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
      const breakElapsed = Math.max(0, total - remaining)
      const breakMins = Math.round(breakElapsed / 60)
      if (user && breakMins > 0) {
        logPomodoro(user.id, {
          kind: mode,
          durationMin: breakMins,
          itemId: null,
          completed: true,
        }).catch(() => {})
      }
      setMode('focus')
      setRemaining(settings.focusMin * 60)
    }
  }

  // Тик таймера.
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
    // Показываем уведомление сразу в обработчике нажатия, не дожидаясь
    // ре-рендера и эффекта — плашка таймера появляется мгновенно по тапу.
    if (focusNotifyAvailable()) {
      const label =
        mode === 'focus'
          ? t('focus.focus')
          : mode === 'break'
            ? t('focus.break')
            : t('focus.longBreak')
      notifShownRef.current = true
      void showFocusNotification({
        title: label,
        body: focusNotifBody(),
        remainingSec: base,
        running: true,
      })
    }
  }
  const pause = () => {
    setRunning(false)
    endRef.current = null
  }
  const switchMode = (m: PomoKind) => {
    setRunning(false)
    endRef.current = null
    setMode(m)
    setRemaining(durMin(m) * 60)
  }

  // ===== Жесты =====
  const cyclePhase = (delta: number) => {
    const i = PHASE_ORDER.indexOf(mode)
    const nextMode = PHASE_ORDER[(i + delta + PHASE_ORDER.length) % PHASE_ORDER.length]
    switchMode(nextMode)
  }
  const addMinute = () => {
    setRemaining((r) => r + 60)
    if (running && endRef.current != null) {
      endRef.current += 60000
      if (focusNotifyAvailable()) {
        const label =
          mode === 'focus' ? t('focus.focus') : mode === 'break' ? t('focus.break') : t('focus.longBreak')
        void showFocusNotification({
          title: label,
          body: focusNotifBody(),
          remainingSec: Math.max(0, Math.round((endRef.current - Date.now()) / 1000)),
          running: true,
        })
      }
    }
  }
  const stopAll = () => {
    setRunning(false)
    endRef.current = null
    setMode('focus')
    setRemaining(settings.focusMin * 60)
  }

  const dirFrom = (dx: number, dy: number): Dir => {
    if (Math.hypot(dx, dy) < DEADZONE) return null
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'skip' : 'back'
    return dy > 0 ? 'stop' : 'add'
  }

  // Тап/жест засчитываем только если он начался внутри круга кольца, а не по углам квадрата.
  const insideRing = (e: React.PointerEvent): boolean => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    return Math.hypot(e.clientX - cx, e.clientY - cy) <= (r.width / 2) * 0.92
  }

  const onDialDown = (e: React.PointerEvent) => {
    if (!insideRing(e)) return
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // noop
    }
    startRef.current = { x: e.clientX, y: e.clientY }
    pressedRef.current = true
    if (pressTimer.current) window.clearTimeout(pressTimer.current)
    setPressed(true)
    // Do NOT show the dial on press - only after a drag past deadzone.
    const next = { active: false, dx: 0, dy: 0, dir: null as Dir }
    dialRef.current = next
    setDial(next)
  }
  const onDialMove = (e: React.PointerEvent) => {
    // Only process move when the pointer is actually pressed (mouse drag or touch).
    if (!pressedRef.current) return
    const dx = e.clientX - startRef.current.x
    const dy = e.clientY - startRef.current.y
    // Only show the dial once the pointer moves beyond the deadzone.
    if (Math.hypot(dx, dy) < DEADZONE) return
    const next = { active: true, dx, dy, dir: dirFrom(dx, dy) }
    dialRef.current = next
    setDial(next)
  }
  const onDialUp = (e: React.PointerEvent) => {
    const wasPressed = pressedRef.current
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      // noop
    }
    pressedRef.current = false
    if (pressTimer.current) window.clearTimeout(pressTimer.current)
    pressTimer.current = window.setTimeout(() => setPressed(false), 160)
    const d = dialRef.current
    const cleared = { active: false, dx: 0, dy: 0, dir: null as Dir }
    dialRef.current = cleared
    setDial(cleared)
    // Нажатие началось вне круга — игнорируем (ни тап, ни жест).
    if (!wasPressed) return
    // If dial was shown (dragged past deadzone), perform the directional action.
    if (d.active) {
      if (d.dir === 'add') addMinute()
      else if (d.dir === 'skip') cyclePhase(1)
      else if (d.dir === 'back') cyclePhase(-1)
      else if (d.dir === 'stop') stopAll()
      return
    }
    // Otherwise it was a tap (no drag past deadzone) = toggle start/pause.
    if (running) pause()
    else start()
  }
  const onDialCancel = () => {
    pressedRef.current = false
    if (pressTimer.current) window.clearTimeout(pressTimer.current)
    pressTimer.current = window.setTimeout(() => setPressed(false), 160)
    const cleared = { active: false, dx: 0, dy: 0, dir: null as Dir }
    dialRef.current = cleared
    setDial(cleared)
  }

  const saveSettings = async () => {
    const sound = (POMO_SOUNDS as readonly string[]).includes(draft.sound) ? draft.sound : 'double'
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

  const cycleNow = (focusDone % settings.cycles) + 1
  const filledDots = focusDone % settings.cycles

  const taskOptions = [
    { value: '', label: t('focus.noTask') },
    ...items.map((it) => ({
      value: it.id,
      label: `${it.icon ? it.icon + ' ' : ''}${it.title}`,
    })),
  ]

  const dist = Math.hypot(dial.dx, dial.dy)
  const kf = dist > DIAL_R && dist > 0 ? DIAL_R / dist : 1
  const knobStyle: React.CSSProperties = {
    transform: `translate(calc(-50% + ${Math.round(dial.dx * kf)}px), calc(-50% + ${Math.round(
      dial.dy * kf,
    )}px))`,
  }
  // Анимация нажатия применяется только к кругу (не во время жеста-«пульта»).
  const dialPressStyle: React.CSSProperties = {
    transform: pressed && !dial.active ? 'scale(0.93)' : undefined,
  }
  const segCls = (dir: Dir): string =>
    `absolute flex flex-col items-center gap-0.5 text-2xl font-bold leading-none transition ${
      dial.dir === dir
        ? 'text-emerald-600 dark:text-emerald-300'
        : 'text-neutral-400 dark:text-neutral-500'
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
      <div className="sticky top-0 z-20 -mx-4 flex items-center justify-between gap-2 border-b border-neutral-200/70 bg-white/85 px-4 py-3 backdrop-blur dark:border-neutral-800/70 dark:bg-neutral-950/85">
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

      {/* Кольцо таймера с жестовым управлением */}
      <div className={`${cardCls} flex flex-col items-center gap-4`}>
        <div
          className="relative mx-auto h-72 w-72 cursor-pointer touch-none select-none transition-transform duration-150"
          style={dialPressStyle}
          role="button"
          tabIndex={0}
          aria-label={t('focus.tapHint')}
          onPointerDown={onDialDown}
          onPointerMove={onDialMove}
          onPointerUp={onDialUp}
          onPointerCancel={onDialCancel}
        >
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
          <div
            className={`pointer-events-none absolute inset-0 flex flex-col items-center justify-center ${
              !running && remaining > 0 && remaining < durMin(mode) * 60
                ? 'animate-timer-pulse'
                : ''
            }`}
          >
            <div className="text-xs uppercase tracking-wide text-neutral-400">{phaseLabel}</div>
            <div className="text-6xl font-bold tabular-nums transition-transform duration-150 active:scale-95">{mmss(remaining)}</div>
            <div className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              {t('focus.cycleDots', { n: cycleNow, m: settings.cycles })}
            </div>
          </div>

          {dial.active && (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
              <div className="relative flex h-56 w-56 items-center justify-center rounded-full border border-neutral-300/60 bg-neutral-100/85 backdrop-blur dark:border-neutral-700/60 dark:bg-neutral-900/85">
                <div className={`${segCls('add')} left-1/2 top-5 -translate-x-1/2`}>
                  <span>＋</span>
                  <span className="text-[10px] font-medium">{t('focus.gAdd')}</span>
                </div>
                <div className={`${segCls('skip')} right-5 top-1/2 -translate-y-1/2`}>
                  <span>›</span>
                  <span className="text-[10px] font-medium">{t('focus.gSkip')}</span>
                </div>
                <div className={`${segCls('back')} left-5 top-1/2 -translate-y-1/2`}>
                  <span>‹</span>
                  <span className="text-[10px] font-medium">{t('focus.gBack')}</span>
                </div>
                <div className={`${segCls('stop')} bottom-5 left-1/2 -translate-x-1/2`}>
                  <span>✕</span>
                  <span className="text-[10px] font-medium">{t('focus.gStop')}</span>
                </div>
                <div
                  className="absolute left-1/2 top-1/2 h-12 w-12 rounded-full bg-emerald-500 shadow-lg ring-4 ring-emerald-500/25"
                  style={knobStyle}
                />
              </div>
            </div>
          )}
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

      {/* Настройки таймера — отдельное окно по центру экрана */}
      {showSettings && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={() => setShowSettings(false)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-sm flex-col gap-3 overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold">{t('focus.settings')}</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
                {t('focus.focusMin')}
              </label>
              <input
                type="number"
                min={1}
                max={180}
                className={inputCls}
                value={draft.focusMin}
                onChange={(e) => setDraft((d) => ({ ...d, focusMin: Number(e.target.value) }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
                {t('focus.breakMin')}
              </label>
              <input
                type="number"
                min={1}
                max={60}
                className={inputCls}
                value={draft.breakMin}
                onChange={(e) => setDraft((d) => ({ ...d, breakMin: Number(e.target.value) }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
                {t('focus.longBreakMin')}
              </label>
              <input
                type="number"
                min={1}
                max={90}
                className={inputCls}
                value={draft.longBreakMin}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, longBreakMin: Number(e.target.value) }))
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
                {t('focus.cycles')}
              </label>
              <input
                type="number"
                min={1}
                max={12}
                className={inputCls}
                value={draft.cycles}
                onChange={(e) => setDraft((d) => ({ ...d, cycles: Number(e.target.value) }))}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
              {t('focus.sound')}
            </label>
            <Select
              value={draft.sound}
              options={POMO_SOUNDS.map((s) => ({ value: s, label: t(`focus.sound_${s}`) }))}
              onChange={(v) => setDraft((d) => ({ ...d, sound: v }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
              {t('focus.volume')} {draft.volume}%
            </label>
            <input
              type="range"
              min={0}
              max={100}
              className="w-full accent-emerald-500"
              value={draft.volume}
              onChange={(e) => setDraft((d) => ({ ...d, volume: Number(e.target.value) }))}
            />
          </div>
          <button
            type="button"
            onClick={() => playPomoSound(draft.sound, draft.volume)}
            className={btnGhost}
          >
            {t('focus.preview')}
          </button>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowSettings(false)}
              className={btnGhost}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={saveSettings}
              className="rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-medium text-neutral-950 transition hover:bg-emerald-400"
            >
              {t('common.save')}
            </button>
          </div>
          </div>
        </div>
      )}
    </div>
  )
}