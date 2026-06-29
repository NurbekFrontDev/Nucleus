import { supabase } from './supabase'

// ====================================================================
// Модуль логики Планировщика (общий для всех экранов планировщика).
// П-3 использует отсюда: типы, проверку "задача попадает в этот день",
// загрузку дня, отметку выполнения и сохранение порядка задач внутри дня.
// Все суммы/деньги тут НИ ПРИ ЧЁМ -- это про дела и привычки.
// ====================================================================

// Приоритет важности дела. По задумке пользователя:
//   high   -> 🔴 очень важно (делать первым)
//   medium -> 🟡 средне
//   low    -> 🟢 неважно
//   none   -> без метки
export type Priority = 'none' | 'low' | 'medium' | 'high'

// Тип записи: разовая/повторяющаяся задача либо привычка.
export type PlannerType = 'task' | 'habit'

// Правило повторения.
//   none     -> разовое дело (показывается только в свой start_date)
//   daily    -> каждый день
//   weekdays -> по будням (Пн..Пт)
//   weekly   -> по выбранным дням недели (см. weekdays: ISO 1=Пн..7=Вс)
export type RepeatRule = 'none' | 'daily' | 'weekdays' | 'weekly'

// Часть дня для группировки (Утро/День/Вечер). null -- без времени.
export type TimeOfDay = 'morning' | 'day' | 'evening' | null

// Статус отметки за конкретный день.
export type LogStatus = 'done' | 'skip' | 'fail'

export type PlannerItem = {
  id: string
  title: string
  note: string | null
  type: PlannerType
  repeat_rule: RepeatRule
  weekdays: number[] | null
  time_of_day: TimeOfDay
  at_time_start: string | null
  at_time_end: string | null
  priority: Priority
  start_date: string | null
  icon: string | null
  color: string | null
  archived: boolean
  sort_order: number
}

export type PlannerLog = {
  id: string
  item_id: string
  date: string
  status: LogStatus
  value: number | null
  note: string | null
}

// Набор колонок для запросов (держим в одном месте, чтобы не расходились).
export const ITEM_COLS =
  'id, title, note, type, repeat_rule, weekdays, time_of_day, at_time_start, at_time_end, priority, start_date, icon, color, archived, sort_order'
export const LOG_COLS = 'id, item_id, date, status, value, note'

// Эмодзи-кружок важности для UI. Для none -- пусто.
export const PRIORITY_DOT: Record<Priority, string> = {
  high: '🔴',
  medium: '🟡',
  low: '🟢',
  none: '',
}

// Порядок важности сверху вниз (для сортировки и будущей геймификации).
export const PRIORITY_RANK: Record<Priority, number> = {
  high: 0,
  medium: 1,
  low: 2,
  none: 3,
}

// ===== Даты в локальном часовом поясе (без UTC-сдвига) =====
// Важно: НЕ используем toISOString() для дня, иначе ночью дата "уезжает".
function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

// Date -> 'YYYY-MM-DD' по местному времени.
export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

// Сегодняшняя дата строкой 'YYYY-MM-DD' (местное время).
export function todayStr(): string {
  return toDateStr(new Date())
}

// Прибавить n дней к 'YYYY-MM-DD' (можно отрицательное).
export function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return toDateStr(d)
}

// День недели по ISO: 1=Пн .. 7=Вс.
export function isoWeekday(dateStr: string): number {
  const js = new Date(dateStr + 'T00:00:00').getDay() // 0=Вс..6=Сб
  return js === 0 ? 7 : js
}

// Попадает ли дело в указанный день (с учётом правила повторения и старта).
export function isItemOnDate(item: PlannerItem, dateStr: string): boolean {
  if (item.archived) return false
  // До даты начала дело ещё "не существует".
  if (item.start_date && dateStr < item.start_date) return false
  const wd = isoWeekday(dateStr)
  switch (item.repeat_rule) {
    case 'daily':
      return true
    case 'weekdays':
      return wd >= 1 && wd <= 5
    case 'weekly':
      return Array.isArray(item.weekdays) && item.weekdays.includes(wd)
    case 'none':
    default:
      // Разовое: показываем только в его собственный день.
      return !!item.start_date && item.start_date === dateStr
  }
}

export type DayData = {
  items: PlannerItem[] // дела этого дня в нужном порядке
  logs: Record<string, PlannerLog> // itemId -> отметка за этот день
}

// Загружает все дела пользователя, отбирает попадающие в этот день, подтягивает
// отметки и ручной порядок именно для этого дня, и сортирует список.
export async function loadDay(userId: string, dateStr: string): Promise<DayData> {
  const [itemsRes, logsRes, orderRes] = await Promise.all([
    supabase
      .from('planner_items')
      .select(ITEM_COLS)
      .eq('user_id', userId)
      .eq('archived', false),
    supabase
      .from('planner_logs')
      .select(LOG_COLS)
      .eq('user_id', userId)
      .eq('date', dateStr),
    supabase
      .from('planner_day_order')
      .select('item_id, sort_order')
      .eq('user_id', userId)
      .eq('date', dateStr),
  ])
  if (itemsRes.error) throw itemsRes.error
  if (logsRes.error) throw logsRes.error
  if (orderRes.error) throw orderRes.error

  const all = (itemsRes.data ?? []) as PlannerItem[]
  const occurring = all.filter((it) => isItemOnDate(it, dateStr))

  // Ручной порядок дня (если задавали перетаскиванием) имеет приоритет.
  const orderMap = new Map<string, number>()
  for (const o of (orderRes.data ?? []) as { item_id: string; sort_order: number }[]) {
    orderMap.set(o.item_id, o.sort_order)
  }
  const BIG = 1_000_000
  occurring.sort((a, b) => {
    const ao = orderMap.has(a.id) ? (orderMap.get(a.id) as number) : BIG + (a.sort_order ?? 0)
    const bo = orderMap.has(b.id) ? (orderMap.get(b.id) as number) : BIG + (b.sort_order ?? 0)
    if (ao !== bo) return ao - bo
    // При равенстве -- по важности (красные выше), затем по названию.
    const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    if (pr !== 0) return pr
    return a.title.localeCompare(b.title)
  })

  const logs: Record<string, PlannerLog> = {}
  for (const l of (logsRes.data ?? []) as PlannerLog[]) logs[l.item_id] = l

  return { items: occurring, logs }
}

// Отметить/снять выполнение дела за день.
//   isDone=true  -> сейчас выполнено, значит снимаем отметку (удаляем лог за день)
//   isDone=false -> ставим отметку "выполнено" (upsert по уникальному ключу дня)
// Возвращает новый лог или null (если сняли отметку).
export async function toggleDone(
  userId: string,
  itemId: string,
  dateStr: string,
  isDone: boolean,
): Promise<PlannerLog | null> {
  if (isDone) {
    const { error } = await supabase
      .from('planner_logs')
      .delete()
      .eq('user_id', userId)
      .eq('item_id', itemId)
      .eq('date', dateStr)
    if (error) throw error
    return null
  }
  const { data, error } = await supabase
    .from('planner_logs')
    .upsert(
      { user_id: userId, item_id: itemId, date: dateStr, status: 'done' },
      { onConflict: 'user_id,item_id,date' },
    )
    .select(LOG_COLS)
    .single()
  if (error) throw error
  return data as PlannerLog
}

// Сохраняет ручной порядок дел внутри конкретного дня.
export async function saveDayOrder(
  userId: string,
  dateStr: string,
  orderedIds: string[],
): Promise<void> {
  if (orderedIds.length === 0) return
  const rows = orderedIds.map((id, i) => ({
    user_id: userId,
    item_id: id,
    date: dateStr,
    sort_order: i + 1,
  }))
  const { error } = await supabase
    .from('planner_day_order')
    .upsert(rows, { onConflict: 'user_id,item_id,date' })
  if (error) throw error
}

// ===== Настройка: разбивать день на Утро/День/Вечер =====
export async function loadDaySections(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('planner_day_sections')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return false
  return !!(data as { planner_day_sections?: boolean } | null)?.planner_day_sections
}

export async function saveDaySections(userId: string, value: boolean): Promise<void> {
  await supabase
    .from('app_settings')
    .upsert(
      { user_id: userId, planner_day_sections: value, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
}
