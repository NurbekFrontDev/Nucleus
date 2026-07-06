import { Capacitor, registerPlugin } from '@capacitor/core'

// Мост к нативному плагину «тихого режима» (см. android/.../DndPlugin.java).
// В браузере плагина нет — все функции ниже просто ничего не делают.
interface DndPlugin {
  isSupported(): Promise<{ supported: boolean }>
  hasPermission(): Promise<{ granted: boolean }>
  openSettings(): Promise<void>
  enable(): Promise<{ granted: boolean }>
  disable(): Promise<void>
}

const Dnd = registerPlugin<DndPlugin>('Dnd')

// Флаг: включён ли тихий режим НАМИ (модульный — переживает переходы между вкладками).
// Защищает от повторного включения (и системного баннера «DND is on») при каждом заходе на Фокус.
let dndActive = false

/** Доступен ли тихий режим (только внутри нативного приложения). */
export function dndAvailable(): boolean {
  return Capacitor.isNativePlatform()
}

/** Есть ли у приложения разрешение управлять режимом «Не беспокоить». */
export async function dndHasPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  try {
    const { granted } = await Dnd.hasPermission()
    return granted
  } catch {
    return false
  }
}

/** Открывает системный экран выдачи доступа к режиму «Не беспокоить». */
export async function openDndSettings(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await Dnd.openSettings()
  } catch {
    // экран недоступен — молча игнорируем
  }
}

/**
 * Включает тихий режим на время фокуса: слышны только звонки, остальные
 * уведомления и звуки не шумят. Идемпотентно: если уже включён нами —
 * повторно не трогаем (чтобы не было повторного баннера). Возвращает true, если включено.
 */
export async function enableFocusDnd(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  if (dndActive) return true
  try {
    const { granted } = await Dnd.enable()
    if (granted) dndActive = true
    return granted
  } catch {
    return false
  }
}

/** Возвращает обычный звук (выключает тихий режим). Безопасно в браузере. */
export async function disableFocusDnd(): Promise<void> {
  dndActive = false
  if (!Capacitor.isNativePlatform()) return
  try {
    await Dnd.disable()
  } catch {
    // не удалось — не критично
  }
}
