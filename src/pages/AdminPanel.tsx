import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useLang } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import { isAdminEmail, formatDeviceName } from '../lib/installs'
import { onSyncEvent } from '../lib/realtimeSync'

// Админ-панель (только для аккаунта Нурбека): список всех установок Nucleus
// на устройствах пользователей — имя, email, платформа (Windows/Android),
// модель устройства, версии ОС и приложения. Фильтры «Все / Android / Windows».

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

type Filter = 'all' | 'android' | 'windows'

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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')

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

  useEffect(() => {
    let active = true
    void loadRows().then(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin])

  // Живое обновление списка: как только устройство пользователя пишет heartbeat
  // (или появляется новая установка), таблица меняется -> перечитываем.
  useEffect(() => {
    if (!admin) return
    return onSyncEvent(['app_installs'], () => {
      void loadRows()
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
      </div>

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
    </div>
  )
}
