import { type ReactNode } from 'react'
import { useLang } from '../lib/i18n'

type Props = {
  open: boolean
  title: string
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

// Единое окно подтверждения в стиле приложения.
// НИКОГДА не используем браузерные window.confirm/alert/prompt — только этот компонент.
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useLang()
  if (!open) return null
  const confirmText = confirmLabel ?? t('common.confirm')
  const cancelText = cancelLabel ?? t('common.cancel')
  return (
    <div
      className="animate-fade fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
    >
      <div
        className="animate-dialog w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">{title}</h2>
        {message && (
          <div className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{message}</div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={
              danger
                ? 'rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-600'
                : 'rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950 transition hover:bg-emerald-400'
            }
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
