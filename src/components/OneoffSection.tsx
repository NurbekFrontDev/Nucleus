import { useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useLang } from '../lib/i18n';
import {
  type OneoffTask,
  loadOneoffTasks,
  addOneoffTask,
  toggleOneoffDone,
  deleteOneoffTask,
  cleanupOldOneoff,
} from '../lib/oneoff';

// Component that displays one-time tasks on the PlannerToday screen
export default function OneoffSection({ currentDay }: { currentDay: string }) {
  const { user } = useAuth();
  const { t } = useLang();

  const [isOpen, setIsOpen] = useState(true);
  const [tasks, setTasks] = useState<OneoffTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [filter, setFilter] = useState<'all' | 'today'>('all');

  useEffect(() => {
    if (!user) return;

    let active = true;
    (async () => {
      try {
        setLoading(true);
        // 1. auto-cleanup old ones
        const count = await cleanupOldOneoff(user.id);
        if (count > 0 && active) {
          console.log(`Cleaned up ${count} one-time tasks`);
        }
        
        // 2. load tasks
        const data = await loadOneoffTasks(user.id, filter === 'today' ? { date: currentDay } : undefined);
        if (active) setTasks(data);
      } catch (e) {
        console.error(e);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [user, currentDay, filter]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !title.trim()) return;

    const newTask = await addOneoffTask(user.id, title.trim(), undefined, targetDate || undefined);
    if (newTask) {
      setTasks((prev) => [newTask, ...prev]);
      setTitle('');
      setTargetDate('');
    }
  };

  const handleToggle = async (task: OneoffTask) => {
    if (!user) return;
    const isDone = !!task.done_at;
    
    // optimistic update
    setTasks((prev) => 
      prev.map(t => t.id === task.id ? { ...t, done_at: isDone ? null : new Date().toISOString() } : t)
          .sort((a, b) => {
             // sort undone first
             const aDone = !!(a.id === task.id ? !isDone : a.done_at);
             const bDone = !!(b.id === task.id ? b.done_at : b.done_at);
             if (aDone && !bDone) return 1;
             if (!aDone && bDone) return -1;
             return 0;
          })
    );

    await toggleOneoffDone(user.id, task.id, isDone);
  };

  const handleDelete = async (taskId: string) => {
    if (!user) return;
    
    setTasks((prev) => prev.filter(t => t.id !== taskId));
    await deleteOneoffTask(user.id, taskId);
  };

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50">
      <div className="flex items-center justify-between mb-3">
        <button 
          onClick={() => setIsOpen(!isOpen)} 
          className="flex items-center gap-2 text-sm font-semibold text-neutral-800 dark:text-neutral-200"
        >
          <span>{isOpen ? '▼' : '▶'}</span>
          {t('oneoff.title')}
        </button>
        <div className="flex bg-neutral-100 rounded-lg p-1 dark:bg-neutral-800 text-[11px]">
          <button
            onClick={() => setFilter('all')}
            className={`px-2 py-1 rounded-md transition ${filter === 'all' ? 'bg-white shadow text-neutral-800 dark:bg-neutral-700 dark:text-neutral-200' : 'text-neutral-500 dark:text-neutral-400'}`}
          >
            {t('oneoff.all')}
          </button>
          <button
            onClick={() => setFilter('today')}
            className={`px-2 py-1 rounded-md transition ${filter === 'today' ? 'bg-white shadow text-neutral-800 dark:bg-neutral-700 dark:text-neutral-200' : 'text-neutral-500 dark:text-neutral-400'}`}
          >
            {t('oneoff.forToday')}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="space-y-3">
          <form onSubmit={handleAdd} className="flex gap-2 items-center">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('oneoff.placeholder')}
              className="flex-1 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800"
            />
            <input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 w-[120px]"
            />
            <button
              type="submit"
              disabled={!title.trim()}
              className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-600 disabled:opacity-50"
            >
              {t('oneoff.add')}
            </button>
          </form>

          {loading ? (
            <p className="text-sm text-neutral-500">{t('common.loading')}</p>
          ) : tasks.length === 0 ? (
            <p className="text-sm text-neutral-500 text-center py-2">{t('oneoff.empty')}</p>
          ) : (
            <div className="space-y-2">
              {tasks.map(task => (
                <div key={task.id} className={`flex items-center gap-3 p-2 rounded-lg border ${task.done_at ? 'border-transparent bg-neutral-50 dark:bg-neutral-800/50 opacity-60' : 'border-neutral-100 bg-white dark:border-neutral-800/80 dark:bg-neutral-900/80'}`}>
                  <button
                    type="button"
                    onClick={() => handleToggle(task)}
                    className={`shrink-0 flex h-5 w-5 items-center justify-center rounded-md border text-[10px] font-bold transition ${
                      task.done_at
                        ? 'border-emerald-500 bg-emerald-500 text-neutral-950'
                        : 'border-neutral-300 dark:border-neutral-600'
                    }`}
                  >
                    {task.done_at ? '✓' : ''}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm break-words ${task.done_at ? 'line-through text-neutral-500' : 'text-neutral-800 dark:text-neutral-200'}`}>
                      {task.title}
                    </p>
                    {task.target_date && (
                      <p className="text-[11px] text-neutral-400">
                        {task.target_date}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(task.id)}
                    className="shrink-0 p-1.5 text-neutral-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition"
                    title={t('common.delete')}
                  >
                    🗑
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
