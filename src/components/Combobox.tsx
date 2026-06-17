import { useEffect, useRef, useState } from 'react'
import { useLang } from '../lib/i18n'
import { useAnimatedMount } from '../lib/useAnimatedMount'

type Props = {
  value: string
  onChange: (v: string) => void
  options: string[]
  placeholder?: string
  // Необязательные коллбэки для управления подсказками прямо в списке (меню ⋯).
  // oldRaw — исходное (не локализованное) значение опции.
  onRenameOption?: (oldRaw: string, newName: string) => void
  onDeleteOption?: (raw: string) => void
}

const baseCls =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950'

// Кастомный выпадающий список в стиле приложения.
// Можно выбрать из списка или вписать своё — значение всё равно сохраняется в БД.
// Если переданы onRenameOption/onDeleteOption — у каждой подсказки появляется меню ⋯
// с «Изменить» и «Удалить».
export default function Combobox({
  value,
  onChange,
  options,
  placeholder,
  onRenameOption,
  onDeleteOption,
}: Props) {
  const { t, tr } = useLang()
  const [open, setOpen] = useState(false)
  const show = useAnimatedMount(open)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [editingRaw, setEditingRaw] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const closeAll = () => {
    setOpen(false)
    setMenuFor(null)
    setEditingRaw(null)
    setConfirmDel(null)
  }

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeAll()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const manageable = !!(onRenameOption || onDeleteOption)
  // Сохраняем связь raw↔локализованная метка: выбор сохраняет то, что видно,
  // а переименование/удаление работают с исходным (raw) значением.
  const seen = new Set<string>()
  const items: Array<{ raw: string; label: string }> = []
  for (const raw of options) {
    if (seen.has(raw)) continue
    seen.add(raw)
    items.push({ raw, label: tr(raw) })
  }
  const q = value.trim().toLowerCase()
  const filtered = q ? items.filter((it) => it.label.toLowerCase().includes(q)) : items

  const startEdit = (raw: string, label: string) => {
    setEditingRaw(raw)
    setEditText(label)
    setMenuFor(null)
    setConfirmDel(null)
  }
  const saveEdit = (raw: string) => {
    const v = editText.trim()
    if (v) onRenameOption?.(raw, v)
    setEditingRaw(null)
  }
  const doDelete = (raw: string) => {
    onDeleteOption?.(raw)
    setConfirmDel(null)
    setMenuFor(null)
  }

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
      {show && filtered.length > 0 && (
        <div className={`${open ? 'animate-pop' : 'animate-pop-out'} absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900`}>
          {filtered.map((it) => {
            // Режим переименования — инлайн-поле.
            if (editingRaw === it.raw) {
              return (
                <div key={it.raw} className="flex items-center gap-1 px-2 py-1">
                  <input
                    autoFocus
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveEdit(it.raw)
                      if (e.key === 'Escape') setEditingRaw(null)
                    }}
                    className="min-w-0 flex-1 rounded-md border border-emerald-500/60 bg-white px-2 py-1 text-sm outline-none dark:bg-neutral-950"
                  />
                  <button
                    type="button"
                    onClick={() => saveEdit(it.raw)}
                    className="shrink-0 rounded-md px-2 py-1 text-xs text-emerald-600 transition hover:bg-emerald-500/10 dark:text-emerald-400"
                  >
                    ✓
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingRaw(null)}
                    className="shrink-0 rounded-md px-2 py-1 text-xs text-neutral-500 transition hover:bg-neutral-500/10"
                  >
                    ✕
                  </button>
                </div>
              )
            }
            // Режим подтверждения удаления.
            if (confirmDel === it.raw) {
              return (
                <div key={it.raw} className="flex items-center justify-between gap-2 px-3 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-xs text-neutral-500 dark:text-neutral-400">
                    «{it.label}»
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => doDelete(it.raw)}
                      className="rounded-md px-2 py-1 text-xs text-red-500 transition hover:bg-red-500/10 dark:text-red-400"
                    >
                      {t('common.delete')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDel(null)}
                      className="rounded-md px-2 py-1 text-xs text-neutral-500 transition hover:bg-neutral-500/10"
                    >
                      {t('common.cancel')}
                    </button>
                  </span>
                </div>
              )
            }
            // Обычная строка.
            return (
              <div key={it.raw}>
                <div className="flex items-center">
                  <button
                    type="button"
                    onClick={() => {
                      onChange(it.label)
                      closeAll()
                    }}
                    className={`min-w-0 flex-1 truncate px-3 py-2 text-left text-sm transition hover:bg-emerald-500/10 ${
                      it.label === value ? 'text-emerald-600 dark:text-emerald-400' : ''
                    }`}
                  >
                    {it.label}
                  </button>
                  {manageable && (
                    <div className="relative shrink-0">
                      <button
                        type="button"
                        onClick={() => setMenuFor(menuFor === it.raw ? null : it.raw)}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 transition hover:bg-neutral-500/10 hover:text-neutral-600 dark:hover:text-neutral-200"
                        aria-label={t('common.edit')}
                      >
                        ⋯
                      </button>
                      {menuFor === it.raw && (
                        <div className="absolute right-0 top-full z-40 mt-1 w-36 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
                          {onRenameOption && (
                            <button
                              type="button"
                              onClick={() => startEdit(it.raw, it.label)}
                              className="block w-full px-3 py-2 text-left text-sm transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
                            >
                              {t('common.edit')}
                            </button>
                          )}
                          {onDeleteOption && (
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmDel(it.raw)
                                setMenuFor(null)
                              }}
                              className="block w-full px-3 py-2 text-left text-sm text-red-500 transition hover:bg-red-500/10 dark:text-red-400"
                            >
                              {t('common.delete')}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
