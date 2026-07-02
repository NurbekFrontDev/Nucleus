import { useEffect, useState } from 'react'
import { fetchRate } from './db'

// Валюты, в которых пользователь может вводить сумму дохода/расхода.
// Порядок для выпадающего списка: сум, доллар, рубль.
export type EntryCurrency = 'UZS' | 'USD' | 'RUB'

// Запасные курсы (сумов за 1 единицу), если сеть недоступна в момент ввода.
const FALLBACK = { USD: 12600, RUB: 135 }

// Хук актуальных курсов к суму. При открытии формы сразу тянет свежий курс
// доллара и рубля из того же источника, что и конвертер в настройках (fetchRate).
// Отдаёт функцию toUsd — перевод введённой суммы в доллары (база учёта приложения).
export function useUsdRates() {
  const [rates, setRates] = useState(FALLBACK)
  const [ready, setReady] = useState(false)

  const refresh = async () => {
    try {
      const [usd, rub] = await Promise.all([fetchRate('USD'), fetchRate('RUB')])
      setRates((prev) => ({
        USD: usd && usd > 0 ? usd : prev.USD,
        RUB: rub && rub > 0 ? rub : prev.RUB,
      }))
    } catch {
      // сеть недоступна — оставляем текущие/запасные значения
    } finally {
      setReady(true)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Перевод суммы из выбранной валюты в доллары.
  // Доллары не конвертируем; сумы и рубли переводим через сум.
  const toUsd = (value: number, cur: EntryCurrency): number => {
    if (!value || value <= 0) return 0
    if (cur === 'USD') return value
    const uzs = cur === 'UZS' ? value : value * rates.RUB // рубли -> сумы
    return uzs / rates.USD
  }

  return { rates, ready, refresh, toUsd }
}
