import { supabase } from './supabase'
import type { PomoRuntime } from './planner'

// ====================================================================
// Синхронизация Помодоро между устройствами пользователя.
// Запуск/пауза/смена фазы на одном устройстве (телефон / браузер /
// десктоп-приложение) мгновенно отражается на остальных через Supabase Realtime
// (broadcast по личному каналу). База данных для этого не нужна — сообщения
// летят напрямую между онлайн-устройствами.
// ====================================================================

// Уникальный id этой вкладки/устройства на время сессии — чтобы игнорировать
// собственные широковещательные сообщения (не зациклиться).
const DEVICE_ID = Math.random().toString(36).slice(2) + Date.now().toString(36)

export type PomoSyncMessage =
  | { kind: 'update'; runtime: PomoRuntime; from: string }
  | { kind: 'clear'; from: string }

// Текущий канал (один на экран Фокуса).
let channel: ReturnType<typeof supabase.channel> | null = null

// Подписка на синхронизацию Помодоро. Возвращает функцию очистки.
// Теперь шлет глобальное событие 'nucleus-pomo-sync' на window, чтобы DND работал везде.
export function initPomoSync(userId: string): () => void {
  const ch = supabase.channel(`pomo-sync:${userId}`, {
    config: { broadcast: { self: false } },
  })
  ch.on('broadcast', { event: 'pomo' }, (payload) => {
    const msg = (payload as { payload?: PomoSyncMessage }).payload
    // Свои же сообщения игнорируем.
    if (!msg || msg.from === DEVICE_ID) return
    window.dispatchEvent(new CustomEvent('nucleus-pomo-sync', { detail: msg }))
  })
  ch.subscribe()
  channel = ch
  return () => {
    try {
      void supabase.removeChannel(ch)
    } catch {
      // не критично
    }
    if (channel === ch) channel = null
  }
}

// Транслирует текущее состояние таймера остальным устройствам.
export function broadcastPomoUpdate(runtime: PomoRuntime): void {
  if (!channel) return
  void channel.send({
    type: 'broadcast',
    event: 'pomo',
    payload: { kind: 'update', runtime, from: DEVICE_ID } as PomoSyncMessage,
  })
}

// Сообщает остальным устройствам, что таймер полностью остановлен.
export function broadcastPomoClear(): void {
  if (!channel) return
  void channel.send({
    type: 'broadcast',
    event: 'pomo',
    payload: { kind: 'clear', from: DEVICE_ID } as PomoSyncMessage,
  })
}
