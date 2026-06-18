import { type ReactNode, type MouseEventHandler } from 'react'

type IconName = 'edit' | 'delete'

// Минималистичные иконки в стиле приложения: карандаш (изменить) и корзина (удалить).
const ICONS: Record<IconName, ReactNode> = {
  edit: <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />,
  delete: (
    <>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
}

const colorCls: Record<IconName, string> = {
  edit: 'text-neutral-500 hover:bg-emerald-500/10 hover:text-emerald-600 dark:text-neutral-400 dark:hover:text-emerald-400',
  delete: 'text-red-500 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300',
}

type IconButtonProps = {
  icon: IconName
  onClick: MouseEventHandler<HTMLButtonElement>
  title: string
  className?: string
}

export default function IconButton({ icon, onClick, title, className = '' }: IconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition ${colorCls[icon]} ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
        aria-hidden="true"
      >
        {ICONS[icon]}
      </svg>
    </button>
  )
}
