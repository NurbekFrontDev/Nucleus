import { supabase } from './supabase'

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

export async function loadOneoffTasks(userId: string, filter?: { date?: string }): Promise<OneoffTask[]> {
  let query = supabase
    .from('planner_oneoff')
    .select('*')
    .eq('user_id', userId)

  if (filter?.date) {
    query = query.eq('target_date', filter.date)
  }

  const { data, error } = await query
  if (error) {
    console.error('Error loading one-time tasks:', error)
    return []
  }

  if (!data) return []

  // Order: undone first (by created_at desc), then done (by done_at desc)
  const undone = data.filter((t) => !t.done_at).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  const done = data.filter((t) => !!t.done_at).sort((a, b) => new Date(b.done_at!).getTime() - new Date(a.done_at!).getTime())

  return [...undone, ...done]
}

export async function addOneoffTask(
  userId: string,
  title: string,
  note?: string,
  targetDate?: string,
  reminderTime?: string,
): Promise<OneoffTask | null> {
  const payload: Record<string, unknown> = {
    user_id: userId,
    title,
    note: note || null,
    target_date: targetDate || null,
  }
  if (reminderTime) {
    payload.reminder_time = reminderTime
  }

  const { data, error } = await supabase
    .from('planner_oneoff')
    .insert(payload)
    .select()
    .single()

  if (error) {
    // Если колонка reminder_time ещё не добавлена в схему Supabase, пробуем сохранить без неё
    if (payload.reminder_time && (error.code === 'PGRST204' || error.message?.includes('reminder_time'))) {
      delete payload.reminder_time
      const retry = await supabase.from('planner_oneoff').insert(payload).select().single()
      if (!retry.error && retry.data) {
        return {
          ...(retry.data as OneoffTask),
          reminder_time: reminderTime || null,
        }
      }
    }
    console.error('Error adding one-time task:', error)
    return null
  }
  return data as OneoffTask
}

export async function toggleOneoffDone(userId: string, taskId: string, currentlyDone: boolean): Promise<void> {
  const { error } = await supabase
    .from('planner_oneoff')
    .update({ done_at: currentlyDone ? null : new Date().toISOString() })
    .eq('id', taskId)
    .eq('user_id', userId);

  if (error) {
    console.error('Error toggling one-time task:', error);
  }
}

export async function deleteOneoffTask(userId: string, taskId: string): Promise<void> {
  const { error } = await supabase
    .from('planner_oneoff')
    .delete()
    .eq('id', taskId)
    .eq('user_id', userId);

  if (error) {
    console.error('Error deleting one-time task:', error);
  }
}

export async function cleanupOldOneoff(userId: string): Promise<number> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  
  const { data, error } = await supabase
    .from('planner_oneoff')
    .delete()
    .eq('user_id', userId)
    .not('done_at', 'is', null)
    .lt('done_at', sevenDaysAgo)
    .select('id');

  if (error) {
    console.error('Error cleaning up one-time tasks:', error);
    return 0;
  }
  
  return data?.length || 0;
}
