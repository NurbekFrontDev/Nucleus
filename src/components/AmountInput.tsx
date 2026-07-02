import Select from './Select'
import { formatAmountInput } from '../lib/db'
import type { EntryCurrency } from '../lib/rates'

const inputCls =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950'

// Порядок валют в выпадающем списке: сум, доллар, рубль.
const CURRENCY_OPTIONS: { value: EntryCurrency; label: string }[] = [
  { value: 'UZS', label: 'сум' },
  { value: 'USD', label: '$' },
  { value: 'RUB', label: '₽' },
]

type Props = {
  value: string
  currency: EntryCurrency
  onValueChange: (v: string) => void
  onCurrencyChange: (c: EntryCurrency) => void
  placeholder?: string
  // Серая подсказка под полем: во сколько долларов сконвертируется сумма.
  usdHint?: string | null
}

// Поле ввода суммы с выбором валюты справа. Всё хранится в долларах,
// поэтому родитель конвертирует значение при сохранении (см. useUsdRates.toUsd).
export default function AmountInput({
  value,
  currency,
  onValueChange,
  onCurrencyChange,
  placeholder,
  usdHint,
}: Props) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start gap-2">
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => onValueChange(formatAmountInput(e.target.value))}
          placeholder={placeholder}
          className={`${inputCls} flex-1`}
        />
        <Select
          className="w-20 shrink-0"
          value={currency}
          onChange={(v) => onCurrencyChange(v as EntryCurrency)}
          options={CURRENCY_OPTIONS}
        />
      </div>
      {usdHint && (
        <p className="px-1 text-xs text-neutral-500 dark:text-neutral-400">{usdHint}</p>
      )}
    </div>
  )
}
