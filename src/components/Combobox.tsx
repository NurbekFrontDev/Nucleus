import { useEffect, useRef, useState } from 'react'
import { useLang } from '../lib/i18n'

type Props = {
  value: string
  onChange: (v: string) => void
  options: string[]
  placeholder?: string
}

const baseCls =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950'

// Кастомный выпадающий список в стиле приложения.
// Можно выбрать из списка или вписать своё — значение всё равно сохраняется в БД.
export default function Combobox({ value, onChange, options, placeholder }: Props) {
  const { tr } = useLang()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  // Показываем подсказки на языке интерфейса (сохраняем именно то, что видно).
  const localized = Array.from(new Set(options.map((o) => tr(o))))
  const q = value.trim().toLowerCase()
  const filtered = q ? localized.filter((o) => o.toLowerCase().includes(q)) : localized

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <input
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className={baseCls + ' pr-9'}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setOpen((v) => !v)}
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-neutral-400 transition hover:text-neutral-600 dark:hover:text-neutral-200"
        >
          ▾
        </button>
      </div>
      {open && filtered.length > 0 && (
        <div className="animate-pop absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          {filtered.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => {
                onChange(o)
                setOpen(false)
              }}
              className={`block w-full px-3 py-2 text-left text-sm transition hover:bg-emerald-500/10 ${
                o === value ? 'text-emerald-600 dark:text-emerald-400' : ''
              }`}
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
