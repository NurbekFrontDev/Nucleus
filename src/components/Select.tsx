import { useEffect, useRef, useState } from 'react'

type Option = { value: string; label: string }
type Props = {
  value: string
  onChange: (v: string) => void
  options: Option[]
  className?: string
  placeholder?: string
}

const triggerCls =
  'flex w-full items-center justify-between gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-left text-sm outline-none transition hover:border-emerald-500 focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950'

// Выпадающий список (фиксированные варианты) в стиле приложения.
export default function Select({ value, onChange, options, className, placeholder }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const current = options.find((o) => o.value === value)

  return (
    <div ref={ref} className={`relative ${className ?? 'w-full'}`}>
      <button type="button" onClick={() => setOpen((v) => !v)} className={triggerCls}>
        <span className={`truncate ${current ? '' : 'text-neutral-400'}`}>
          {current ? current.label : placeholder ?? 'Выбрать…'}
        </span>
        <span className="shrink-0 text-neutral-400">▾</span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 max-h-60 w-full min-w-max overflow-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
              className={`block w-full px-3 py-2 text-left text-sm transition hover:bg-emerald-500/10 ${
                o.value === value ? 'text-emerald-600 dark:text-emerald-400' : ''
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
