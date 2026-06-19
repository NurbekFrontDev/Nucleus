import { supabase } from './supabase'

export type MonthRow = {
  id: string
  user_id: string
  year: number
  month: number
  planned_income: number
}

// Находит месяц пользователя или создаёт его, если ещё нет.
export async function getOrCreateMonth(
  userId: string,
  year: number,
  month: number,
): Promise<MonthRow> {
  const { data: existing, error } = await supabase
    .from('months')
    .select('*')
    .eq('user_id', userId)
    .eq('year', year)
    .eq('month', month)
    .maybeSingle()
  if (error) throw error
  if (existing) return existing as MonthRow

  const { data: created, error: insErr } = await supabase
    .from('months')
    .insert({ user_id: userId, year, month, planned_income: 0 })
    .select('*')
    .single()
  if (insErr) throw insErr
  return created as MonthRow
}

// ===== Язык форматирования (управляется i18n через setDbLang) =====
type DbLang = 'ru' | 'en'
let dbLang: DbLang = 'ru'
export function setDbLang(lang: DbLang) {
  dbLang = lang
}

const MONTH_NAMES_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]
const MONTH_NAMES_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// Названия месяцев в родительном падеже (для дат: «15 октября 2026»).
const MONTH_NAMES_GEN_RU = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]

// Обратная совместимость: статический экспорт (русский). Для UI используйте monthName().
export const MONTH_NAMES = MONTH_NAMES_RU
export const MONTH_NAMES_GEN = MONTH_NAMES_GEN_RU

// Название месяца с учётом текущего языка. i — 0..11.
export function monthName(i: number): string {
  return (dbLang === 'en' ? MONTH_NAMES_EN : MONTH_NAMES_RU)[i] ?? ''
}

// Название месяца в родительном падеже (для дат). В английском падежей нет.
export function monthGen(i: number): string {
  return (dbLang === 'en' ? MONTH_NAMES_EN : MONTH_NAMES_GEN_RU)[i] ?? ''
}

// Форматирует дату YYYY-MM-DD в читаемый вид: «15 октября 2026» / «15 October 2026».
export function formatDateHuman(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  const parts = dateStr.split('-')
  if (parts.length < 3) return dateStr
  const y = Number(parts[0])
  const m = Number(parts[1])
  const d = Number(parts[2])
  if (!y || !m || !d) return dateStr
  return `${d} ${monthGen(m - 1)} ${y}`
}

// Форматирует число как сумму в долларах: «$5 000.00» / «$5,000.00».
export function formatSum(value: number): string {
  const locale = dbLang === 'en' ? 'en-US' : 'ru-RU'
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0)
  return '$' + formatted
}

// Форматирует ввод суммы с пробелами по тысячам и копейками (до 2 знаков):
// "1000000" -> "1 000 000", "1234.5" -> "1 234.5".
export function formatAmountInput(raw: string): string {
  // оставляем только цифры и один разделитель дробной части (точку/запятую -> точку)
  let s = String(raw).replace(/,/g, '.').replace(/[^\d.]/g, '')
  if (s === '') return ''
  const firstDot = s.indexOf('.')
  if (firstDot !== -1) {
    // оставляем только первую точку
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, '')
  }
  const parts = s.split('.')
  let intPart = (parts[0] ?? '').replace(/^0+(?=\d)/, '')
  if (intPart === '') intPart = '0'
  const intFmt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  if (parts.length < 2) return intFmt
  return intFmt + '.' + parts[1].slice(0, 2)
}

// Парсит отформатированную сумму обратно в число (доллары с копейками).
export function parseAmount(formatted: string): number {
  const s = String(formatted).replace(/\s/g, '').replace(',', '.').replace(/[^\d.]/g, '')
  const n = Number(s)
  return isFinite(n) ? n : 0
}

// Пресеты подкатегорий расходов по названию категории (можно дополнять своими).
export const SUBCATEGORY_PRESETS: Record<string, string[]> = {
  'Обязательные': ['Аренда жилья', 'Коммуналка', 'Интернет', 'Связь', 'Продукты', 'Транспорт', 'Здоровье'],
  'Цели/Хотелки': ['Одежда', 'Кафе и рестораны', 'Развлечения', 'Путешествия', 'Техника', 'Подарки'],
  'Долги': ['Кредит', 'Рассрочка', 'Долг другу'],
  'Свободные': ['Подписки', 'Хобби', 'Разное'],
  'Сбережения': ['Подушка безопасности', 'Накопления'],
  'Инвестиции': ['Акции', 'Криптовалюта', 'Вклад'],
  'Благотворительность': ['Крупное пожертвование', 'Маленькие пожертвования'],
}

// Пресеты источников дохода (можно дополнять своими).
export const INCOME_SOURCE_PRESETS = [
  'Зарплата',
  'Аванс',
  'Фриланс',
  'Подработка',
  'Бизнес',
  'Проценты по вкладу',
  'Подарок',
  'Возврат долга',
  'Другое',
]

// ===== Локальные правки подсказок (пресетов) =====
// Пресеты подкатегорий и источников захардкожены в коде. Чтобы пользователь мог
// переименовывать/удалять НЕиспользуемые подсказки, правки храним локально (на
// устройстве) поверх встроенного списка. Значения, реально использованные в записях,
// меняются прямо в БД (см. страницы доходов/расходов) и подтягиваются как «использованные».
// Поэтому такие правки не требуют миграции и работают сразу.
type PresetOverride = { hidden: string[]; renamed: Record<string, string>; custom: string[] }

function presetKey(kind: string): string {
  return `finlit-presets-${kind}`
}

function loadOverride(kind: string): PresetOverride {
  try {
    const raw = localStorage.getItem(presetKey(kind))
    if (raw) {
      const v = JSON.parse(raw) as Partial<PresetOverride>
      return { hidden: v.hidden ?? [], renamed: v.renamed ?? {}, custom: v.custom ?? [] }
    }
  } catch {
    // битый JSON или нет localStorage — используем пустые правки
  }
  return { hidden: [], renamed: {}, custom: [] }
}

function saveOverride(kind: string, v: PresetOverride) {
  try {
    localStorage.setItem(presetKey(kind), JSON.stringify(v))
  } catch {
    // localStorage недоступен — тихо игнорируем
  }
}

// Итоговый список подсказок с учётом локальных правок (скрытые/переименованные/добавленные).
export function effectivePresets(kind: string, builtin: string[]): string[] {
  const o = loadOverride(kind)
  const out: string[] = []
  for (const b of builtin) {
    if (o.hidden.includes(b)) continue
    out.push(o.renamed[b] ?? b)
  }
  for (const c of o.custom) out.push(c)
  return Array.from(new Set(out))
}

// Переименовать подсказку. oldV — то, что показывается сейчас (встроенное или своё).
export function renamePreset(kind: string, builtin: string[], oldV: string, newV: string) {
  const v = newV.trim()
  if (!v || v === oldV) return
  const o = loadOverride(kind)
  const builtinKey = builtin.find((b) => (o.renamed[b] ?? b) === oldV)
  if (builtinKey) {
    o.renamed[builtinKey] = v
  } else {
    o.custom = o.custom.filter((c) => c !== oldV)
    if (!o.custom.includes(v)) o.custom.push(v)
  }
  saveOverride(kind, o)
}

// Убрать подсказку из списка (для встроенной — скрыть, для своей — удалить запись).
export function deletePreset(kind: string, builtin: string[], v: string) {
  const o = loadOverride(kind)
  const builtinKey = builtin.find((b) => (o.renamed[b] ?? b) === v)
  if (builtinKey) {
    if (!o.hidden.includes(builtinKey)) o.hidden.push(builtinKey)
    delete o.renamed[builtinKey]
  }
  o.custom = o.custom.filter((c) => c !== v)
  saveOverride(kind, o)
}

// ===== Мультивалюта =====
// Базовая валюта приложения. Все суммы в БД хранятся в ней (сум).
export const BASE_CURRENCY = 'UZS'

export type Currency = {
  id?: string
  code: string
  symbol: string | null
  rate_to_base: number
}

// Список популярных валют для выпадающего списка (код — латиницей, подсказки — по-русски).
export type CurrencyPreset = { code: string; symbol: string; name: string; country: string }

export const POPULAR_CURRENCIES: CurrencyPreset[] = [
  { code: 'USD', symbol: '$', name: 'Доллар', country: 'США' },
  { code: 'EUR', symbol: '€', name: 'Евро', country: 'Евросоюз' },
  { code: 'RUB', symbol: '₽', name: 'Рубль', country: 'Россия' },
  { code: 'KZT', symbol: '₸', name: 'Тенге', country: 'Казахстан' },
  { code: 'KGS', symbol: 'с', name: 'Сом', country: 'Киргизия' },
  { code: 'TRY', symbol: '₺', name: 'Лира', country: 'Турция' },
  { code: 'CNY', symbol: '¥', name: 'Юань', country: 'Китай' },
  { code: 'GBP', symbol: '£', name: 'Фунт', country: 'Великобритания' },
  { code: 'AED', symbol: 'د.إ', name: 'Дирхам', country: 'ОАЭ' },
  { code: 'KRW', symbol: '₩', name: 'Вона', country: 'Южная Корея' },
]

// Загружает валюты пользователя и гарантирует наличие базовой (сум).
export async function loadCurrencies(userId: string): Promise<Currency[]> {
  const { data, error } = await supabase
    .from('currencies')
    .select('id, code, symbol, rate_to_base')
    .eq('user_id', userId)
    .order('code')
  if (error) throw error
  const list = (data ?? []) as Currency[]
  if (!list.some((c) => c.code === BASE_CURRENCY)) {
    list.unshift({ code: BASE_CURRENCY, symbol: 'сум', rate_to_base: 1 })
  }
  return list
}

// Курс валюты к базовой (для базовой = 1).
export function rateOf(currencies: Currency[], code: string): number {
  if (code === BASE_CURRENCY) return 1
  return Number(currencies.find((c) => c.code === code)?.rate_to_base) || 1
}

// Подтягивает актуальный курс: сколько сумов стоит 1 единица валюты (code).
// Возвращает null при ошибке. Источники по приоритету: ЦБ Узбекистана (официальный,
// ближе всего к Google для сума) → currency-api → open.er-api.com.
export async function fetchRate(code: string): Promise<number | null> {
  if (code === BASE_CURRENCY) return 1
  const lower = code.toLowerCase()
  const base = BASE_CURRENCY.toLowerCase()
  // Источник № 0 (главный): серверная функция Supabase «get-rate» — как у Jarvis:
  // ходит в официальные/поисковые источники без блокировок браузера и прячет ключ.
  // Если функция задеплоена — это самый точный вариант. Иначе падаем на источники ниже.
  try {
    const { data, error } = await supabase.functions.invoke('get-rate', {
      body: { from: code, to: BASE_CURRENCY },
    })
    const r = Number((data as { rate?: number } | null)?.rate)
    if (!error && r > 0) return Math.round(r * 100) / 100
  } catch {
    // функция ещё не задеплоена — используем прямые источники
  }
  // Источник 0: Центробанк Узбекистана — официальный курс к суму, обновляется ежедневно,
  // именно его обычно показывает и Google для UZS. Без ключа, CORS-ok.
  try {
    const res = await fetch('https://cbu.uz/ru/arkhiv-kursov-valyut/json/' + code + '/')
    if (res.ok) {
      const json = await res.json()
      const rate = Number(Array.isArray(json) ? json[0]?.Rate : undefined)
      if (rate > 0) return Math.round(rate * 100) / 100
    }
  } catch {
    // пробуем следующий источник
  }
  // Источник 1: currency-api — живой курс валют, без ключа, CORS-ok (ближе к рыночному).
  const urls = [
    'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/' + lower + '.json',
    'https://latest.currency-api.pages.dev/v1/currencies/' + lower + '.json',
  ]
  for (const url of urls) {
    try {
      const res = await fetch(url)
      if (!res.ok) continue
      const json = await res.json()
      const rate = json?.[lower]?.[base]
      if (typeof rate === 'number' && rate > 0) return Math.round(rate * 100) / 100
    } catch {
      // пробуем следующий источник
    }
  }
  // Источник 2 (резерв): open.er-api.com
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/' + code)
    if (res.ok) {
      const json = await res.json()
      const rate = json?.rates?.[BASE_CURRENCY]
      if (typeof rate === 'number' && rate > 0) return Math.round(rate * 100) / 100
    }
  } catch {
    // игнорируем
  }
  return null
}

// Категории важности для списка покупок/желаний (по приоритету сверху вниз).
export const WISH_CATEGORIES = ['Обязательные', 'Цели и хотелки', 'Свободные'] as const
export type WishCategory = (typeof WISH_CATEGORIES)[number]

// Пресеты подкатегорий для списка желаний по категории важности (можно дополнять своими).
// Помогают примерно понять, что куда класть: гигиена/быт -- Обязательные, гаджеты/хобби -- Цели и хотелки.
// Услуги (парикмахер, врач) тоже сюда: для них есть подкатегории «Уход за собой», «Здоровье и врачи», «Услуги и ремонт».
export const WISH_SUBCATEGORY_PRESETS: Record<string, string[]> = {
  'Обязательные': ['Гигиена', 'Бытовая химия', 'Продукты', 'Аптека и здоровье', 'Здоровье и врачи', 'Уход за собой', 'Одежда и обувь', 'Транспорт', 'Связь и интернет', 'Услуги и ремонт', 'Дом и быт'],
  'Цели и хотелки': ['Гаджеты', 'Техника', 'Одежда и аксессуары', 'Путешествия', 'Впечатления', 'Хобби', 'Образование', 'Спорт'],
  'Свободные': ['Кафе и рестораны', 'Развлечения', 'Подписки', 'Подарки', 'Книги', 'Разное'],
}

// Сколько целых месяцев от сегодня до даты (минимум 1). 0 если даты нет.
export function monthsUntil(dateStr: string | null): number {
  if (!dateStr) return 0
  const now = new Date()
  const target = new Date(dateStr)
  const months =
    (target.getFullYear() - now.getFullYear()) * 12 +
    (target.getMonth() - now.getMonth())
  return Math.max(1, months)
}

// ===== Настройка распределения внутри категории «Цели» (80/20) =====
// Доля главной цели в процентах (0..100). Второстепенным — остаток (100 - это).
// Хранится в app_settings (одна строка на пользователя), чтобы синхронизировалось между устройствами.
export const DEFAULT_GOALS_SPLIT = 80

export async function loadGoalsSplit(userId: string): Promise<number> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('goals_primary_split')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return DEFAULT_GOALS_SPLIT
  const v = Number((data as { goals_primary_split?: number } | null)?.goals_primary_split)
  return Number.isFinite(v) && v >= 0 && v <= 100 ? v : DEFAULT_GOALS_SPLIT
}

export async function saveGoalsSplit(userId: string, value: number): Promise<void> {
  const v = Math.max(0, Math.min(100, Math.round(value)))
  await supabase
    .from('app_settings')
    .upsert(
      { user_id: userId, goals_primary_split: v, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
}

// Сохраняет ручной порядок целей в базе: sort_order = позиция в списке (начиная с 1),
// чтобы порядок второстепенных целей синхронизировался между устройствами.
export async function saveGoalsOrder(userId: string, orderedIds: string[]): Promise<void> {
  await Promise.all(
    orderedIds.map((id, i) =>
      supabase
        .from('goals')
        .update({ sort_order: i + 1 })
        .eq('id', id)
        .eq('user_id', userId),
    ),
  )
}

// ===== Накопительные категории =====
// Деньги, отложенные в Сбережения/Инвестиции, — это не «трата», а перекладывание
// в копилку: они остаются твоими. Поэтому их НЕ считаем расходом ни при расчёте
// подушки безопасности, ни в карточке «Расходы» на дашборде.
export const SAVINGS_CATEGORY_NAMES = ['Сбережения', 'Инвестиции']

export function isSavingsCategory(name: string | null | undefined): boolean {
  return !!name && SAVINGS_CATEGORY_NAMES.includes(name.trim())
}

// Долги — это реальный расход (деньги уходят навсегда), поэтому в карточке «Расходы»
// они остаются. НО для подушки безопасности их исключаем: платёж по долгу не должен
// раздувать средние расходы «на жизнь» (особенно разовый возврат долга человеку).
export const DEBT_CATEGORY_NAMES = ['Долги']

export function isDebtCategory(name: string | null | undefined): boolean {
  return !!name && DEBT_CATEGORY_NAMES.includes(name.trim())
}

// Благотворительность -- особая категория: отложенные 5% это «не твои» деньги,
// они копятся в отдельной копилке и потом раздаются (см. loadSavingsPots).
export const CHARITY_CATEGORY_NAMES = ['Благотворительность']

export function isCharityCategory(name: string | null | undefined): boolean {
  return !!name && CHARITY_CATEGORY_NAMES.includes(name.trim())
}

// Подкатегории благотворительности: делим копилку на крупную цель и маленькие
// пожертвования (по тому же принципу, что подушка внутри Сбережений).
export const CHARITY_BIG_SUBCATEGORY = 'Крупное пожертвование'
export const CHARITY_SMALL_SUBCATEGORY = 'Маленькие пожертвования'

export function isCharityBigSubcategory(sub: string | null | undefined): boolean {
  return !!sub && sub.trim() === CHARITY_BIG_SUBCATEGORY
}

// Категории, которые НЕ учитываются при расчёте подушки безопасности:
// накопления (остаются твоими), долги (разовые/временные) и благотворительность («не мои» деньги).
export function isCushionExcludedCategory(name: string | null | undefined): boolean {
  return isSavingsCategory(name) || isDebtCategory(name) || isCharityCategory(name)
}

// ===== Копилки: подушка безопасности и свободные накопления =====
// Две копилки с реальным балансом за всё время:
//  • cushion — подушка безопасности (пополняется расходами в Сбережениях с
//    подкатегорией «Подушка безопасности»);
//  • free    — свободные накопления (остальные Сбережения + все Инвестиции).
// Баланс копилки = пополнения − снятия.
//   Пополнение = расход в категории Сбережения/Инвестиции (paid_from_pot = null).
//   Снятие     = любой расход с пометкой paid_from_pot (трата отложенных денег);
//                он остаётся реальным расходом, но уменьшает баланс копилки.
export type SavingsPot = 'cushion' | 'free' | 'charity'

// Подкатегория, которая считается пополнением именно подушки безопасности.
export const CUSHION_SUBCATEGORY = 'Подушка безопасности'

export function isCushionSubcategory(sub: string | null | undefined): boolean {
  return !!sub && sub.trim() === CUSHION_SUBCATEGORY
}

export type SavingsPotsStats = {
  cushion: number // баланс подушки безопасности
  free: number    // баланс свободных накоплений
  charity: number // баланс копилки благотворительности (не входит в total -- «не мои» деньги)
  total: number   // cushion + free («Уже отложено» всего, без благотворительности)
}

// Считает реальные балансы копилок по всем расходам пользователя (за всё время).
export async function loadSavingsPots(userId: string): Promise<SavingsPotsStats> {
  const { data: cats, error: eCats } = await supabase
    .from('categories')
    .select('id, name')
    .eq('user_id', userId)
  if (eCats) throw eCats
  const savingsIds = new Set(
    ((cats ?? []) as { id: string; name: string }[])
      .filter((c) => isSavingsCategory(c.name))
      .map((c) => c.id),
  )
  const charityIds = new Set(
    ((cats ?? []) as { id: string; name: string }[])
      .filter((c) => isCharityCategory(c.name))
      .map((c) => c.id),
  )

  const { data: exps, error } = await supabase
    .from('expenses')
    .select('amount, category_id, subcategory, paid_from_pot')
    .eq('user_id', userId)
  if (error) throw error

  let cushion = 0
  let free = 0
  let charity = 0
  for (const ex of (exps ?? []) as {
    amount: number
    category_id: string | null
    subcategory: string | null
    paid_from_pot: string | null
  }[]) {
    const a = Number(ex.amount) || 0
    if (ex.paid_from_pot === 'cushion') {
      cushion -= a // снятие из подушки
    } else if (ex.paid_from_pot === 'free') {
      free -= a // снятие из накоплений
    } else if (ex.paid_from_pot === 'charity') {
      charity -= a // пожертвование: снятие из копилки благотворительности
    } else if (ex.category_id && savingsIds.has(ex.category_id)) {
      // пополнение: подушка — по подкатегории, остальные накопления — свободные
      if (isCushionSubcategory(ex.subcategory)) cushion += a
      else free += a
    } else if (ex.category_id && charityIds.has(ex.category_id)) {
      charity += a // пополнение копилки благотворительности (отложенные 5%)
    }
  }
  // total -- личные накопления (подушка + свободные). Благотворительность не входит:
  // это «не мои» деньги, показываем их отдельной копилкой.
  return { cushion, free, charity, total: cushion + free }
}

// ===== Подушка безопасности =====
// Считает среднемесячные расходы за последние N месяцев и рекомендуемый размер
// подушки (среднее в месяц, умноженное на число месяцев покрытия).
// Сумма растёт автоматически вместе с расходами.
export type CushionStats = {
  monthsUsed: number     // сколько месяцев из окна реально содержат расходы
  totalExpenses: number  // сумма расходов за эти месяцы
  avgMonthly: number     // средние расходы в месяц
  recommended: number    // рекомендуемая подушка = avgMonthly * coverageMonths
}

export async function loadCushionStats(
  userId: string,
  coverageMonths = 6,
): Promise<CushionStats> {
  const empty: CushionStats = { monthsUsed: 0, totalExpenses: 0, avgMonthly: 0, recommended: 0 }
  const now = new Date()
  const curIdx = now.getFullYear() * 12 + now.getMonth() // 0-based индекс месяца
  const minIdx = curIdx - (coverageMonths - 1)

  const { data: months, error } = await supabase
    .from('months')
    .select('id, year, month')
    .eq('user_id', userId)
  if (error) throw error

  // id категорий, которые не идут в подушку (накопления и долги).
  const { data: cats, error: eCats } = await supabase
    .from('categories')
    .select('id, name')
    .eq('user_id', userId)
  if (eCats) throw eCats
  const excludedIds = new Set(
    ((cats ?? []) as { id: string; name: string }[])
      .filter((c) => isCushionExcludedCategory(c.name))
      .map((c) => c.id),
  )

  const windowIds = ((months ?? []) as { id: string; year: number; month: number }[])
    .filter((m) => {
      const idx = Number(m.year) * 12 + (Number(m.month) - 1)
      return idx >= minIdx && idx <= curIdx
    })
    .map((m) => m.id)
  if (windowIds.length === 0) return empty

  const { data: exps, error: e2 } = await supabase
    .from('expenses')
    .select('amount, month_id, category_id, paid_from_pot')
    .in('month_id', windowIds)
  if (e2) throw e2

  const byMonth: Record<string, number> = {}
  let total = 0
  for (const ex of (exps ?? []) as { amount: number; month_id: string; category_id: string | null; paid_from_pot: string | null }[]) {
    if (ex.category_id && excludedIds.has(ex.category_id)) continue // накопления и долги — не «жизнь на месяц»
    if (ex.paid_from_pot) continue // трата из копилки (разовая, оплачена прошлыми накоплениями) — не раздуваем среднее
    const a = Number(ex.amount) || 0
    total += a
    byMonth[ex.month_id] = (byMonth[ex.month_id] ?? 0) + a
  }
  const monthsWithData = Object.values(byMonth).filter((v) => v > 0).length
  if (monthsWithData === 0) return empty
  const avgMonthly = total / monthsWithData
  return {
    monthsUsed: monthsWithData,
    totalExpenses: total,
    avgMonthly,
    recommended: avgMonthly * coverageMonths,
  }
}

// Сколько месяцев покрывает подушка (3/6/12). Хранится в app_settings
// (одна строка на пользователя), чтобы синхронизировалось между устройствами.
export const DEFAULT_CUSHION_MONTHS = 6

export async function loadCushionMonths(userId: string): Promise<number> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('cushion_months')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return DEFAULT_CUSHION_MONTHS
  const v = Number((data as { cushion_months?: number } | null)?.cushion_months)
  return v === 3 || v === 6 || v === 12 ? v : DEFAULT_CUSHION_MONTHS
}

export async function saveCushionMonths(userId: string, n: number): Promise<void> {
  const v = n === 3 || n === 6 || n === 12 ? n : DEFAULT_CUSHION_MONTHS
  await supabase
    .from('app_settings')
    .upsert(
      { user_id: userId, cushion_months: v, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
}

// ===== Благотворительность: распределение 5% и крупная цель =====
// Логика как у «Целей» (80/20): доля крупного пожертвования в процентах (0..100),
// остальное -- маленькие пожертвования. Храним в app_settings (синхронизация между устройствами).
export const DEFAULT_CHARITY_SPLIT = 70

export async function loadCharitySplit(userId: string): Promise<number> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('charity_primary_split')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return DEFAULT_CHARITY_SPLIT
  const v = Number((data as { charity_primary_split?: number } | null)?.charity_primary_split)
  return Number.isFinite(v) && v >= 0 && v <= 100 ? v : DEFAULT_CHARITY_SPLIT
}

export async function saveCharitySplit(userId: string, value: number): Promise<void> {
  const v = Math.max(0, Math.min(100, Math.round(value)))
  await supabase
    .from('app_settings')
    .upsert(
      { user_id: userId, charity_primary_split: v, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
}

// Параметры крупного пожертвования (название, целевая сумма, дата). Одна цель на пользователя.
export type CharityGoal = { name: string; target: number; date: string | null }

export async function loadCharityGoal(userId: string): Promise<CharityGoal> {
  const empty: CharityGoal = { name: '', target: 0, date: null }
  const { data, error } = await supabase
    .from('app_settings')
    .select('charity_goal_name, charity_goal_target, charity_goal_date')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data) return empty
  const d = data as {
    charity_goal_name?: string | null
    charity_goal_target?: number | null
    charity_goal_date?: string | null
  }
  return {
    name: d.charity_goal_name ?? '',
    target: Number(d.charity_goal_target) || 0,
    date: d.charity_goal_date ?? null,
  }
}

export async function saveCharityGoal(userId: string, goal: CharityGoal): Promise<void> {
  await supabase
    .from('app_settings')
    .upsert(
      {
        user_id: userId,
        charity_goal_name: goal.name || null,
        charity_goal_target: goal.target || 0,
        charity_goal_date: goal.date || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
}

// Балансы копилки благотворительности по двум подкатегориям (крупное / маленькие).
// big + small = charity из loadSavingsPots. Пополнение -- расход в категории
// «Благотворительность» без paid_from_pot; пожертвование -- расход с paid_from_pot='charity'.
// Записи без подкатегории считаем маленькими (обратная совместимость).
export type CharityPotsStats = { big: number; small: number; total: number }

export async function loadCharityPots(userId: string): Promise<CharityPotsStats> {
  const { data: cats, error: eCats } = await supabase
    .from('categories')
    .select('id, name')
    .eq('user_id', userId)
  if (eCats) throw eCats
  const charityIds = new Set(
    ((cats ?? []) as { id: string; name: string }[])
      .filter((c) => isCharityCategory(c.name))
      .map((c) => c.id),
  )

  const { data: exps, error } = await supabase
    .from('expenses')
    .select('amount, category_id, subcategory, paid_from_pot')
    .eq('user_id', userId)
  if (error) throw error

  let big = 0
  let small = 0
  for (const ex of (exps ?? []) as {
    amount: number
    category_id: string | null
    subcategory: string | null
    paid_from_pot: string | null
  }[]) {
    const a = Number(ex.amount) || 0
    const isBig = isCharityBigSubcategory(ex.subcategory)
    if (ex.paid_from_pot === 'charity') {
      // пожертвование (снятие из копилки)
      if (isBig) big -= a
      else small -= a
    } else if (ex.category_id && charityIds.has(ex.category_id)) {
      // пополнение копилки (отложенные 5%)
      if (isBig) big += a
      else small += a
    }
  }
  return { big, small, total: big + small }
}
