import { Capacitor, registerPlugin } from '@capacitor/core'

// Мост к нативному плагину энергосбережения (см. android/.../BatteryPlugin.java).
// В браузере плагина нет — функции ниже безопасны (no-op / значения по умолчанию).
interface BatteryPlugin {
  isSupported(): Promise<{ supported: boolean }>
  isIgnoring(): Promise<{ ignoring: boolean }>
  requestIgnore(): Promise<{ ignoring: boolean }>
  openAutoStart(): Promise<void>
  openAppDetails(): Promise<void>
}

const Battery = registerPlugin<BatteryPlugin>('Battery')

/** Доступна ли настройка энергосбережения (только в нативном приложении). */
export function batteryAvailable(): boolean {
  return Capacitor.isNativePlatform()
}

/** Исключено ли приложение из оптимизации батареи. В браузере — false. */
export async function batteryIsIgnoring(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  try {
    const { ignoring } = await Battery.isIgnoring()
    return ignoring
  } catch {
    return false
  }
}

/**
 * Открывает системный диалог «исключить из оптимизации батареи».
 * Возвращает актуальный статус после попытки.
 */
export async function batteryRequestIgnore(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  try {
    const { ignoring } = await Battery.requestIgnore()
    return ignoring
  } catch {
    return false
  }
}

/** Открывает экран «Автозапуск» (MIUI/Xiaomi и др.), при неудаче — карточку приложения. */
export async function openAutoStartSettings(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await Battery.openAutoStart()
  } catch {
    // экран недоступен — не критично
  }
}

/** Открывает системную карточку приложения (разрешения, батарея, автозапуск). */
export async function openAppDetailsSettings(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await Battery.openAppDetails()
  } catch {
    // не критично
  }
}
