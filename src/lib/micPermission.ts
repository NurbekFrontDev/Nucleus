// Разрешение на микрофон для голосовых записей дневника.
//
// Поведение по платформам:
//  - Android (Capacitor): WebView-движок Capacitor сам показывает системный
//    диалог RECORD_AUDIO при первом getUserMedia (BridgeWebChromeClient.
//    onPermissionRequest), если разрешение объявлено в AndroidManifest.
//  - Desktop (Tauri/WebView2) и Web: системный/браузерный диалог.
//  - Если разрешение уже дано или отозвано навсегда — getUserMedia
//    либо отдаёт поток, либо кидает NotAllowedError.
//
// Состояние узнаём двумя путями: Permissions API (где поддержано) и лёгким
// getUserMedia-пробом (старт + немедленная остановка треков) как фолбэк.

export type MicPermissionState = 'granted' | 'denied' | 'prompt' | 'unknown'

/** Имеется ли API захвата аудио в этом окружении. */
export function isMicAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

/**
 * Текущее состояние разрешения. 'unknown' = не удалось определить ( treated
// как 'prompt' при запросе).
 */
export async function getMicPermissionState(): Promise<MicPermissionState> {
  if (!isMicAvailable()) return 'denied'
  try {
    // Permissions API понимает 'microphone' в Chrome/Android-WebView.
    const name = 'microphone' as PermissionName
    if (navigator.permissions?.query) {
      const status = await navigator.permissions.query({ name })
      if (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt') {
        return status.state
      }
    }
  } catch {
    // WebView2/Tauri бросает TypeError на неизвестном имени — идём к пробу.
  }
  return 'unknown'
}

/**
 * Лёгкий пробный запрос: открывает микрофон и сразу отпускает треки.
 * Возвращает true, если доступ получен. Используется и для точечного
 * определения состояния (когда Permissions API недоступно), и как
 * «попросить разрешение» из настроек/при первом входе.
 */
export async function probeMicPermission(): Promise<boolean> {
  if (!isMicAvailable()) return false
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((t) => t.stop())
    return true
  } catch {
    return false
  }
}

/**
 * Полное состояние разрешения с фолбэком на пробу. Результат 'prompt'
// означает «спросить можно» — вызываем probeMicPermission, который покажет
 * системный диалог.
 */
export async function resolveMicState(): Promise<MicPermissionState> {
  const state = await getMicPermissionState()
  if (state !== 'unknown') return state
  // Не удалось спросить Permissions API — единственный способ узнать —
  // попробовать. Если разрешено — вернётся granted, если нет — denied.
  return (await probeMicPermission()) ? 'granted' : 'denied'
}

const REQUESTED_KEY = 'nucleus:mic:requested'

/**
 * Запрос разрешения при первом входе в приложение (один раз за установку,
 * пока не будет получено дано/отказано). Показывать диалог при каждом старте
 * нельзя — поэтому после первой попытки запоминаем факт запроса.
 * Возвращает итоговое состояние.
 */
export async function ensureMicPermissionOnce(): Promise<MicPermissionState> {
  if (!isMicAvailable()) return 'denied'
  let alreadyAsked = false
  try {
    alreadyAsked = !!localStorage.getItem(REQUESTED_KEY)
  } catch {
    // localStorage недоступен — спрашиваем как в первый раз
  }
  const state = await getMicPermissionState()
  if (state === 'granted' || state === 'denied') return state
  // 'prompt' или 'unknown' (Permissions API не поддержано). Если мы уже
  // спрашивали — пробуем снова: повторный getUserMedia диалог не покажет,
  // а вернёт реальный ответ пользователя. Если не спрашивали — теперь
  // точно покажем системный диалог и запомним факт запроса.
  if (!alreadyAsked) {
    try {
      localStorage.setItem(REQUESTED_KEY, '1')
    } catch {
      // localStorage недоступен — спрашиваем в любом случае
    }
  }
  const granted = await probeMicPermission()
  return granted ? 'granted' : 'denied'
}
