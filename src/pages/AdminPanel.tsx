import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useLang } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import { isAdminEmail, formatDeviceName } from '../lib/installs'
import { onSyncEvent } from '../lib/realtimeSync'

// Админ-панель (только для аккаунта Нурбека):
//  — вкладка «Установки»: список всех установок Nucleus на устройствах
//    (имя, email, платформа, модель, версии ОС и приложения).
//  — вкладка «Логи»: единый журнал событий со всех устройств (app_logs):
//    что происходило в приложении — отправка записей, шаги AI-пайплайна,
//    вольт-синк, правки, удаления, смена настроек, ошибки.

type InstallRow = {
  id: string
  user_id: string
  install_id: string
  email: string | null
  user_name: string | null
  platform: string
  device_name: string | null
  os_version: string | null
  app_version: string | null
  first_seen: string
  last_seen: string
}

type LogRow = {
  id: number
  level: 'info' | 'warn' | 'error'
  scope: string
  message: string
  meta: Record<string, unknown> | null
  platform: string | null
  created_at: string
}

type Tab = 'installs' | 'logs'
type Filter = 'all' | 'android' | 'windows'
type LogFilter = 'all' | 'error' | 'warn' | 'info'

const cardCls =
  'rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900'
const inputCls =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950'

const platformBadge = (p: string): string => {
  if (p === 'windows') return '💻 Windows'
  if (p === 'android') return '📱 Android'
  return '🌐 Web'
}

export default function AdminPanel() {
  const { user } = useAuth()
  const { t } = useLang()
  const [rows, setRows] = useState<InstallRow[]>([])
  const [logs, setLogs] = useState<LogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<Tab>('installs')
  const [logFilter, setLogFilter] = useState<LogFilter>('all')
  const [logSearch, setLogSearch] = useState('')

  const admin = isAdminEmail(user?.email)

  const loadRows = async () => {
    if (!admin) {
      setLoading(false)
      return
    }
    try {
      const { data, error: e } = await supabase
        .from('app_installs')
        .select('*')
        .order('last_seen', { ascending: false })
      if (e) throw e
      setRows((data ?? []) as unknown as InstallRow[])
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const loadLogs = async () => {
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
  }

  useEffect(() => {
    let active = true
    void loadRows().then(() => {
      if (active) setLoading(false)
    })
    void loadLogs()
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin])

  // Живое обновление: как только устройство пишет heartbeat/появляется установка
  // или любая система логирует событие — перечитываем соответствующий список.
  useEffect(() => {
    if (!admin) return
    return onSyncEvent(['app_installs', 'app_logs'], (evt) => {
      if (evt.table === 'app_logs') void loadLogs()
      else void loadRows()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin])

  const counts = useMemo(
    () => ({
      all: rows.length,
      android: rows.filter((r) => r.platform === 'android').length,
      windows: rows.filter((r) => r.platform === 'windows').length,
    }),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (filter !== 'all' && r.platform !== filter) return false
      if (!q) return true
      return [r.user_name, r.email, r.device_name, r.app_version]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    })
  }, [rows, filter, search])

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

  // Доступ только у админа: вкладка скрыта в навигации, а прямой URL защищён здесь.
  if (!admin) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <div className="sticky top-0 z-20 -mx-4 flex items-center gap-2 border-b border-neutral-200/70 bg-white/85 px-4 py-3 backdrop-blur dark:border-neutral-800/70 dark:bg-neutral-950/85">
          <h1 className="text-xl font-semibold">{t('pnav.admin')}</h1>
        </div>
        <p className="rounded-xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
          {t('admin.noAccess')}
        </p>
      </div>
    )
  }

  const filters: Array<{ id: Filter; label: string; count: number }> = [
    { id: 'all', label: t('admin.filterAll'), count: counts.all },
    { id: 'android', label: '📱 Android', count: counts.android },
    { id: 'windows', label: '💻 Windows', count: counts.windows },
  ]

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      {/* Закреплённая шапка */}
      <div className="sticky top-0 z-20 -mx-4 flex items-center justify-between gap-2 border-b border-neutral-200/70 bg-white/85 px-4 py-3 backdrop-blur dark:border-neutral-800/70 dark:bg-neutral-950/85">
        <h1 className="text-xl font-semibold">🛡️ {t('admin.title')}</h1>
        {/* Переключатель вкладок: Установки / Логи */}
        <div className="flex gap-1 rounded-lg bg-neutral-200/60 p-1 dark:bg-neutral-800/60">
          {([
            { id: 'installs', label: '💻 ' + t('admin.title') },
            { id: 'logs', label: '📜 ' + t('admin.tabLogs') },
          ] as Array<{ id: Tab; label: string }>).map((tb) => (
            <button
              key={tb.id}
              type="button"
              onClick={() => setTab(tb.id)}
              className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                tab === tb.id
                  ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
                  : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400'
              }`}
            >
              {tb.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'logs' ? (
        <LogsView
          logs={filteredLogs}
          filter={logFilter}
          setFilter={setLogFilter}
          search={logSearch}
          setSearch={setLogSearch}
          total={logs.length}
        />
      ) : (
        <>
          {/* Поиск + фильтры Все / Android / Windows */}
          <div className="flex flex-col gap-2">
            <input
              className={inputCls}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('admin.searchPh')}
            />
            <div className="flex gap-1 rounded-xl bg-neutral-200/60 p-1 dark:bg-neutral-800/60">
              {filters.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium transition ${
                    filter === f.id
                      ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
                      : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200'
                  }`}
                >
                  <span className="truncate">{f.label}</span>
                  <span className="rounded-full bg-neutral-200/80 px-1.5 py-0.5 text-[10px] font-bold text-neutral-600 dark:bg-neutral-600/60 dark:text-neutral-200">
                    {f.count}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          {/* Список установок */}
          {loading ? (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('common.loading')}</p>
          ) : filtered.length === 0 ? (
            <p className="rounded-xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
              {t('admin.empty')}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {filtered.map((r) => {
                const isWin = r.platform === 'windows'
                const isAndroid = r.platform === 'android'
                // Форматируем модель телефона (например Redmi Note 12)
                const friendlyDevice = isAndroid ? formatDeviceName(r.device_name) : null
                // Для Windows нормализуем «Windows 10/11» в «Windows 11»
                const normalizedOs =
                  isWin && r.os_version?.includes('Windows 10/11') ? 'Windows 11' : r.os_version
                // Исключаем дублирование Windows (было: Windows 10/11 · Windows 10/11)
                const displayDevice = isWin ? null : friendlyDevice || r.device_name
                const specs = [displayDevice, normalizedOs, `v${r.app_version ?? '?'}`]
                  .filter(Boolean)
                  .join(' · ')

                return (
                  <div key={r.id} className={`flex items-start gap-3 ${cardCls}`}>
                    <span className="mt-0.5 shrink-0 text-lg leading-none">
                      {isWin ? '💻' : isAndroid ? '📱' : '🌐'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="break-words text-sm font-medium">
                          {r.user_name || r.email || '—'}
                        </p>
                        <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                          {platformBadge(r.platform)}
                        </span>
                      </div>
                      {r.email && (
                        <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{r.email}</p>
                      )}
                      <p className="mt-0.5 break-words text-xs text-neutral-500 dark:text-neutral-400">
                        {specs}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ===== Подвкладка «Логи» =====

function LogsView({
  logs,
  filter,
  setFilter,
  search,
  setSearch,
  total,
}: {
  logs: LogRow[]
  filter: LogFilter
  setFilter: (f: LogFilter) => void
  search: string
  setSearch: (s: string) => void
  total: number
}) {
  const { t } = useLang()

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
    <div className="flex flex-col gap-2">
      <input
        className={inputCls}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('admin.logSearchPh')}
      />
      <div className="flex gap-1 rounded-xl bg-neutral-200/60 p-1 dark:bg-neutral-800/60">
        {filterOptions.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition ${
              filter === f.id
                ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
                : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200'
            }`}
          >
            <span className="truncate">{f.label}</span>
          </button>
        ))}
      </div>

      <p className="px-1 text-xs text-neutral-400">
        {t('admin.logCount', { n: logs.length, total })}
      </p>

      {logs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
          {t('admin.logEmpty')}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {logs.map((l) => (
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
