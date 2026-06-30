import { supabase } from './supabase'
import { addDays } from './planner'

// ====================================================================
// Трекер питьевой воды (💧). Вдохновлён WaterMinder / MapMyRun.
// Цель в app_settings (water_goal, мл), логи в water_logs.
// ====================================================================

export type WaterDay = {
  goal: number
  drunk: number
  logs: WaterLog[]
}

export type WaterLog = {
  id: string
  date: string
  amount: number
  created_at: string
}

const DEFAULT_GOAL = 2000

export async function loadWaterGoal(userId: string): Promise<number> {
  const { data } = await supabase
    .from('app_settings')
    .select('water_goal')
    .eq('user_id', userId)
    .maybeSingle()
  const v = (data as { water_goal?: number } | null)?.water_goal
  return typeof v === 'number' && v > 0 ? v : DEFAULT_GOAL
}

export async function saveWaterGoal(userId: string, goal: number): Promise<void> {
  await supabase.from('app_settings').upsert(
    { user_id: userId, water_goal: goal, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  )
}

export async function loadWaterDay(userId: string, date: string): Promise<WaterDay> {
  const [goal, { data: logs }] = await Promise.all([
    loadWaterGoal(userId),
    supabase
      .from('water_logs')
      .select('id, date, amount, created_at')
      .eq('user_id', userId)
      .eq('date', date)
      .order('created_at', { ascending: false }),
  ])
  const list = (logs ?? []) as WaterLog[]
  const drunk = list.reduce((s, l) => s + Number(l.amount), 0)
  return { goal, drunk, logs: list }
}

export async function addWaterLog(
  userId: string,
  date: string,
  amount: number,
): Promise<WaterLog> {
  const { data, error } = await supabase
    .from('water_logs')
    .insert({ user_id: userId, date, amount })
    .select('id, date, amount, created_at')
    .single()
  if (error) throw error
  return data as WaterLog
}

export async function removeWaterLog(userId: string, id: string): Promise<void> {
  await supabase.from('water_logs').delete().eq('user_id', userId).eq('id', id)
}

// Быстрые объёмы (как «чашки» в WaterMinder)
export const QUICK_VOLUMES = [150, 250, 330, 500]

// Загружает суммы выпитого по дням за произвольный диапазон (неделя / месяц).
export async function loadWaterRange(
  userId: string,
  start: string,
  end: string,
): Promise<Record<string, number>> {
  const { data } = await supabase
    .from('water_logs')
    .select('date, amount')
    .eq('user_id', userId)
    .gte('date', start)
    .lte('date', end)
  const out: Record<string, number> = {}
  for (const row of (data ?? []) as { date: string; amount: number }[]) {
    out[row.date] = (out[row.date] ?? 0) + Number(row.amount)
  }
  return out
}

// Загружает сводку выпитого за 7 дней (для мини-истории).
export async function loadWaterWeek(
  userId: string,
  endDate: string,
): Promise<Record<string, number>> {
  return loadWaterRange(userId, addDays(endDate, -6), endDate)
}
