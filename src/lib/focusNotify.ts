import { Capacitor, registerPlugin } from '@capacitor/core'

// Мост к нативному плагину постоянного уведомления Помодоро (foreground-сервис).
// См. android/.../FocusNotifyPlugin.java и FocusTimerService.java.
// В браузере плагина нет — функции ниже просто ничего не делают.
interface FocusNotifyPlugin {
  update(options: {
    title: string
    body: string
    remainingSec: number
    running: boolean
    doneTitle?: string
    doneBody?: string
  }): Promise<void>
  stop(): Promise<void>
}

const FocusNotify = registerPlugin<FocusNotifyPlugin>('FocusNotify')

/** Доступно ли постоянное уведомление таймера (только в нативном приложении). */
export function focusNotifyAvailable(): boolean {
  return Capacitor.isNativePlatform()
}

/**
 * Показывает/обновляет постоянное уведомление о состоянии Помодоро.
 * title — название фазы (Фокус/Перерыв/Длинный перерыв),
 * body — подпись, remainingSec — сколько секунд осталось (маленькое
 * целое, надёжно проходит через мост; время окончания вычисляется на
 * нативной стороне), running — идёт ли таймер (true = живой отсчёт).
 */
export async function showFocusNotification(options: {
  title: string
  body: string
  remainingSec: number
  running: boolean
  // Тексты для сигнала окончания фазы (покажет нативный сервис, когда таймер дойдёт до 0).
  doneTitle?: string
  doneBody?: string
}): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await FocusNotify.update(options)
  } catch {
    // плагин недоступен — не критично
  }
}

/** Убирает уведомление таймера (останавливает foreground-сервис). */
export async function hideFocusNotification(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await FocusNotify.stop()
  } catch {
    // не удалось — не критично
  }
}
