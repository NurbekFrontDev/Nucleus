import { useEffect, useRef, useState } from 'react'
import { useAnimatedMount } from '../lib/useAnimatedMount'

type Option = { value: number | string; label: string }

type Props = {
  value: number | string
  options: Option[]
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}

const triggerCls =
  'flex w-full items-center justify-between gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-left text-sm outline-none transition hover:border-emerald-500 focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950'

// Выпадающий список в стиле приложения (emerald-акцент, тёмная тема).
// Заменяет браузерный <select>, чтобы вид был единым на всех устройствах.
export default function Select({ value, options, onChange, placeholder, className }: Props) {
  const [open, setOpen] = useState(false)
  const show = useAnimatedMount(open)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const selected = options.find((o) => String(o.value) === String(value))

  return (
    <div ref={ref} className={`relative ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={triggerCls}
      >
        <span className={selected ? '' : 'text-neutral-400'}>
          {selected ? selected.label : placeholder ?? ''}
        </span>
        <svg
          className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M5 7.5 10 12.5 15 7.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {show && (
        <div
          className={`${
            open ? 'animate-pop' : 'animate-pop-out'
          } absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900`}
        >
          {options.map((o) => {
            const isSel = String(o.value) === String(value)
            return (
              <button
                key={String(o.value)}
                type="button"
                onClick={() => {
                  onChange(String(o.value))
                  setOpen(false)
                }}
                className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition ${
                  isSel
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                    : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
                }`}
              >
                <span>{o.label}</span>
                {isSel && (
                  <svg
                    className="h-4 w-4 shrink-0"
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path
                      d="M4 10.5 8 14.5 16 5.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
