import { supabase } from './supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

// Глобальная подписка на изменения в Supabase (postgres_changes).
// При получении изменения диспатчим кастомный DOM-событие,
// на которое подписываются компоненты для авто-перезагрузки данных.

let channel: RealtimeChannel | null = null

const WATCHED_TABLES = [
  'planner_items',
  'planner_logs',
  'oneoff_tasks',
  'expenses',
  'incomes',
  'categories',
  'months',
  'planner_day_moods',
] as const

export type SyncEvent = {
  table: string
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  new?: Record<string, unknown>
  old?: Record<string, unknown>
}

export function startRealtimeSync(userId: string): void {
  if (channel) return // уже подписаны

  channel = supabase.channel(`nucleus-sync:${userId}`)

  for (const table of WATCHED_TABLES) {
    channel.on(
      'postgres_changes' as 'system',
      { event: '*', schema: 'public', table, filter: `user_id=eq.${userId}` } as Record<string, string>,
      (payload: Record<string, unknown>) => {
        window.dispatchEvent(
          new CustomEvent('nucleus-sync', {
            detail: {
              table,
              eventType: payload.eventType,
              new: payload.new,
              old: payload.old,
            } as SyncEvent,
          }),
        )
      },
    )
  }

  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      console.log('[RealtimeSync] Subscribed to', WATCHED_TABLES.length, 'tables')
    }
  })
}

export function stopRealtimeSync(): void {
  if (channel) {
    supabase.removeChannel(channel)
    channel = null
  }
}

// Хук-хелпер: подписывается на nucleus-sync для указанных таблиц.
// Возвращает функцию отписки.
export function onSyncEvent(
  tables: string[],
  callback: (e: SyncEvent) => void,
): () => void {
  const handler = (ev: Event) => {
    const detail = (ev as CustomEvent<SyncEvent>).detail
    if (tables.includes(detail.table)) {
      callback(detail)
    }
  }
  window.addEventListener('nucleus-sync', handler)
  return () => window.removeEventListener('nucleus-sync', handler)
}
