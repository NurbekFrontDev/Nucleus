import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useLang } from '../lib/i18n'
import DatePicker from './DatePicker'
import {
  type OneoffTask,
  loadOneoffTasks,
  addOneoffTask,
  toggleOneoffDone,
  deleteOneoffTask,
  cleanupOldOneoff,
} from '../lib/oneoff'
import { onSyncEvent } from '../lib/realtimeSync'

// Component that displays one-time tasks on the PlannerToday screen
export default function OneoffSection({ currentDay }: { currentDay: string }) {
  const { user } = useAuth()
  const { t } = useLang()

  const [isOpen, setIsOpen] = useState(true)
  const [tasks, setTasks] = useState<OneoffTask[]>([])
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [filter, setFilter] = useState<'all' | 'today'>('all')

  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!user) return

    let active = true
    ;(async () => {
      try {
        setLoading(true)
        // 1. auto-cleanup old ones
        const count = await cleanupOldOneoff(user.id)
        if (count > 0 && active) {
          console.log(`Cleaned up ${count} one-time tasks`)
        }

        // 2. load tasks
        const data = await loadOneoffTasks(
          user.id,
          filter === 'today' ? { date: currentDay } : undefined,
        )
        if (active) setTasks(data)
      } catch (e) {
        console.error(e)
      } finally {
        if (active) setLoading(false)
      }
    })()

    return () => {
      active = false
    }
  }, [user, currentDay, filter])

  // Мгновенная синхронизация разовых задач
  useEffect(() => {
    if (!user) return
    const unsub = onSyncEvent(['oneoff_tasks'], async () => {
      try {
        const data = await loadOneoffTasks(
          user.id,
          filter === 'today' ? { date: currentDay } : undefined,
        )
        setTasks(data)
      } catch (e) {
        console.error(e)
      }
    })
    return unsub
  }, [user, currentDay, filter])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user || !title.trim()) return

    const newTask = await addOneoffTask(user.id, title.trim(), undefined, targetDate || undefined)
    if (newTask) {
      setTasks((prev) => [newTask, ...prev])
      setTitle('')
      setTargetDate('')
    }
  }

  const handleToggle = async (task: OneoffTask) => {
    if (!user) return
    const isDone = !!task.done_at

    // optimistic update
    setTasks((prev) =>
      prev
        .map((t) => (t.id === task.id ? { ...t, done_at: isDone ? null : new Date().toISOString() } : t))
        .sort((a, b) => {
          const aDone = !!(a.id === task.id ? !isDone : a.done_at)
          const bDone = !!(b.id === task.id ? b.done_at : b.done_at)
          if (aDone && !bDone) return 1
          if (!aDone && bDone) return -1
          return 0
        }),
    )

    await toggleOneoffDone(user.id, task.id, isDone)
  }

  const handleDelete = async (taskId: string) => {
    if (!user) return

    setTasks((prev) => prev.filter((t) => t.id !== taskId))
    await deleteOneoffTask(user.id, taskId)
  }

  const pendingTasks = tasks.filter((t) => !t.done_at)
  const completedTasks = tasks.filter((t) => !!t.done_at)

  const renderTask = (task: OneoffTask) => (
    <div
      key={task.id}
      className={`flex items-center gap-3 rounded-xl border p-2.5 transition ${
        task.done_at
          ? 'border-transparent bg-neutral-50 dark:bg-neutral-800/40 opacity-60'
          : 'border-neutral-200/80 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900'
      }`}
    >
      <button
        type="button"
        onClick={() => handleToggle(task)}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[10px] font-bold transition ${
          task.done_at
            ? 'border-emerald-500 bg-emerald-500 text-neutral-950'
            : 'border-neutral-300 hover:border-emerald-400 dark:border-neutral-600'
        }`}
      >
        {task.done_at ? '✓' : ''}
      </button>
      <div className="min-w-0 flex-1">
        <p
          className={`text-sm break-words ${
            task.done_at
              ? 'line-through text-neutral-400 dark:text-neutral-500'
              : 'text-neutral-800 dark:text-neutral-100 font-medium'
          }`}
        >
          {task.title}
        </p>
        {task.target_date && (
          <p className="text-[11px] text-neutral-400">
            📅 {task.target_date}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => handleDelete(task.id)}
        className="shrink-0 rounded-lg p-1.5 text-neutral-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
        title={t('common.delete')}
      >
        🗑
      </button>
    </div>
  )

  return (
    <div className="rounded-2xl border border-neutral-200/80 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/50">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 text-sm font-semibold text-neutral-800 dark:text-neutral-200"
        >
          <span>{isOpen ? '▼' : '▶'}</span>
          {t('oneoff.title')}
        </button>
        <div className="flex rounded-lg bg-neutral-100 p-1 text-[11px] dark:bg-neutral-800">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`rounded-md px-2.5 py-1 transition ${
              filter === 'all'
                ? 'bg-white font-medium text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
                : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200'
            }`}
          >
            {t('oneoff.all')}
          </button>
          <button
            type="button"
            onClick={() => setFilter('today')}
            className={`rounded-md px-2.5 py-1 transition ${
              filter === 'today'
                ? 'bg-white font-medium text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
                : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200'
            }`}
          >
            {t('oneoff.forToday')}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="space-y-3">
          <form onSubmit={handleAdd} className="flex flex-col gap-2 sm:flex-row">
            <input
              ref={inputRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onFocus={() => {
                setTimeout(() => {
                  inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }, 300)
              }}
              placeholder={t('oneoff.placeholder')}
              className="w-full flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950"
            />
            <div className="flex items-center gap-2">
              <div className="flex-1 sm:w-44">
                <DatePicker
                  value={targetDate}
                  onChange={setTargetDate}
                  placeholder={t('oneoff.forToday')}
                  placement="top"
                />
              </div>
              {targetDate && (
                <button
                  type="button"
                  onClick={() => setTargetDate('')}
                  className="rounded-lg p-2 text-xs text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
                  title="Очистить дату"
                >
                  ✕
                </button>
              )}
              <button
                type="submit"
                disabled={!title.trim()}
                className="shrink-0 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-50"
              >
                {t('oneoff.add')}
              </button>
            </div>
          </form>

          {loading ? (
            <p className="text-sm text-neutral-500">{t('common.loading')}</p>
          ) : tasks.length === 0 ? (
            <p className="py-3 text-center text-sm text-neutral-400">{t('oneoff.empty')}</p>
          ) : (
            <div className="space-y-2">
              {pendingTasks.map(renderTask)}

              {pendingTasks.length > 0 && completedTasks.length > 0 && (
                <div className="my-2 border-t border-neutral-200/80 dark:border-neutral-800/80" />
              )}

              {completedTasks.map(renderTask)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
