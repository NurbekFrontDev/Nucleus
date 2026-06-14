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

// Форматирует число в вид «5 000 000 сум» / «5,000,000 so'm».
export function formatSum(value: number): string {
  const locale = dbLang === 'en' ? 'en-US' : 'ru-RU'
  const unit = dbLang === 'en' ? " so'm" : ' сум'
  return new Intl.NumberFormat(locale).format(Math.round(value)) + unit
}

// Форматирует ввод суммы с пробелами по тысячам: "1000000" -> "1 000 000".
export function formatAmountInput(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (!digits) return ''
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

// Парсит отформатированную сумму обратно в число.
export function parseAmount(formatted: string): number {
  const digits = formatted.replace(/\D/g, '')
  return digits ? Number(digits) : 0
}

// Пресеты подкатегорий расходов по названию категории (можно дополнять своими).
export const SUBCATEGORY_PRESETS: Record<string, string[]> = {
  'Обязательные': ['Аренда жилья', 'Коммуналка', 'Интернет', 'Связь', 'Продукты', 'Транспорт', 'Здоровье'],
  'Цели/Хотелки': ['Одежда', 'Кафе и рестораны', 'Развлечения', 'Путешествия', 'Техника', 'Подарки'],
  'Долги': ['Кредит', 'Рассрочка', 'Долг другу'],
  'Свободные': ['Подписки', 'Хобби', 'Разное'],
  'Сбережения': ['Подушка безопасности', 'Накопления'],
  'Инвестиции': ['Акции', 'Криптовалюта', 'Вклад'],
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
