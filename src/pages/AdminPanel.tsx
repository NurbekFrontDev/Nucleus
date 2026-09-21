import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useLang } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import { isAdminEmail } from '../lib/installs'
import { onSyncEvent } from '../lib/realtimeSync'

// Админ-панель (только для аккаунта Нурбека): список всех установок Nucleus
// на устройствах пользователей — имя, email, платформа (Windows/Android),
// модель устройства, версии ОС и приложения, активность. Фильтры
// «Все / Android / Windows». Данные пишет каждая установка при запуске
// (sendInstallHeartbeat -> app_installs), читаются строки по RLS-политике админа.

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

const pad = (n: number) => String(n).padStart(2, '0')

const platformBadge = (p: string, lang: 'ru' | 'en'): string => {
  if (p === 'windows') return lang === 'ru' ? '🪟 Windows' : '🪟 Windows'
  if (p === 'android') return lang === 'ru' ? '🤖 Android' : '🤖 Android'
  return '🌐 Web'
}

export default function AdminPanel() {
  const { user } = useAuth()
  const { t, lang } = useLang()
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

  // «Активны за неделю» — считаем по строковой дате, без Date.now() в рендере.
  const weekActive = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    const cutoffISO = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    return rows.filter((r) => (r.last_seen ?? '') >= cutoffISO).length
  }, [rows])

  // Граница «активен сегодня» — вычисляется один раз (ленивый инициализатор),
  // чтобы не вызывать Date.now() в теле рендера.
  const [activeCutoff] = useState(() => Date.now() - 24 * 60 * 60 * 1000)

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

  // «3 мин назад» / «сегодня в 14:32» / «21.09.2026»
  const fmtLastSeen = (iso: string): string => {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return iso
    const now = new Date()
    const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000)
    const sameDay = d.toDateString() === now.toDateString()
    const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
    if (lang === 'en') {
      if (diffMin < 1) return 'just now'
      if (diffMin < 60) return `${diffMin} min ago`
      if (sameDay) return `today at ${hhmm}`
      const days = Math.floor(diffMin / 1440)
      if (days === 1) return 'yesterday'
      return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
    }
    if (diffMin < 1) return 'только что'
    if (diffMin < 60) return `${diffMin} мин назад`
    if (sameDay) return `сегодня в ${hhmm}`
    const days = Math.floor(diffMin / 1440)
    if (days === 1) return 'вчера'
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
  }

  const isActiveRecent = (iso: string): boolean => {
    const d = new Date(iso)
    return !isNaN(d.getTime()) && d.getTime() >= activeCutoff
  }

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
    { id: 'android', label: '🤖 Android', count: counts.android },
    { id: 'windows', label: '🪟 Windows', count: counts.windows },
  ]

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      {/* Закреплённая шапка */}
      <div className="sticky top-0 z-20 -mx-4 flex items-center justify-between gap-2 border-b border-neutral-200/70 bg-white/85 px-4 py-3 backdrop-blur dark:border-neutral-800/70 dark:bg-neutral-950/85">
        <h1 className="text-xl font-semibold">🛡️ {t('admin.title')}</h1>
        <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-300">
          {t('admin.devicesCount', { n: rows.length })}
        </span>
      </div>

      {/* Сводка */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: t('admin.statAll'), value: counts.all, icon: '📱' },
          { label: 'Android', value: counts.android, icon: '🤖' },
          { label: 'Windows', value: counts.windows, icon: '🪟' },
          { label: t('admin.statWeek'), value: weekActive, icon: '⚡' },
        ].map((s) => (
          <div key={s.label} className={`${cardCls} flex flex-col items-center gap-0.5 py-3 text-center`}>
            <span className="text-lg leading-none">{s.icon}</span>
            <span className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{s.value}</span>
            <span className="text-[11px] leading-tight text-neutral-500 dark:text-neutral-400">
              {s.label}
            </span>
          </div>
        ))}
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
          {filtered.map((r) => (
            <div key={r.id} className={`flex items-start gap-3 ${cardCls}`}>
              <span className="mt-0.5 shrink-0 text-lg leading-none">
                {r.platform === 'windows' ? '🪟' : r.platform === 'android' ? '🤖' : '🌐'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="break-words text-sm font-medium">
                    {r.user_name || r.email || '—'}
                  </p>
                  <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                    {platformBadge(r.platform, lang)}
                  </span>
                </div>
                {r.email && (
                  <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{r.email}</p>
                )}
                <p className="mt-0.5 break-words text-xs text-neutral-500 dark:text-neutral-400">
                  {[r.device_name, r.os_version, `v${r.app_version ?? '?'}`]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                <p className="mt-0.5 text-xs">
                  <span
                    className={
                      isActiveRecent(r.last_seen)
                        ? 'font-medium text-emerald-600 dark:text-emerald-400'
                        : 'text-neutral-400'
                    }
                  >
                    ⏱ {t('admin.lastSeen')}: {fmtLastSeen(r.last_seen)}
                  </span>
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
