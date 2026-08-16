import { useEffect, useState } from 'react'
import { useLang } from '../lib/i18n'
import { fetchRate, formatAmountInput, parseAmount } from '../lib/db'

// Минималистичный конвертер валют для быстрых прикидок: доллар, узбекский сум, рубль.
// Курсы (сколько сумов за 1 единицу валюты) подтягиваются автоматически (ЦБ Узбекистана и др.),
// а при недоступности используются разумные значения по умолчанию. Ничего не сохраняем —
// это просто калькулятор: ввёл сумму в одной валюте, мгновенно увидел в остальных.

type Code = 'USD' | 'UZS' | 'RUB'

// Запасные курсы (сум за 1 единицу), если автоподтягивание недоступно.
const DEFAULT_RATES = { USD: 12600, RUB: 135 }

const inputCls =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950'

// Форматируем число с пробелами по тысячам и копейками; пусто, если ноль/нет значения.
const fmt = (n: number) => (n > 0 ? formatAmountInput(String(Math.round(n * 100) / 100)) : '')

export default function CurrencyConverter() {
  const { t } = useLang()
  const [rates, setRates] = useState(DEFAULT_RATES)
  const [updating, setUpdating] = useState(false)
  const [amounts, setAmounts] = useState<Record<Code, string>>({ USD: '', UZS: '', RUB: '' })

  // Подтянуть актуальные курсы доллара и рубля к суму.
  const refresh = async () => {
    setUpdating(true)
    try {
      const [usd, rub] = await Promise.all([fetchRate('USD'), fetchRate('RUB')])
      setRates((prev) => ({
        USD: usd && usd > 0 ? usd : prev.USD,
        RUB: rub && rub > 0 ? rub : prev.RUB,
      }))
    } catch {
      // оставляем текущие значения курса
    } finally {
      setUpdating(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rateFor = (c: Code) => (c === 'USD' ? rates.USD : c === 'RUB' ? rates.RUB : 1)

  // Пересчёт по введённому полю: переводим в сумы, затем в остальные валюты.
  const recompute = (source: Code, raw: string) => {
    const formatted = formatAmountInput(raw)
    if (formatted === '') {
      setAmounts({ USD: '', UZS: '', RUB: '' })
      return
    }
    const value = parseAmount(formatted)
    const uzs = source === 'UZS' ? value : value * rateFor(source)
    setAmounts({
      USD: source === 'USD' ? formatted : fmt(uzs / rates.USD),
      UZS: source === 'UZS' ? formatted : fmt(uzs),
      RUB: source === 'RUB' ? formatted : fmt(uzs / rates.RUB),
    })
  }

  // Когда курс обновился — пересчитываем от суммы в сумах (если она задана).
  useEffect(() => {
    const uzs = parseAmount(amounts.UZS)
    if (uzs > 0) {
      setAmounts((prev) => ({
        ...prev,
        USD: fmt(uzs / rates.USD),
        RUB: fmt(uzs / rates.RUB),
      }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rates])

  const rows: { code: Code; symbol: string; name: string }[] = [
    { code: 'USD', symbol: '$', name: t('conv.usd') },
    { code: 'UZS', symbol: t('set.baseUnit'), name: t('conv.uzs') },
    { code: 'RUB', symbol: '₽', name: t('conv.rub') },
  ]

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900/50">
      <p className="font-medium">{t('conv.title')}</p>

      <div className="mt-4 flex flex-col gap-2">
        {rows.map((r) => (
          <div key={r.code} className="flex items-center gap-3">
            <div className="w-28 shrink-0">
              <p className="text-sm font-medium">
                <span className="text-neutral-400">{r.symbol}</span> {r.code}
              </p>
            </div>
            <input
              inputMode="decimal"
              value={amounts[r.code]}
              onChange={(e) => recompute(r.code, e.target.value)}
              onFocus={(e) => {
                // На мобильном при открытии клавиатуры поле может оказаться
                // за ней. Прокручиваем его в видимую область с небольшой задержкой,
                // чтобы клавиатура успела появиться.
                setTimeout(() => {
                  e.target.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }, 300)
              }}
              placeholder="0"
              className={inputCls}
            />
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="min-w-0 text-xs text-neutral-500 dark:text-neutral-400">
          {updating ? t('conv.updating') : t('conv.rateInfo', { usd: fmt(rates.USD), rub: fmt(rates.RUB) })}
        </p>
        <button
          type="button"
          onClick={refresh}
          disabled={updating}
          className="shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs transition hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          {t('conv.refresh')}
        </button>
      </div>
    </div>
  )
}
