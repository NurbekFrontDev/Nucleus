import { useState } from 'react'
import { useAnimatedMount } from '../lib/useAnimatedMount'
import { useLang } from '../lib/i18n'
import type { DayEnergy } from '../lib/planner'

// Окно «Персонаж энергии» (геймификация П-9). Открывается по тапу на
// прогресс-бар дня. Показывает эмодзи-персонажа, коуч-сообщение по уровню
// энергии и разбивку по приоритетам (сколько 🔴🟡🟢 закрыто).

type Props = {
  energy: DayEnergy
  onClose: () => void
}

// Уровень энергии → эмодзи, ключ подписи, класс свечения.
function getLevel(e: number) {
  if (e <= 20) return { emoji: '😴', level: 'sleepy', glow: 'shadow-sky-500/20' }
  if (e <= 40) return { emoji: '😐', level: 'low', glow: 'shadow-amber-500/20' }
  if (e <= 60) return { emoji: '🙂', level: 'mid', glow: 'shadow-amber-500/30' }
  if (e <= 80) return { emoji: '😊', level: 'high', glow: 'shadow-emerald-500/30' }
  return { emoji: '🤩', level: 'max', glow: 'shadow-emerald-500/40' }
}

export default function EnergyCharacter({ energy, onClose }: Props) {
  const { t } = useLang()
  const [open, setOpen] = useState(true)
  const visible = useAnimatedMount(open, 220)

  const close = () => {
    onClose()
    setOpen(false)
  }
  if (!visible) return null

  const { emoji, level, glow } = getLevel(energy.energy)
  const bp = energy.byPriority

  // Строка разбивки по приоритетам.
  const row = (dot: string, done: number, total: number) => (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-base leading-none">{dot}</span>
      <span className={"font-medium " + (done === total && total > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-neutral-600 dark:text-neutral-300')}>
        {done} / {total}
      </span>
    </div>
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={close}
    >
      <div
        className={
          'w-full max-w-sm rounded-t-3xl border bg-white p-6 shadow-2xl transition sm:rounded-2xl dark:border-neutral-800 dark:bg-neutral-900 ' +
          glow +
          (open ? ' animate-pop' : ' animate-pop-out')
        }
        onClick={(e) => e.stopPropagation()}
      >
        {/* Эмодзи-персонаж */}
        <div className="mb-4 flex justify-center">
          <span className="text-7xl leading-none drop-shadow-lg">{emoji}</span>
        </div>

        {/* Заголовок-сигнал уровней энергии */}
        <div className="mb-5 text-center">
          <p className="text-2xl font-bold">
            {energy.energy}%
            <span className="ml-2 text-sm font-normal text-neutral-500 dark:text-neutral-400">
              {t('energy.label')}
            </span>
          </p>
        </div>

        {/* Коуч-сообщение по уровню */}
        <div className={
          'mb-5 rounded-2xl border p-4 text-center text-sm font-medium leading-relaxed ' +
          (level === 'sleepy' || level === 'low'
            ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300'
            : 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300')
        }>
          {t(`energy.level.${level}`)}
        </div>

        {/* Разбивка по приоритетам */}
        <div className="mb-5">
          <p className="mb-2 text-xs font-medium uppercase text-neutral-400 dark:text-neutral-500">
            {t('energy.breakdown')}
          </p>
          <div className="flex items-center justify-around rounded-2xl border border-neutral-200 p-3 dark:border-neutral-800">
            {row('🔴', bp.high.done, bp.high.total)}
            {row('🟡', bp.medium.done, bp.medium.total)}
            {row('🟢', bp.low.done, bp.low.total)}
          </div>
        </div>

        {/* Флаг «читинга» */}
        {energy.gaming && (
          <div className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-center text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
            {t('energy.gamingHint')}
          </div>
        )}

        {/* Кнопка закрытия */}
        <button
          type="button"
          onClick={close}
          className="w-full rounded-xl border border-neutral-300 px-4 py-2.5 text-sm font-medium transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          {t('common.confirm')}
        </button>
      </div>
    </div>
  )
}
