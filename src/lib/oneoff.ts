import { supabase } from './supabase'
import { readCache, writeCache } from './offlineCache'

export type OneoffTask = {
  id: string
  user_id: string
  title: string
  note: string | null
  target_date: string | null
  reminder_time?: string | null
  done_at: string | null
  created_at: string
}

const oneoffCacheKey = (userId: string) => `oneoff:${userId}`

export function getCachedOneoffTasks(userId: string, filter?: { date?: string }): OneoffTask[] {
  const cached = readCache<OneoffTask[]>(oneoffCacheKey(userId)) ?? []
  let filtered = cached
  if (filter?.date) {
    filtered = cached.filter((t) => t.target_date === filter.date)
  }
  const undone = filtered.filter((t) => !t.done_at).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  const done = filtered.filter((t) => !!t.done_at).sort((a, b) => new Date(b.done_at!).getTime() - new Date(a.done_at!).getTime())
  return [...undone, ...done]
}

export async function loadOneoffTasks(userId: string, filter?: { date?: string }): Promise<OneoffTask[]> {
  try {
    const { data, error } = await supabase
      .from('planner_oneoff')
      .select('*')
      .eq('user_id', userId)

    if (error) {
      console.warn('Network error loading oneoff tasks, falling back to cache:', error)
      return getCachedOneoffTasks(userId, filter)
    }

    if (data) {
      writeCache(oneoffCacheKey(userId), data as OneoffTask[])
    }
  } catch (e) {
    console.warn('Error loading oneoff tasks:', e)
  }
  return getCachedOneoffTasks(userId, filter)
}

export async function addOneoffTask(
  userId: string,
  title: string,
  note?: string,
  targetDate?: string,
  reminderTime?: string,
): Promise<OneoffTask> {
  const localTask: OneoffTask = {
    id: `local:${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    user_id: userId,
    title,
    note: note || null,
    target_date: targetDate || null,
    reminder_time: reminderTime || null,
    done_at: null,
    created_at: new Date().toISOString(),
  }

  // Мгновенное обновление локального кэша
  const current = readCache<OneoffTask[]>(oneoffCacheKey(userId)) ?? []
  writeCache(oneoffCacheKey(userId), [localTask, ...current])

  // Фоновая синхронизация с Supabase
  void (async () => {
    try {
      const payload: Record<string, unknown> = {
        user_id: userId,
        title,
        note: note || null,
        target_date: targetDate || null,
      }
      if (reminderTime) {
        payload.reminder_time = reminderTime
      }

      let { data, error } = await supabase
        .from('planner_oneoff')
        .insert(payload)
        .select()
        .single()

      if (error && payload.reminder_time && (error.code === 'PGRST204' || error.message?.includes('reminder_time'))) {
        delete payload.reminder_time
        const retry = await supabase.from('planner_oneoff').insert(payload).select().single()
        data = retry.data
        error = retry.error
      }

      if (data) {
        const serverTask = data as OneoffTask
        const cached = readCache<OneoffTask[]>(oneoffCacheKey(userId)) ?? []
        const updated = cached.map((t) => (t.id === localTask.id ? serverTask : t))
        writeCache(oneoffCacheKey(userId), updated)
      }
    } catch (e) {
      console.warn('Background addOneoffTask error:', e)
    }
  })()

  return localTask
}

export async function updateOneoffTask(
  userId: string,
  taskId: string,
  updates: { title?: string; note?: string | null; target_date?: string | null; reminder_time?: string | null },
): Promise<void> {
  // Мгновенное обновление локального кэша
  const current = readCache<OneoffTask[]>(oneoffCacheKey(userId)) ?? []
  const updated = current.map((t) => (t.id === taskId ? { ...t, ...updates } : t))
  writeCache(oneoffCacheKey(userId), updated)

  if (taskId.startsWith('local:')) return

  // Фоновая синхронизация
  void (async () => {
    try {
      const payload: Record<string, unknown> = {}
      if (updates.title !== undefined) payload.title = updates.title
      if (updates.note !== undefined) payload.note = updates.note
      if (updates.target_date !== undefined) payload.target_date = updates.target_date
      if (updates.reminder_time !== undefined) payload.reminder_time = updates.reminder_time

      let { error } = await supabase
        .from('planner_oneoff')
        .update(payload)
        .eq('id', taskId)
        .eq('user_id', userId)

      if (error && payload.reminder_time && (error.code === 'PGRST204' || error.message?.includes('reminder_time'))) {
        delete payload.reminder_time
        await supabase.from('planner_oneoff').update(payload).eq('id', taskId).eq('user_id', userId)
      }
    } catch (e) {
      console.warn('Background updateOneoffTask error:', e)
    }
  })()
}

export async function toggleOneoffDone(userId: string, taskId: string, currentlyDone: boolean): Promise<void> {
  const nextDoneAt = currentlyDone ? null : new Date().toISOString()

  // Мгновенное обновление локального кэша
  const current = readCache<OneoffTask[]>(oneoffCacheKey(userId)) ?? []
  const updated = current.map((t) => (t.id === taskId ? { ...t, done_at: nextDoneAt } : t))
  writeCache(oneoffCacheKey(userId), updated)

  if (taskId.startsWith('local:')) return

  void (async () => {
    try {
      await supabase
        .from('planner_oneoff')
        .update({ done_at: nextDoneAt })
        .eq('id', taskId)
        .eq('user_id', userId)
    } catch (e) {
      console.warn('Background toggleOneoffDone error:', e)
    }
  })()
}

export async function deleteOneoffTask(userId: string, taskId: string): Promise<void> {
  // Мгновенное обновление локального кэша
  const current = readCache<OneoffTask[]>(oneoffCacheKey(userId)) ?? []
  const updated = current.filter((t) => t.id !== taskId)
  writeCache(oneoffCacheKey(userId), updated)

  if (taskId.startsWith('local:')) return

  void (async () => {
    try {
      await supabase
        .from('planner_oneoff')
        .delete()
        .eq('id', taskId)
        .eq('user_id', userId)
    } catch (e) {
      console.warn('Background deleteOneoffTask error:', e)
    }
  })()
}

export async function cleanupOldOneoff(userId: string): Promise<number> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  
  // Очистка из локального кэша
  const current = readCache<OneoffTask[]>(oneoffCacheKey(userId)) ?? []
  const cleaned = current.filter((t) => !t.done_at || t.done_at >= sevenDaysAgo)
  const count = current.length - cleaned.length
  if (count > 0) {
    writeCache(oneoffCacheKey(userId), cleaned)
  }

  void (async () => {
    try {
      await supabase
        .from('planner_oneoff')
        .delete()
        .eq('user_id', userId)
        .not('done_at', 'is', null)
        .lt('done_at', sevenDaysAgo)
    } catch (e) {
      // ignore
    }
  })()

  return count
}
