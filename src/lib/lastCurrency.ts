import type { EntryCurrency } from './rates'

// Запоминаем последнюю выбранную валюту при добавлении дохода/расхода,
// чтобы в следующий раз она подставлялась автоматически. Хранится в localStorage.

const KEY = 'nucleus:lastCurrency'
const VALID: EntryCurrency[] = ['UZS', 'USD', 'RUB']

/** Последняя выбранная валюта (по умолчанию USD). */
export function loadLastCurrency(): EntryCurrency {
  try {
    const v = localStorage.getItem(KEY)
    if (v && (VALID as string[]).includes(v)) return v as EntryCurrency
  } catch {
    // localStorage недоступен — не критично
  }
  return 'USD'
}

/** Запомнить выбранную валюту. */
export function saveLastCurrency(c: EntryCurrency): void {
  try {
    localStorage.setItem(KEY, c)
  } catch {
    // не критично
  }
}
