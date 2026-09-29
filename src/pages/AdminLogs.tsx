import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useLang } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import { isAdminEmail } from '../lib/installs'
import { onSyncEvent } from '../lib/realtimeSync'

// Экран «Логи» (только для аккаунта Нурбека): единый журнал событий со всех
// устройств (таблица app_logs) — отправка записей, шаги AI-пайплайна,
// вольт-синк, правки, удаления, смена настроек, ошибки. Вынесен из админ-панели
// в самостоятельную подвкладку сайдбара (/admin/logs).

type LogRow = {
  id: number
  level: 'info' | 'warn' | 'error'
  scope: string
  message: string
  meta: Record<string, unknown> | null
  platform: string | null
  created_at: string
}

type LogFilter = 'all' | 'error' | 'warn' | 'info'

const cardCls =
  'rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900'
const inputCls =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950'

export default function AdminLogs() {
  const { user } = useAuth()
  const { t } = useLang()
  const [logs, setLogs] = useState<LogRow[]>([])
  const [logFilter, setLogFilter] = useState<LogFilter>('all')
  const [logSearch, setLogSearch] = useState('')

  const admin = isAdminEmail(user?.email)

  const loadLogs = useCallback(async () => {
    if (!admin) return
    try {
      const { data, error: e } = await supabase
        .from('app_logs')
        .select('id, level, scope, message, meta, platform, created_at')
        .order('created_at', { ascending: false })
        .limit(300)
      if (e) throw e
      setLogs((data ?? []) as unknown as LogRow[])
    } catch {
      // таблицы может не быть (старая версия) — просто пустой список
      setLogs([])
    }
  }, [admin])

  useEffect(() => {
    void loadLogs()
    // Realtime: любое устройство пишет событие — журнал перечитывается.
    return onSyncEvent(['app_logs'], () => void loadLogs())
  }, [loadLogs])

  // Страховка: опрос раз в 20с на случай, если realtime-канал не поднялся.
  useEffect(() => {
    if (!admin) return
    const timer = window.setInterval(() => void loadLogs(), 20_000)
    return () => window.clearInterval(timer)
  }, [admin, loadLogs])

  const filteredLogs = useMemo(() => {
    const q = logSearch.trim().toLowerCase()
    return logs.filter((l) => {
      if (logFilter !== 'all' && l.level !== logFilter) return false
      if (!q) return true
      return [l.message, l.scope, l.platform, JSON.stringify(l.meta ?? {})]
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
  }, [logs, logFilter, logSearch])

  if (!admin) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <div className="sticky top-0 z-20 -mx-4 flex items-center gap-2 border-b border-neutral-200/70 bg-white/85 px-4 py-3 backdrop-blur dark:border-neutral-800/70 dark:bg-neutral-950/85">
          <h1 className="text-xl font-semibold">📜 {t('admin.tabLogs')}</h1>
        </div>
        <p className="rounded-xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
          {t('admin.noAccess')}
        </p>
      </div>
    )
  }

  const levelStyle = (level: LogRow['level']): string => {
    if (level === 'error') return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
    if (level === 'warn') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
    return 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
  }

  const platformIcon = (p: string | null): string => {
    if (p === 'windows') return '💻'
    if (p === 'android') return '📱'
    return '🌐'
  }

  const fmtTime = (iso: string): string => {
    try {
      return new Date(iso).toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    } catch {
      return iso
    }
  }

  const filterOptions: Array<{ id: LogFilter; label: string }> = [
    { id: 'all', label: t('admin.logAll') },
    { id: 'error', label: '🔴 ' + t('admin.logErrors') },
    { id: 'warn', label: '🟡 ' + t('admin.logWarns') },
    { id: 'info', label: t('admin.logInfo') },
  ]

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      {/* Закреплённая шапка */}
      <div className="sticky top-0 z-20 -mx-4 flex items-center gap-2 border-b border-neutral-200/70 bg-white/85 px-4 py-3 backdrop-blur dark:border-neutral-800/70 dark:bg-neutral-950/85">
        <h1 className="text-xl font-semibold">📜 {t('admin.tabLogs')}</h1>
      </div>

      <input
        className={inputCls}
        value={logSearch}
        onChange={(e) => setLogSearch(e.target.value)}
        placeholder={t('admin.logSearchPh')}
      />
      <div className="flex gap-1 rounded-xl bg-neutral-200/60 p-1 dark:bg-neutral-800/60">
        {filterOptions.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setLogFilter(f.id)}
            className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition ${
              logFilter === f.id
                ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
                : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200'
            }`}
          >
            <span className="truncate">{f.label}</span>
          </button>
        ))}
      </div>

      <p className="px-1 text-xs text-neutral-400">
        {t('admin.logCount', { n: filteredLogs.length, total: logs.length })}
      </p>

      {filteredLogs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
          {t('admin.logEmpty')}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {filteredLogs.map((l) => (
            <div key={l.id} className={cardCls}>
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-sm leading-none">{platformIcon(l.platform)}</span>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${levelStyle(
                    l.level,
                  )}`}
                >
                  {l.level}
                </span>
                <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                  {l.scope}
                </span>
                <span className="ml-auto shrink-0 text-[10px] text-neutral-400">{fmtTime(l.created_at)}</span>
              </div>
              <p className="mt-1.5 break-words text-sm text-neutral-800 dark:text-neutral-200">{l.message}</p>
              {l.meta && Object.keys(l.meta).length > 0 && (
                <p className="mt-1 break-all font-mono text-[10px] text-neutral-400 dark:text-neutral-600">
                  {JSON.stringify(l.meta)}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
