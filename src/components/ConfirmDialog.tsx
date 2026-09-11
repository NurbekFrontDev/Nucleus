import { type ReactNode } from 'react'
import { useLang } from '../lib/i18n'
import { useAnimatedMount } from '../lib/useAnimatedMount'

type Props = {
  open: boolean
  title: string
  message?: ReactNode
  confirmLabel?: string
  loadingLabel?: string
  cancelLabel?: string
  danger?: boolean
  loading?: boolean
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
  loadingLabel,
  cancelLabel,
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useLang()
  const show = useAnimatedMount(open, 220)
  if (!show) return null
  const confirmText = loading
    ? (loadingLabel ?? confirmLabel ?? t('common.loading'))
    : (confirmLabel ?? t('common.confirm'))
  const cancelText = cancelLabel ?? t('common.cancel')

  const handleBackdropClick = () => {
    if (!loading) onCancel()
  }

  return (
    <div
      className={`${open ? 'animate-fade' : 'animate-fade-out'} fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4`}
      onClick={handleBackdropClick}
    >
      <div
        className={`${open ? 'animate-dialog' : 'animate-dialog-out'} w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-800 dark:bg-neutral-900`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
        {message && (
          <div className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{message}</div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm transition hover:bg-neutral-100 disabled:opacity-50 disabled:pointer-events-none dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-75 disabled:cursor-not-allowed ${
              danger
                ? 'bg-red-500 text-white hover:bg-red-600 active:bg-red-700'
                : 'bg-emerald-500 text-neutral-950 hover:bg-emerald-400'
            }`}
          >
            {loading && (
              <svg
                className="h-4 w-4 animate-spin text-current"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                />
              </svg>
            )}
            <span>{confirmText}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
