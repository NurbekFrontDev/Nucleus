import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useLang } from '../lib/i18n'
import DatePicker from './DatePicker'
import TimePicker, { fmt12 } from './TimePicker'
import {
  type OneoffTask,
  getCachedOneoffTasks,
  loadOneoffTasks,
  addOneoffTask,
  updateOneoffTask,
  toggleOneoffDone,
  deleteOneoffTask,
  cleanupOldOneoff,
} from '../lib/oneoff'
import { onSyncEvent } from '../lib/realtimeSync'
import { cancelOneoffNotification, rescheduleAll } from '../lib/notifications'

// Component that displays one-time tasks on the PlannerToday screen
export default function OneoffSection({ currentDay }: { currentDay: string }) {
  const { user } = useAuth()
  const { t } = useLang()

  const [isOpen, setIsOpen] = useState(true)
  const [filter, setFilter] = useState<'all' | 'today'>('all')
  const [tasks, setTasks] = useState<OneoffTask[]>(() =>
    user ? getCachedOneoffTasks(user.id, filter === 'today' ? { date: currentDay } : undefined) : [],
  )
  const [loading, setLoading] = useState(false)
  const [title, setTitle] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [reminderTime, setReminderTime] = useState('')

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editTime, setEditTime] = useState('')

  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!user) return

    // Immediately show from cache
    const cached = getCachedOneoffTasks(user.id, filter === 'today' ? { date: currentDay } : undefined)
    setTasks(cached)

    let active = true
    ;(async () => {
      try {
        if (cached.length === 0) setLoading(true)
        // 1. auto-cleanup old ones
        await cleanupOldOneoff(user.id)

        // 2. load tasks from network
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

    const newTask = await addOneoffTask(
      user.id,
      title.trim(),
      undefined,
      targetDate || undefined,
      reminderTime || undefined,
    )
    setTasks((prev) => [newTask, ...prev])
    setTitle('')
    setTargetDate('')
    setReminderTime('')
    if (reminderTime) void rescheduleAll(user.id)
  }

  const startEditing = (task: OneoffTask) => {
    setEditingId(task.id)
    setEditTitle(task.title)
    setEditDate(task.target_date || '')
    setEditTime(task.reminder_time || '')
  }

  const cancelEditing = () => {
    setEditingId(null)
    setEditTitle('')
    setEditDate('')
    setEditTime('')
  }

  const handleSaveEdit = async (taskId: string) => {
    if (!user || !editTitle.trim()) return
    const updates = {
      title: editTitle.trim(),
      target_date: editDate || null,
      reminder_time: editTime || null,
    }

    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...updates } : t)))
    setEditingId(null)

    await updateOneoffTask(user.id, taskId, updates)
    void rescheduleAll(user.id)
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

    if (!isDone) {
      void cancelOneoffNotification(task.id)
    }
    await toggleOneoffDone(user.id, task.id, isDone)
    void rescheduleAll(user.id)
  }

  const handleDelete = async (taskId: string) => {
    if (!user) return

    setTasks((prev) => prev.filter((t) => t.id !== taskId))
    void cancelOneoffNotification(taskId)
    await deleteOneoffTask(user.id, taskId)
    void rescheduleAll(user.id)
  }

  const pendingTasks = tasks.filter((t) => !t.done_at)
  const completedTasks = tasks.filter((t) => !!t.done_at)

  const renderTask = (task: OneoffTask) => {
    if (task.id === editingId) {
      return (
        <div
          key={task.id}
          className="space-y-2.5 rounded-xl border border-emerald-500/50 bg-emerald-500/5 p-3"
        >
          <input
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm outline-none transition focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950"
            autoFocus
          />
          <div className="grid grid-cols-2 gap-2 md:flex md:items-center md:gap-2">
            <div className="min-w-0 md:w-52">
              <DatePicker
                value={editDate}
                onChange={setEditDate}
                placeholder={t('oneoff.forToday')}
                placement="top"
              />
            </div>
            <div className="min-w-0 md:w-32">
              <TimePicker
                value={editTime}
                onChange={setEditTime}
                placeholder={t('oneoff.remindTime')}
              />
            </div>
            <div className="col-span-2 flex items-center justify-end gap-1.5 md:col-span-1 md:ml-auto">
              <button
                type="button"
                onClick={() => handleSaveEdit(task.id)}
                disabled={!editTitle.trim()}
                className="flex-1 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-50 md:flex-initial"
              >
                ✓ {t('common.save')}
              </button>
              <button
                type="button"
                onClick={cancelEditing}
                className="rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )
    }

    return (
      <div
        key={task.id}
        className={`flex items-center gap-2.5 rounded-xl border p-2.5 transition sm:gap-3 ${
          task.done_at
            ? 'border-transparent bg-neutral-50 opacity-60 dark:bg-neutral-800/40'
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
            className={`break-words text-sm ${
              task.done_at
                ? 'text-neutral-400 line-through dark:text-neutral-500'
                : 'font-medium text-neutral-800 dark:text-neutral-100'
            }`}
          >
            {task.title}
          </p>
          {(task.target_date || task.reminder_time) && (
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-neutral-400">
              {task.target_date && <span>📅 {task.target_date}</span>}
              {task.reminder_time && (
                <span className="inline-flex items-center gap-0.5 font-medium text-emerald-600 dark:text-emerald-400">
                  🔔 {fmt12(task.reminder_time) || task.reminder_time}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => startEditing(task)}
            className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            title={t('common.edit')}
          >
            ✏️
          </button>
          <button
            type="button"
            onClick={() => handleDelete(task.id)}
            className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
            title={t('common.delete')}
          >
            🗑
          </button>
        </div>
      </div>
    )
  }

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
          <form onSubmit={handleAdd} className="flex flex-col gap-2 md:flex-row md:items-center">
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
            <div className="grid grid-cols-2 gap-2 md:flex md:items-center md:gap-2">
              <div className="min-w-0 md:w-52">
                <DatePicker
                  value={targetDate}
                  onChange={setTargetDate}
                  placeholder={t('oneoff.forToday')}
                  placement="top"
                />
              </div>
              <div className="min-w-0 md:w-32">
                <TimePicker
                  value={reminderTime}
                  onChange={setReminderTime}
                  placeholder={t('oneoff.remindTime')}
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={!title.trim()}
              className="w-full rounded-lg bg-emerald-500 py-2 text-sm font-medium text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-50 md:w-auto md:shrink-0 md:px-4"
            >
              {t('oneoff.add')}
            </button>
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
