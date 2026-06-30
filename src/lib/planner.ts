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
  important: boolean
  archived: boolean
  sort_order: number
  // поля привычек (по «Атомным привычкам»), значимы только для type='habit'
  cue: string | null
  identity: string | null
  two_min: string | null
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
  'id, title, note, type, repeat_rule, weekdays, time_of_day, at_time_start, at_time_end, priority, start_date, icon, color, important, archived, sort_order, cue, identity, two_min'
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

// ===== Матрица Эйзенхауэра (П-8): срочность × важность =====
// Срочность берём из метки важности-цвета (🔴 high = срочно), а «важность»
// для матрицы — это отдельная отметка important (двигает к большой цели).
export type Quadrant = 'q1' | 'q2' | 'q3' | 'q4'

// Срочное дело = помечено красным (high). Остальное считаем несрочным.
export function isUrgent(item: PlannerItem): boolean {
  return item.priority === 'high'
}

// Квадрант дела: q1 срочно+важно, q2 важно (рост), q3 срочная суета, q4 мелочь.
export function itemQuadrant(item: PlannerItem): Quadrant {
  const urgent = isUrgent(item)
  const important = !!item.important
  if (important && urgent) return 'q1'
  if (important && !urgent) return 'q2'
  if (!important && urgent) return 'q3'
  return 'q4'
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

// ====================================================================
// CRUD дел (для экрана «Мои дела», П-4): создание, изменение, мягкое
// удаление и загрузка полного списка дел пользователя.
// ====================================================================

// Поля, которые пользователь задаёт при создании/редактировании дела.
export type ItemInput = {
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
  important?: boolean
  // поля привычек (только для type='habit'; для обычных дел остаются пустыми)
  cue?: string | null
  identity?: string | null
  two_min?: string | null
}

// Загружает все НЕ архивированные дела пользователя (для списка «Мои дела»).
export async function loadAllItems(userId: string): Promise<PlannerItem[]> {
  const { data, error } = await supabase
    .from('planner_items')
    .select(ITEM_COLS)
    .eq('user_id', userId)
    .eq('archived', false)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as PlannerItem[]
}

// Готовит строку для базы. weekdays нужны только для repeat_rule='weekly'.
function itemRow(input: ItemInput) {
  return {
    title: input.title,
    note: input.note,
    type: input.type,
    repeat_rule: input.repeat_rule,
    weekdays: input.repeat_rule === 'weekly' ? input.weekdays : [],
    time_of_day: input.time_of_day,
    at_time_start: input.at_time_start,
    at_time_end: input.at_time_end,
    priority: input.priority,
    start_date: input.start_date || todayStr(),
    icon: input.icon,
    important: input.important ?? false,
    // поля привычек: для обычных дел приходят пустыми -> null
    cue: input.cue ?? null,
    identity: input.identity ?? null,
    two_min: input.two_min ?? null,
  }
}

// Создаёт новое дело и возвращает его.
export async function createItem(userId: string, input: ItemInput): Promise<PlannerItem> {
  const { data, error } = await supabase
    .from('planner_items')
    .insert({ user_id: userId, ...itemRow(input) })
    .select(ITEM_COLS)
    .single()
  if (error) throw error
  return data as PlannerItem
}

// Обновляет существующее дело и возвращает его.
export async function updateItem(
  userId: string,
  id: string,
  input: ItemInput,
): Promise<PlannerItem> {
  const { data, error } = await supabase
    .from('planner_items')
    .update(itemRow(input))
    .eq('user_id', userId)
    .eq('id', id)
    .select(ITEM_COLS)
    .single()
  if (error) throw error
  return data as PlannerItem
}

// Мягко удаляет дело (archived=true): оно пропадает из списков, но отметки
// о выполнении в planner_logs остаются для истории и статистики.
export async function archiveItem(userId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from('planner_items')
    .update({ archived: true })
    .eq('user_id', userId)
    .eq('id', id)
  if (error) throw error
}

// ====================================================================
// Привычки (П-5, по «Атомным привычкам»): отметка статуса за день,
// загрузка привычек со стриками и расчёт стрика.
// Правило стрика (выбрано пользователем):
//   done -> сделано, наращивает стрик 🔥
//   skip -> осознанный пропуск: ЗАМОРАЖИВАЕТ стрик (не рвёт, но и не растит)
//   прошедший запланированный день без отметки -> стрик обнуляется
//   сегодня без отметки -> день ещё не закрыт, стрик не рвётся
//   после пропуска показываем предупреждение «не пропускай дважды»
// ====================================================================

export type HabitChainCell = {
  date: string
  status: 'done' | 'skip' | 'miss' | 'pending'
}

export type HabitStats = {
  item: PlannerItem
  current: number // текущий стрик
  best: number // лучший стрик
  pct: number // % выполнения за последние 30 запланированных дней
  todayStatus: LogStatus | null
  todayScheduled: boolean
  warnNeverTwice: boolean // показать предупреждение «не пропускай дважды»
  chain: HabitChainCell[] // последние ~14 запланированных дней (старые слева)
}

// Запланированные даты привычки от endDate назад (новые первыми).
function scheduledDatesDesc(item: PlannerItem, endDate: string, maxBack: number): string[] {
  const dates: string[] = []
  let d = endDate
  for (let i = 0; i <= maxBack; i++) {
    if (item.start_date && d < item.start_date) break
    if (isItemOnDate(item, d)) dates.push(d)
    d = addDays(d, -1)
  }
  return dates
}

// Считает стрик и статистику привычки по её отметкам (date -> status).
function computeHabitStats(
  item: PlannerItem,
  statusByDate: Record<string, LogStatus>,
): HabitStats {
  const today = todayStr()
  const dates = scheduledDatesDesc(item, today, 400) // новые первыми

  // Текущий стрик: идём от сегодня назад.
  let current = 0
  for (const date of dates) {
    const st = statusByDate[date]
    if (st === 'done') {
      current++
      continue
    }
    if (st === 'skip') continue // заморозка
    if (date === today) continue // сегодня ещё не закрыто -- не рвём
    break // прошедший день без выполнения -> стрик кончился
  }

  // Лучший стрик: проходим от старых дней к новым.
  let best = 0
  let run = 0
  for (let i = dates.length - 1; i >= 0; i--) {
    const date = dates[i]
    const st = statusByDate[date]
    if (st === 'done') {
      run++
      if (run > best) best = run
    } else if (st === 'skip') {
      // заморозка: run сохраняется
    } else if (date === today) {
      // день не закрыт -- не сбрасываем
    } else {
      run = 0
    }
  }
  if (current > best) best = current

  // % за последние 30 запланированных дней (пропуски не штрафуют).
  let done = 0
  let missed = 0
  for (const date of dates.slice(0, 30)) {
    const st = statusByDate[date]
    if (date === today && !st) continue // сегодня не закрыто
    if (st === 'done') done++
    else if (st === 'skip') continue
    else missed++
  }
  const pct = done + missed > 0 ? Math.round((done / (done + missed)) * 100) : 0

  // Цепочка последних 14 запланированных дней (старые слева).
  const chain: HabitChainCell[] = dates
    .slice(0, 14)
    .reverse()
    .map((date) => {
      const st = statusByDate[date]
      let status: HabitChainCell['status']
      if (st === 'done') status = 'done'
      else if (st === 'skip') status = 'skip'
      else if (date === today) status = 'pending'
      else status = 'miss'
      return { date, status }
    })

  // «Не пропускай дважды»: прошлый запланированный день не сделан, сегодня
  // запланировано и пока не отмечено выполненным.
  const todayScheduled = dates.includes(today)
  const todayStatus = statusByDate[today] ?? null
  const prevDate = dates.find((d) => d < today)
  const prevMissed = prevDate ? statusByDate[prevDate] !== 'done' : false
  const warnNeverTwice = prevMissed && todayScheduled && todayStatus !== 'done'

  return {
    item,
    current,
    best,
    pct,
    todayStatus,
    todayScheduled,
    warnNeverTwice,
    chain,
  }
}

// Загружает привычки пользователя со статистикой стриков.
export async function loadHabits(userId: string): Promise<HabitStats[]> {
  const cutoff = addDays(todayStr(), -400)
  const [itemsRes, logsRes] = await Promise.all([
    supabase
      .from('planner_items')
      .select(ITEM_COLS)
      .eq('user_id', userId)
      .eq('type', 'habit')
      .eq('archived', false)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('planner_logs')
      .select(LOG_COLS)
      .eq('user_id', userId)
      .gte('date', cutoff),
  ])
  if (itemsRes.error) throw itemsRes.error
  if (logsRes.error) throw logsRes.error

  const habits = (itemsRes.data ?? []) as PlannerItem[]
  const byItem = new Map<string, Record<string, LogStatus>>()
  for (const l of (logsRes.data ?? []) as PlannerLog[]) {
    let m = byItem.get(l.item_id)
    if (!m) {
      m = {}
      byItem.set(l.item_id, m)
    }
    m[l.date] = l.status
  }
  return habits.map((h) => computeHabitStats(h, byItem.get(h.id) ?? {}))
}

// Ставит/снимает статус привычки за день (done/skip); null -> убрать отметку.
export async function setHabitStatus(
  userId: string,
  itemId: string,
  dateStr: string,
  status: 'done' | 'skip' | null,
): Promise<void> {
  if (status === null) {
    const { error } = await supabase
      .from('planner_logs')
      .delete()
      .eq('user_id', userId)
      .eq('item_id', itemId)
      .eq('date', dateStr)
    if (error) throw error
    return
  }
  const { error } = await supabase
    .from('planner_logs')
    .upsert(
      { user_id: userId, item_id: itemId, date: dateStr, status },
      { onConflict: 'user_id,item_id,date' },
    )
  if (error) throw error
}

// ====================================================================
// Детали привычки для окна в стиле Atoms (П-5, переделка):
// полная карта отметок (для мини-календаря и редактирования истории),
// всего повторений, стрик/рекорд, процент (недавно и за всё время),
// и рефлексия (заметки о прогрессе).
// ====================================================================

export type HabitReflection = {
  id: string
  item_id: string
  date: string
  text: string
}

export type HabitDetail = {
  item: PlannerItem
  statusByDate: Record<string, LogStatus> // дата -> статус (для календаря/истории)
  totalDone: number // всего выполнено (повторений)
  current: number // текущий стрик
  best: number // лучший стрик
  pctRecent: number // % за последние 30 запланированных дней
  pctAll: number // % за всё время
  sinceDate: string // с какого дня считаем (старт привычки)
  reflections: HabitReflection[]
}

// Полная статистика привычки за всё время (для окна привычки).
function computeHabitDetail(
  item: PlannerItem,
  statusByDate: Record<string, LogStatus>,
  reflections: HabitReflection[],
): HabitDetail {
  const today = todayStr()
  const dates = scheduledDatesDesc(item, today, 1500) // новые первыми, за всё время

  // Текущий стрик: от сегодня назад.
  let current = 0
  for (const date of dates) {
    const st = statusByDate[date]
    if (st === 'done') {
      current++
      continue
    }
    if (st === 'skip') continue
    if (date === today) continue
    break
  }

  // Лучший стрик: от старых дней к новым.
  let best = 0
  let run = 0
  for (let i = dates.length - 1; i >= 0; i--) {
    const date = dates[i]
    const st = statusByDate[date]
    if (st === 'done') {
      run++
      if (run > best) best = run
    } else if (st === 'skip') {
      // заморозка
    } else if (date === today) {
      // не закрыт
    } else {
      run = 0
    }
  }
  if (current > best) best = current

  // Проценты: недавно (30 дней) и за всё время (пропуски не штрафуют).
  const ratio = (slice: string[]): number => {
    let done = 0
    let missed = 0
    for (const date of slice) {
      const st = statusByDate[date]
      if (date === today && !st) continue
      if (st === 'done') done++
      else if (st === 'skip') continue
      else missed++
    }
    return done + missed > 0 ? Math.round((done / (done + missed)) * 100) : 0
  }
  const pctRecent = ratio(dates.slice(0, 30))
  const pctAll = ratio(dates)

  // Всего повторений = число выполненных отметок.
  let totalDone = 0
  for (const d of Object.keys(statusByDate)) if (statusByDate[d] === 'done') totalDone++

  const sinceDate = item.start_date ?? (dates.length ? dates[dates.length - 1] : today)

  return {
    item,
    statusByDate,
    totalDone,
    current,
    best,
    pctRecent,
    pctAll,
    sinceDate,
    reflections,
  }
}

// Загружает все данные одной привычки для окна привычки.
export async function loadHabitDetail(userId: string, itemId: string): Promise<HabitDetail> {
  const [itemRes, logsRes, reflRes] = await Promise.all([
    supabase
      .from('planner_items')
      .select(ITEM_COLS)
      .eq('user_id', userId)
      .eq('id', itemId)
      .single(),
    supabase.from('planner_logs').select(LOG_COLS).eq('user_id', userId).eq('item_id', itemId),
    supabase
      .from('planner_reflections')
      .select('id, item_id, date, text')
      .eq('user_id', userId)
      .eq('item_id', itemId)
      .order('date', { ascending: false }),
  ])
  if (itemRes.error) throw itemRes.error
  if (logsRes.error) throw logsRes.error
  if (reflRes.error) throw reflRes.error
  const item = itemRes.data as PlannerItem
  const statusByDate: Record<string, LogStatus> = {}
  for (const l of (logsRes.data ?? []) as PlannerLog[]) statusByDate[l.date] = l.status
  const reflections = (reflRes.data ?? []) as HabitReflection[]
  return computeHabitDetail(item, statusByDate, reflections)
}

// Добавляет заметку-рефлексию о прогрессе привычки.
export async function addReflection(userId: string, itemId: string, text: string): Promise<void> {
  const { error } = await supabase
    .from('planner_reflections')
    .insert({ user_id: userId, item_id: itemId, date: todayStr(), text })
  if (error) throw error
}

// Удаляет заметку-рефлексию.
export async function deleteReflection(userId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from('planner_reflections')
    .delete()
    .eq('user_id', userId)
    .eq('id', id)
  if (error) throw error
}

// ====================================================================
// Календарь (П-6): сводка по каждому дню за период для обзорных видов
// (Месяц / Неделя / Год). На каждый день — сколько дел, сколько выполнено
// и метки для цветных полосок (важность + признак выполнения).
// ====================================================================

export type DayMark = {
  priority: Priority
  done: boolean
  habit: boolean
}

export type DaySummary = {
  total: number
  done: number
  marks: DayMark[]
}

// Считает сводку по каждому дню в диапазоне [startDate, endDate] включительно.
// Дела загружаются один раз, попадание в каждый день проверяется локально.
export async function loadDaySummaries(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<Record<string, DaySummary>> {
  const [itemsRes, logsRes] = await Promise.all([
    supabase.from('planner_items').select(ITEM_COLS).eq('user_id', userId).eq('archived', false),
    supabase
      .from('planner_logs')
      .select(LOG_COLS)
      .eq('user_id', userId)
      .gte('date', startDate)
      .lte('date', endDate),
  ])
  if (itemsRes.error) throw itemsRes.error
  if (logsRes.error) throw logsRes.error

  const items = (itemsRes.data ?? []) as PlannerItem[]
  // дата -> (itemId -> статус)
  const logsByDate = new Map<string, Record<string, LogStatus>>()
  for (const l of (logsRes.data ?? []) as PlannerLog[]) {
    let m = logsByDate.get(l.date)
    if (!m) {
      m = {}
      logsByDate.set(l.date, m)
    }
    m[l.item_id] = l.status
  }

  // Сортируем по важности, чтобы цветные полоски шли в осмысленном порядке.
  const sorted = items.slice().sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])

  const out: Record<string, DaySummary> = {}
  let d = startDate
  while (d <= endDate) {
    const dayLogs = logsByDate.get(d) ?? {}
    const marks: DayMark[] = []
    let done = 0
    for (const it of sorted) {
      if (!isItemOnDate(it, d)) continue
      const isDone = dayLogs[it.id] === 'done'
      if (isDone) done++
      marks.push({ priority: it.priority, done: isDone, habit: it.type === 'habit' })
    }
    if (marks.length > 0) out[d] = { total: marks.length, done, marks }
    d = addDays(d, 1)
  }
  return out
}

// ====================================================================
// Помодоро (П-7): таймер фокуса 25/5 с длинным перерывом.
// Настройки таймера живут в app_settings (pomo_*), а сами завершённые
// сессии пишутся в pomodoro_sessions для честной статистики фокуса.
// ====================================================================

// Фаза таймера: фокус, короткий перерыв, длинный перерыв.
export type PomoKind = 'focus' | 'break' | 'long_break'

export type PomoSettings = {
  focusMin: number // длительность фокуса, мин
  breakMin: number // короткий перерыв, мин
  longBreakMin: number // длинный перерыв, мин
  cycles: number // сколько фокусов до длинного перерыва
  sound: string // идентификатор звука сигнала окончания фазы
  volume: number // громкость сигнала, 0-100
}

export const POMO_DEFAULTS: PomoSettings = {
  focusMin: 25,
  breakMin: 5,
  longBreakMin: 15,
  cycles: 4,
  sound: 'chime',
  volume: 100,
}

// Загружает настройки таймера; при отсутствии строки — значения по умолчанию.
export async function loadPomoSettings(userId: string): Promise<PomoSettings> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('pomo_focus_min, pomo_break_min, pomo_long_break_min, pomo_cycles, pomo_sound, pomo_volume')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data) return { ...POMO_DEFAULTS }
  const row = data as {
    pomo_focus_min?: number | null
    pomo_break_min?: number | null
    pomo_long_break_min?: number | null
    pomo_cycles?: number | null
    pomo_sound?: string | null
    pomo_volume?: number | null
  }
  return {
    focusMin: row.pomo_focus_min ?? POMO_DEFAULTS.focusMin,
    breakMin: row.pomo_break_min ?? POMO_DEFAULTS.breakMin,
    longBreakMin: row.pomo_long_break_min ?? POMO_DEFAULTS.longBreakMin,
    cycles: row.pomo_cycles ?? POMO_DEFAULTS.cycles,
    sound: row.pomo_sound ?? POMO_DEFAULTS.sound,
    volume: row.pomo_volume ?? POMO_DEFAULTS.volume,
  }
}

// Сохраняет настройки таймера (upsert строки app_settings пользователя).
export async function savePomoSettings(userId: string, s: PomoSettings): Promise<void> {
  const { error } = await supabase.from('app_settings').upsert(
    {
      user_id: userId,
      pomo_focus_min: s.focusMin,
      pomo_break_min: s.breakMin,
      pomo_long_break_min: s.longBreakMin,
      pomo_cycles: s.cycles,
      pomo_sound: s.sound,
      pomo_volume: s.volume,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )
  if (error) throw error
}

// Записывает завершённую сессию Помодоро (для статистики фокуса).
export async function logPomodoro(
  userId: string,
  args: { kind: PomoKind; durationMin: number; itemId?: string | null; completed: boolean },
): Promise<void> {
  const { error } = await supabase.from('pomodoro_sessions').insert({
    user_id: userId,
    item_id: args.itemId ?? null,
    duration_min: args.durationMin,
    kind: args.kind,
    completed: args.completed,
  })
  if (error) throw error
}

export type PomoToday = {
  focusCount: number // завершённых фокус-сессий сегодня
  focusMin: number // суммарно минут фокуса сегодня
}

// Считает фокус-статистику за сегодня по локальным границам дня.
export async function loadPomoToday(userId: string): Promise<PomoToday> {
  const startIso = new Date(todayStr() + 'T00:00:00').toISOString()
  const endIso = new Date(todayStr() + 'T23:59:59').toISOString()
  const { data, error } = await supabase
    .from('pomodoro_sessions')
    .select('duration_min')
    .eq('user_id', userId)
    .eq('kind', 'focus')
    .eq('completed', true)
    .gte('started_at', startIso)
    .lte('started_at', endIso)
  if (error) throw error
  const rows = (data ?? []) as { duration_min: number | null }[]
  let focusMin = 0
  for (const r of rows) focusMin += r.duration_min ?? 0
  return { focusCount: rows.length, focusMin }
}
