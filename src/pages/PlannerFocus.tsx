import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useLang } from '../lib/i18n'
import Select from '../components/Select'
import { enableFocusDnd, disableFocusDnd, dndHasPermission, openDndSettings } from '../lib/dnd'
import { Capacitor } from '@capacitor/core'
import { showToast } from '../lib/toast'
import { showFocusNotification, hideFocusNotification, focusNotifyAvailable } from '../lib/focusNotify'
import { notifyDesktop, setDesktopDnd } from '../lib/native'
import { broadcastPomoUpdate, broadcastPomoClear } from '../lib/pomoSync'
import {
  loadDay,
  loadPomoSettings,
  loadPomoSettingsCache,
  savePomoSettings,
  logPomodoro,
  loadPomoToday,
  loadPomoRuntime,
  savePomoRuntime,
  clearPomoRuntime,
  todayStr,
  type PlannerItem,
  type PomoSettings,
  type PomoKind,
  type PomoRuntime,
} from '../lib/planner'

// Экран «Фокус»: Помодоро в стиле GoodTime. Две фазы: Фокус и Перерыв
// (длинный перерыв убран). Нажатие на время = старт/пауза; тянешь от центра —
// появляется жестовый «пульт» (➕ +1 мин, › вперёд, ‹ назад, ✕ стоп).
// Завершение фазы в фоне/при закрытом приложении обрабатывает нативный сервис
// (звук + вибрация + выкл. «Не беспокоить»), а при возврате экран сам переходит
// к следующей фазе.

const cardCls =
  'rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50'
const inputCls =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950'
const btnGhost =
  'rounded-xl border border-neutral-300 px-4 py-2.5 text-sm transition hover:bg-neutral-100 active:scale-[.97] dark:border-neutral-700 dark:hover:bg-neutral-800'

// Цвет кольца по фазе (фокус — зелёный, перерыв — голубой).
const ringColor = (m: PomoKind): string =>
  m === 'focus' ? 'text-emerald-500' : 'text-sky-500'

const mmss = (sec: number): string => {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

const clamp = (n: number, lo: number, hi: number): number =>
  Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : lo

// Доступные сигналы окончания фазы в вебе (id совпадают с ключами i18n focus.sound_*).
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

// Проигрывает выбранный сигнал (веб, Web Audio). На телефоне сигнал окончания
// даёт нативный сервис (наш WAV), поэтому здесь только для браузера и превью.
function playPomoSound(sound: string, volume: number) {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const vol = Math.max(0, Math.min(1, volume / 100))
    if (vol <= 0) return
    const ac = new Ctx()
    const specs = SOUND_SPECS[sound as PomoSound] ?? SOUND_SPECS.double
    let end = 0
    for (const nSpec of specs) {
      const o = ac.createOscillator()
      const gg = ac.createGain()
      o.connect(gg)
      gg.connect(ac.destination)
      o.type = nSpec.type ?? 'sine'
      o.frequency.value = nSpec.freq
      const t0 = ac.currentTime + nSpec.start
      const peak = Math.max(0.0005, Math.min(1, 0.75 * (nSpec.gain ?? 1) * vol))
      gg.gain.setValueAtTime(0.0001, t0)
      gg.gain.exponentialRampToValueAtTime(peak, t0 + 0.02)
      gg.gain.exponentialRampToValueAtTime(0.0001, t0 + nSpec.dur)
      o.start(t0)
      o.stop(t0 + nSpec.dur + 0.03)
      end = Math.max(end, nSpec.start + nSpec.dur)
    }
    window.setTimeout(() => ac.close(), (end + 0.4) * 1000)
  } catch {
    // звук недоступен — не критично
  }
}

type Dir = 'add' | 'skip' | 'back' | 'stop' | null
// Две фазы: фокус и перерыв (длинный перерыв убран).
const PHASE_ORDER: PomoKind[] = ['focus', 'break']
const DEADZONE = 26
const DIAL_R = 78

export default function PlannerFocus() {
  const { user } = useAuth()
  const { t, lang } = useLang()

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
  // Черновые строки полей Фокус/Перерыв — чтобы поле можно было очистить полностью (без принудительного 0).
  const [focusStr, setFocusStr] = useState('')
  const [breakStr, setBreakStr] = useState('')
  const [ready, setReady] = useState(true)
  const [pressed, setPressed] = useState(false)

  const [dial, setDial] = useState<{ active: boolean; dx: number; dy: number; dir: Dir }>({
    active: false,
    dx: 0,
    dy: 0,
    dir: null,
  })
  const startRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const pressedRef = useRef(false)
  const pressTimer = useRef<number | null>(null)
  const dialRef = useRef<{ active: boolean; dx: number; dy: number; dir: Dir }>({
    active: false,
    dx: 0,
    dy: 0,
    dir: null,
  })

  const endRef = useRef<number | null>(null)
  const completeRef = useRef<() => void>(() => {})
  const notifShownRef = useRef(false)
  // Флаг момента завершения фазы: чтобы не погасить нативный сигнал окончания.
  const justCompletedRef = useRef(false)
  // Было ли восстановлено состояние таймера (чтобы начальная загрузка не затёрла его).
  const runtimeRestoredRef = useRef(false)
  const restoreDoneRef = useRef(false)
  // Проверено ли восстановление состояния таймера (чтобы DND-эффект не срабатывал до этого).
  const [restoreChecked, setRestoreChecked] = useState(false)

  const durMin = (m: PomoKind, s: PomoSettings = settings): number =>
    m === 'focus' ? s.focusMin : s.breakMin

  // Тексты сигнала окончания фазы (для нативного уведомления).
  const doneFor = (m: PomoKind): { title: string; body: string } => {
    if (lang === 'ru') {
      return m === 'focus'
        ? { title: 'Фокус завершён', body: 'Нажми, чтобы открыть' }
        : { title: 'Перерыв завершён', body: 'Нажми, чтобы открыть' }
    }
    return m === 'focus'
      ? { title: 'Focus finished', body: 'Tap to open' }
      : { title: 'Break finished', body: 'Tap to open' }
  }

  const focusNotifBody = (): string => {
    const it = items.find((i) => i.id === itemId)
    if (it) return `${it.icon ? it.icon + ' ' : ''}${it.title}`
    return lang === 'ru' ? 'Нажми, чтобы открыть' : 'Tap to open'
  }

  // Завершение фазы, истёкшей в фоне: логируем и переходим к следующей.
  // Если фокус завершился более 10 минут назад — перерыв уже бессмысленен,
  // показываем сразу новую фокус-сессию.
  const finishElapsed = (rt: PomoRuntime) => {
    const mins = Math.round(rt.totalSec / 60)
    if (user && mins > 0) {
      logPomodoro(user.id, {
        kind: rt.mode,
        durationMin: mins,
        itemId: rt.mode === 'focus' ? rt.itemId || null : null,
        completed: true,
      }).catch(() => {})
    }
    // Сколько секунд прошло с момента, когда фаза должна была завершиться.
    const elapsedSinceEnd = rt.endTime > 0 ? Math.round((Date.now() - rt.endTime) / 1000) : 0
    const SKIP_BREAK_AFTER_SEC = 10 * 60 // 10 минут
    let next: PomoKind
    if (rt.mode === 'focus' && elapsedSinceEnd >= SKIP_BREAK_AFTER_SEC) {
      // Фокус завершился давно — перерыв пропускаем, сразу новый фокус.
      next = 'focus'
    } else {
      next = rt.mode === 'focus' ? 'break' : 'focus'
    }
    setMode(next)
    setRunning(false)
    endRef.current = null
    setRemaining(durMin(next) * 60)
    if (rt.mode === 'focus') {
      setFocusDone((d) => d + 1)
      setFocusMinToday((v) => v + mins)
    }
    savePomoRuntime({
      mode: next,
      running: false,
      endTime: 0,
      remaining: durMin(next) * 60,
      totalSec: durMin(next) * 60,
      itemId: rt.itemId,
    })
  }

  // Восстановление состояния таймера при входе (один раз).
  useEffect(() => {
    if (!user || restoreDoneRef.current) return
    restoreDoneRef.current = true
    const rt = loadPomoRuntime()
    if (!rt) {
      setRestoreChecked(true)
      return
    }
    runtimeRestoredRef.current = true
    if (rt.running && rt.endTime > 0) {
      const left = Math.round((rt.endTime - Date.now()) / 1000)
      if (left > 0) {
        setMode(rt.mode)
        setItemId(rt.itemId ?? '')
        setRemaining(left)
        endRef.current = rt.endTime
        setRunning(true)
      } else {
        finishElapsed(rt)
      }
    } else {
      setMode(rt.mode)
      setItemId(rt.itemId ?? '')
      if (rt.remaining > 0) setRemaining(rt.remaining)
    }
    setRestoreChecked(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

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
        if (endRef.current == null && !running && !runtimeRestoredRef.current) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  useEffect(() => {
    return () => {
      if (pressTimer.current) window.clearTimeout(pressTimer.current)
    }
  }, [])

  // ===== Тихий режим (DND) во время фокуса =====
  const dndPromptedRef = useRef(false)
  useEffect(() => {
    // Ждём восстановления состояния таймера, чтобы не переключать DND на мгновенном
    // running=false при возврате на вкладку (иначе повторный системный баннер).
    if (!restoreChecked) return
    let cancelled = false
    // Тихий режим включаем ТОЛЬКО во время фокуса, не во время перерыва.
    if (running && mode === 'focus') {
      // На ПК (Tauri) гасим всплывающие уведомления Windows на время фокуса.
      void setDesktopDnd(true)
      
      if (Capacitor.isNativePlatform()) {
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
      }
    } else {
      void disableFocusDnd()
      void setDesktopDnd(false)
    }
    return () => {
      cancelled = true
    }
  }, [running, mode, lang, restoreChecked])

  const runningRef = useRef(false)
  useEffect(() => {
    runningRef.current = running
  }, [running])

  // ===== Синхронизация Помодоро между устройствами =====
  // Зеркало настроек в ref — чтобы обработчик удалённых событий не переподписывался.
  const settingsRef = useRef(settings)
  useEffect(() => {
    settingsRef.current = settings
  }, [settings])
  // Подавляем одну трансляцию после применения удалённого состояния (не эхо).
  const suppressBroadcastRef = useRef(false)
  // Первый прогон broadcast-эффекта пропускаем — чтобы не затереть другое устройство.
  const syncInitRef = useRef(false)

  // Применяет состояние таймера, пришедшее с другого устройства (без обратной трансляции).
  const applyRemoteRuntime = (rt: PomoRuntime) => {
    suppressBroadcastRef.current = true
    window.setTimeout(() => {
      suppressBroadcastRef.current = false
    }, 400)
    setMode(rt.mode)
    setItemId(rt.itemId ?? '')
    if (rt.running && rt.endTime > 0) {
      const left = Math.round((rt.endTime - Date.now()) / 1000)
      if (left > 0) {
        setRemaining(left)
        endRef.current = rt.endTime
        setRunning(true)
      } else {
        endRef.current = null
        setRunning(false)
        setRemaining(0)
      }
    } else {
      endRef.current = null
      setRunning(false)
      setRemaining(rt.remaining > 0 ? rt.remaining : durMin(rt.mode) * 60)
    }
    savePomoRuntime(rt)
  }

  // Подписка на удалённые события (телефон ⇄ десктоп ⇄ браузер).
  useEffect(() => {
    if (!user) return
    const handler = (e: Event) => {
      const msg = (e as CustomEvent).detail
      if (msg.kind === 'clear') {
        suppressBroadcastRef.current = true
        window.setTimeout(() => {
          suppressBroadcastRef.current = false
        }, 400)
        setRunning(false)
        endRef.current = null
        setMode('focus')
        setRemaining(settingsRef.current.focusMin * 60)
        clearPomoRuntime()
      } else {
        applyRemoteRuntime(msg.runtime)
      }
    }
    window.addEventListener('nucleus-pomo-sync', handler)
    return () => window.removeEventListener('nucleus-pomo-sync', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // Трансляция нашего состояния при смене фазы/запуска/дела (не каждую секунду).
  useEffect(() => {
    if (!restoreChecked) return
    // Первый прогон после восстановления не транслируем.
    if (!syncInitRef.current) {
      syncInitRef.current = true
      return
    }
    if (suppressBroadcastRef.current) return
    broadcastPomoUpdate({
      mode,
      running,
      endTime: running ? endRef.current ?? 0 : 0,
      remaining,
      totalSec: durMin(mode) * 60,
      itemId: itemId || null,
    })
    // Намеренно без remaining в зависимостях — иначе трансляция шла бы каждую секунду.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, mode, itemId, restoreChecked])

  // ===== Постоянное уведомление таймера (Android) =====
  useEffect(() => {
    if (!focusNotifyAvailable()) return
    // Момент завершения фазы: НЕ трогаем нативное уведомление — нативный
    // сервис сам покажет «завершено» со звуком и вибрацией. Иначе мы бы погасили
    // сервис раньше, чем он успеет дать сигнал.
    if (justCompletedRef.current) {
      justCompletedRef.current = false
      return
    }
    const label = mode === 'focus' ? t('focus.focus') : t('focus.break')
    const d = doneFor(mode)
    if (running && endRef.current != null) {
      notifShownRef.current = true
      void showFocusNotification({
        title: label,
        body: focusNotifBody(),
        remainingSec: Math.max(0, Math.round((endRef.current - Date.now()) / 1000)),
        running: true,
        doneTitle: d.title,
        doneBody: d.body,
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

  // Уход с экрана: если таймер идёт — оставляем тихий режим и уведомление.
  useEffect(() => {
    return () => {
      if (!runningRef.current) {
        void disableFocusDnd()
        void setDesktopDnd(false)
        void hideFocusNotification()
      }
    }
  }, [])

  // Логика завершения фазы (через ref, чтобы тик видел свежие значения).
  completeRef.current = () => {
    // На телефоне сигнал окончания (звук+вибрация+уведомление) даёт нативный
    // сервис — поэтому здесь НЕ гасим его уведомление (см. guard в эффекте).
    justCompletedRef.current = true
    setRunning(false)
    endRef.current = null
    // В приложении звук/вибрацию даёт нативный сервис; веб-звук — только в браузере.
    if (!focusNotifyAvailable()) playPomoSound(settings.sound, settings.volume)
    // На ПК (Tauri) показываем системное уведомление об окончании фазы.
    {
      const doneMsg = doneFor(mode)
      void notifyDesktop(doneMsg.title, doneMsg.body)
    }
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
      setFocusDone((d) => d + 1)
      setFocusMinToday((v) => v + mins)
      const next: PomoKind = 'break'
      setMode(next)
      setRemaining(durMin(next) * 60)
      savePomoRuntime({
        mode: next,
        running: false,
        endTime: 0,
        remaining: durMin(next) * 60,
        totalSec: durMin(next) * 60,
        itemId: itemId || null,
      })
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
      const next: PomoKind = 'focus'
      setMode(next)
      setRemaining(settings.focusMin * 60)
      savePomoRuntime({
        mode: next,
        running: false,
        endTime: 0,
        remaining: settings.focusMin * 60,
        totalSec: settings.focusMin * 60,
        itemId: itemId || null,
      })
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
    const end = Date.now() + base * 1000
    endRef.current = end
    setRunning(true)
    savePomoRuntime({
      mode,
      running: true,
      endTime: end,
      remaining: base,
      totalSec: durMin(mode) * 60,
      itemId: itemId || null,
    })
    if (focusNotifyAvailable()) {
      const label = mode === 'focus' ? t('focus.focus') : t('focus.break')
      const d = doneFor(mode)
      notifShownRef.current = true
      void showFocusNotification({
        title: label,
        body: focusNotifBody(),
        remainingSec: base,
        running: true,
        doneTitle: d.title,
        doneBody: d.body,
      })
    }
  }
  const pause = () => {
    setRunning(false)
    endRef.current = null
    savePomoRuntime({
      mode,
      running: false,
      endTime: 0,
      remaining,
      totalSec: durMin(mode) * 60,
      itemId: itemId || null,
    })
  }
  const switchMode = (m: PomoKind) => {
    const wasRunning = running
    const base = durMin(m) * 60
    setMode(m)
    if (wasRunning) {
      // Фокус/перерыв шёл — сразу запускаем новую фазу.
      const end = Date.now() + base * 1000
      endRef.current = end
      setRemaining(base)
      setRunning(true)
      savePomoRuntime({
        mode: m,
        running: true,
        endTime: end,
        remaining: base,
        totalSec: base,
        itemId: itemId || null,
      })
    } else {
      // Фокус не запущен — просто переключаем фазу без запуска.
      endRef.current = null
      setRemaining(base)
      setRunning(false)
      savePomoRuntime({
        mode: m,
        running: false,
        endTime: 0,
        remaining: base,
        totalSec: base,
        itemId: itemId || null,
      })
    }
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
      const rem = Math.max(0, Math.round((endRef.current - Date.now()) / 1000))
      savePomoRuntime({
        mode,
        running: true,
        endTime: endRef.current,
        remaining: rem,
        totalSec: durMin(mode) * 60,
        itemId: itemId || null,
      })
      if (focusNotifyAvailable()) {
        const label = mode === 'focus' ? t('focus.focus') : t('focus.break')
        const d = doneFor(mode)
        void showFocusNotification({
          title: label,
          body: focusNotifBody(),
          remainingSec: rem,
          running: true,
          doneTitle: d.title,
          doneBody: d.body,
        })
      }
    }
  }
  const stopAll = () => {
    setRunning(false)
    endRef.current = null
    setMode('focus')
    setRemaining(settings.focusMin * 60)
    clearPomoRuntime()
    // Останавливаем таймер и на других устройствах.
    broadcastPomoClear()
  }

  const dirFrom = (dx: number, dy: number): Dir => {
    if (Math.hypot(dx, dy) < DEADZONE) return null
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'skip' : 'back'
    return dy > 0 ? 'stop' : 'add'
  }

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
    const next = { active: false, dx: 0, dy: 0, dir: null as Dir }
    dialRef.current = next
    setDial(next)
  }
  const onDialMove = (e: React.PointerEvent) => {
    if (!pressedRef.current) return
    const dx = e.clientX - startRef.current.x
    const dy = e.clientY - startRef.current.y
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
    if (!wasPressed) return
    if (d.active) {
      if (d.dir === 'add') addMinute()
      else if (d.dir === 'skip') cyclePhase(1)
      else if (d.dir === 'back') cyclePhase(-1)
      else if (d.dir === 'stop') stopAll()
      return
    }
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
    // Пустое поле — оставляем прежнее значение; иначе берём введённое.
    const fRaw = focusStr.trim() === '' ? settings.focusMin : Number(focusStr)
    const bRaw = breakStr.trim() === '' ? settings.breakMin : Number(breakStr)
    const clean: PomoSettings = {
      focusMin: clamp(fRaw, 1, 180),
      breakMin: clamp(bRaw, 1, 60),
      sound,
      volume: clamp(draft.volume, 0, 100),
    }
    setSettings(clean)
    setDraft(clean)
    setFocusStr(String(clean.focusMin))
    setBreakStr(String(clean.breakMin))
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

  const phaseLabel = mode === 'focus' ? t('focus.focus') : t('focus.break')

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
            setFocusStr(String(settings.focusMin))
            setBreakStr(String(settings.breakMin))
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
              !running && remaining > 0 && remaining < durMin(mode) * 60 ? 'animate-timer-pulse' : ''
            }`}
          >
            <div className="text-xs uppercase tracking-wide text-neutral-400">{phaseLabel}</div>
            <div className="text-6xl font-bold tabular-nums transition-transform duration-150 active:scale-95">
              {mmss(remaining)}
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
                  inputMode="numeric"
                  min={1}
                  max={180}
                  className={inputCls}
                  value={focusStr}
                  onChange={(e) => setFocusStr(e.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, ''))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
                  {t('focus.breakMin')}
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={60}
                  className={inputCls}
                  value={breakStr}
                  onChange={(e) => setBreakStr(e.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, ''))}
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
              <button type="button" onClick={() => setShowSettings(false)} className={btnGhost}>
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
