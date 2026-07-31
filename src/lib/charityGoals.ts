// Крупные цели благотворительности списком (миграция migration-charity-goals.sql).
// Устроено как на странице «Цели»: одна главная цель и сколько угодно второстепенных.
import { supabase } from './supabase'

export type CharityGoal = {
  id: string
  name: string
  target: number
  is_primary: boolean
  sort_order: number
}

const COLS = 'id, name, target, is_primary, sort_order'

/** Все цели пользователя: главная всегда первой, дальше ручной порядок. */
export async function loadCharityGoals(userId: string): Promise<CharityGoal[]> {
  const { data, error } = await supabase
    .from('charity_goals')
    .select(COLS)
    .eq('user_id', userId)
    .eq('archived', false)
    .order('is_primary', { ascending: false })
    .order('sort_order', { ascending: true })
  if (error) throw error
  return (data ?? []).map((r) => ({ ...r, target: Number(r.target) })) as CharityGoal[]
}

export async function createCharityGoal(
  userId: string,
  name: string,
  target: number,
  makePrimary: boolean,
): Promise<CharityGoal> {
  // Первая цель автоматически становится главной.
  const existing = await loadCharityGoals(userId)
  const primary = makePrimary || existing.length === 0
  if (primary) await clearPrimary(userId)
  const sort = existing.reduce((m, g) => Math.max(m, g.sort_order), 0) + 1
  const { data, error } = await supabase
    .from('charity_goals')
    .insert({ user_id: userId, name, target, is_primary: primary, sort_order: sort })
    .select(COLS)
    .single()
  if (error || !data) throw error ?? new Error('charity goal insert failed')
  return { ...data, target: Number(data.target) } as CharityGoal
}

export async function updateCharityGoal(
  goalId: string,
  patch: { name?: string; target?: number },
): Promise<void> {
  const { error } = await supabase.from('charity_goals').update(patch).eq('id', goalId)
  if (error) throw error
}

/** Снять звёздочку со всех целей — нужно из-за unique index на is_primary. */
async function clearPrimary(userId: string): Promise<void> {
  const { error } = await supabase
    .from('charity_goals')
    .update({ is_primary: false })
    .eq('user_id', userId)
    .eq('is_primary', true)
  if (error) throw error
}

/** Сделать цель главной (⭐). Прежняя главная становится второстепенной. */
export async function setPrimaryCharityGoal(userId: string, goalId: string): Promise<void> {
  await clearPrimary(userId)
  const { error } = await supabase
    .from('charity_goals')
    .update({ is_primary: true })
    .eq('id', goalId)
  if (error) throw error
}

/**
 * Удаление цели. Сами пополнения НЕ трогаем: деньги остаются в копилке,
 * у записей charity_goal_id обнуляется (on delete set null) и они учитываются у главной.
 */
export async function deleteCharityGoal(userId: string, goalId: string): Promise<void> {
  const { error } = await supabase.from('charity_goals').delete().eq('id', goalId)
  if (error) throw error
  // Если удалили главную — главной становится следующая по порядку.
  const rest = await loadCharityGoals(userId)
  if (rest.length > 0 && !rest.some((g) => g.is_primary)) {
    await setPrimaryCharityGoal(userId, rest[0].id)
  }
}

/**
 * Сколько собрано по каждой цели.
 * Записи без charity_goal_id (старые, до миграции) относятся к главной цели.
 */
export function collectedByGoal(
  items: Array<{ amount: number; charity_goal_id: string | null; paid_from_pot: string | null }>,
  goals: CharityGoal[],
): Record<string, number> {
  const primaryId = goals.find((g) => g.is_primary)?.id ?? null
  const known = new Set(goals.map((g) => g.id))
  const acc: Record<string, number> = {}
  for (const g of goals) acc[g.id] = 0
  for (const it of items) {
    if (it.paid_from_pot) continue
    const id =
      it.charity_goal_id && known.has(it.charity_goal_id) ? it.charity_goal_id : primaryId
    if (!id) continue
    acc[id] = (acc[id] ?? 0) + Number(it.amount)
  }
  return acc
}
