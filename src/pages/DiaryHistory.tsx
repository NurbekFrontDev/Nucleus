import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useLang } from '../lib/i18n'
import { deleteEntry, fetchEntriesRange, saveEditedEntry, type DiaryEntry } from '../lib/diary'
import { isVaultSyncAvailable, removeEntryFromVault, syncVault } from '../lib/vaultSync'
import { readCache, writeCache } from '../lib/offlineCache'
import { onSyncEvent } from '../lib/realtimeSync'
import { showToast } from '../lib/toast'
import { log } from '../lib/logger'
import DiaryEntryCard from '../components/DiaryEntryCard'

// Экран «История»: лента дней (дата, число записей, теги, среднее настроение)
// с раскрытием карточек, поиском по выжимкам/тегам/оригиналу, фильтром по
// периоду (день/неделя/месяц/год/всё) и сортировкой.

const HISTORY_WINDOW_DAYS = 365
const CACHE_KEY = 'diary:history'

type PeriodFilter = 'all' | 'year' | 'month' | 'week' | 'day'
type SortOrder = 'newest' | 'oldest'

// Граница периода, в который попадает указанная дата (локальный календарь).
function periodStart(dateStr: string, period: PeriodFilter): string | null {
  const [y, m, d] = dateStr.split('-').map(Number)
  if (!y) return null
  const entry = new Date(y, (m ?? 1) - 1, d ?? 1)
  if (period === 'year') {
    return `${y}-01-01`
  }
  if (period === 'month') {
    return `${y}-${String(m ?? 1).padStart(2, '0')}-01`
  }
  if (period === 'week') {
    // Неделя начинается с понедельника (как в Daily Notes вольта).
    const day = (entry.getDay() + 6) % 7
    const start = new Date(entry)
    start.setDate(entry.getDate() - day)
    return localDate(start)
  }
  if (period === 'day') {
    return dateStr
  }
  return null
}

function localDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Список периодов для фильтра: каждый — граница + человекочитаемая подпись.
function buildPeriods(entries: DiaryEntry[], period: PeriodFilter, lang: string): Array<{ key: string; label: string }> {
  const map = new Map<string, string[]>()
  for (const e of entries) {
    const key = periodStart(e.entry_date, period)
    if (!key) continue
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(e.entry_date)
  }
  const locale = lang === 'en' ? 'en-US' : 'ru-RU'
  const keys = [...map.keys()].sort((a, b) => (a < b ? 1 : -1))
  return keys.map((key) => {
    const dates = map.get(key)!.sort()
    const y0 = Number(dates[0].slice(0, 4))
    const m0 = Number(dates[0].slice(5, 7)) - 1
    const d0 = Number(dates[0].slice(8, 10))
    const first = new Date(y0, m0, d0)
    const last = new Date(Number(dates[dates.length - 1].slice(0, 4)), Number(dates[dates.length - 1].slice(5, 7)) - 1, Number(dates[dates.length - 1].slice(8, 10)))
    let label: string
    if (period === 'year') label = new Date(Number(key.slice(0, 4)), 0, 1).toLocaleDateString(locale, { year: 'numeric' })
    else if (period === 'month') label = first.toLocaleDateString(locale, { month: 'long', year: 'numeric' })
    else if (period === 'week') label = `${first.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} — ${last.toLocaleDateString(locale, { day: 'numeric', month: 'short' })}`
    else label = first.toLocaleDateString(locale, { day: 'numeric', month: 'long', weekday: 'short' })
    return { key, label }
  })
}

type DayGroup = {
  date: string
  entries: DiaryEntry[]
  tags: string[]
  avgMood: number | null
}

function buildDayGroups(dates: string[], byDate: Map<string, DiaryEntry[]>): DayGroup[] {
  return dates.map((date) => {
    const dayEntries = byDate.get(date) ?? []
    const tagCount = new Map<string, number>()
    let moodSum = 0
    let moodN = 0
    for (const e of dayEntries) {
      for (const tag of e.summary?.tags ?? []) {
        tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1)
      }
      if (typeof e.summary?.mood_score === 'number') {
        moodSum += e.summary.mood_score
        moodN++
      }
    }
    const topTags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([tag]) => tag)
    return {
      date,
      entries: dayEntries,
      tags: topTags,
      avgMood: moodN > 0 ? moodSum / moodN : null,
    }
  })
}

function fmtDay(lang: string, date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(lang === 'en' ? 'en-US' : 'ru-RU', {
    day: 'numeric',
    month: 'long',
    weekday: 'short',
  })
}

export default function DiaryHistory() {
  const { user } = useAuth()
  const { t, lang } = useLang()
  const userId = user?.id

  const [entries, setEntries] = useState<DiaryEntry[]>(
    () => readCache<DiaryEntry[]>(CACHE_KEY + ':' + (user?.id ?? '')) ?? [],
  )
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<DiaryEntry[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [period, setPeriod] = useState<PeriodFilter>('all')
  const [activePeriod, setActivePeriod] = useState<string | null>(null)
  const [sort, setSort] = useState<SortOrder>('newest')

  const reload = useCallback(async () => {
    if (!userId) return
    const fromDate = new Date(Date.now() - HISTORY_WINDOW_DAYS * 86400_000)
      .toISOString()
      .slice(0, 10)
    try {
      const list = await fetchEntriesRange(userId, fromDate, new Date().toISOString().slice(0, 10))
      setEntries(list)
      writeCache(CACHE_KEY + ':' + userId, list)
    } catch {
      // офлайн: остаётся локальный кэш
    }
  }, [userId])

  useEffect(() => {
    void reload()
    return onSyncEvent(['diary_entries'], () => void reload())
  }, [reload])

  // ===== Удаление/редактирование записей из истории =====
  const handleDelete = useCallback(
    async (entry: DiaryEntry) => {
      if (!userId) return
      try {
        await deleteEntry(userId, entry)
        if (isVaultSyncAvailable()) await removeEntryFromVault(entry)
        await reload()
        showToast(t('diary.deleted'))
        log.info('diary', 'Entry deleted (history)', { id: entry.id }, userId)
      } catch {
        showToast(t('diary.deleteFail'))
      }
    },
    [userId, reload, t],
  )

  const handleEdit = useCallback(
    async (entry: DiaryEntry, newText: string) => {
      if (!userId) return
      showToast(t('diary.reSummarizing'))
      try {
        const updated = await saveEditedEntry(userId, entry.id, newText)
        await reload()
        if (isVaultSyncAvailable() && updated) {
          await syncVault(userId)
        }
      } catch {
        showToast(t('diary.editFail'))
        throw new Error('edit-failed')
      }
    },
    [userId, reload, t],
  )

  // Поиск: по заголовку и тексту выжимки, тегам (весь jsonb) и оригиналу.
  const runSearch = useCallback(
    async () => {
      if (!userId) return
      const q = query.trim().replace(/[,()]/g, ' ')
      if (q.length < 2) {
        setSearchResults(null)
        return
      }
      setSearching(true)
      try {
        const { supabase } = await import('../lib/supabase')
        const pattern = `%${q}%`
        const { data } = await supabase
          .from('diary_entries')
          .select('*')
          .eq('user_id', userId)
          .or(
            [
              `summary->>title.ilike.${pattern}`,
              `summary->>summary_text.ilike.${pattern}`,
              `summary::text.ilike.${pattern}`,
              `original_text.ilike.${pattern}`,
            ].join(','),
          )
          .order('entry_date', { ascending: false })
          .order('created_at', { ascending: true })
          .limit(200)
        setSearchResults((data ?? []) as unknown as DiaryEntry[])
      } catch {
        setSearchResults(null)
      } finally {
        setSearching(false)
      }
    },
    [userId, query],
  )

  useEffect(() => {
    const timer = window.setTimeout(() => void runSearch(), 350)
    return () => window.clearTimeout(timer)
  }, [query, runSearch])

  const months = useMemo(() => {
    const base = searchResults ?? entries
    // Фильтр по периоду: показываем только дни выбранного интервала.
    const filtered =
      period === 'all' || !activePeriod
        ? base
        : base.filter((e) => periodStart(e.entry_date, period) === activePeriod)

    // Группировка: для 'all' и 'year' — по месяцам, для остальных — по самому
    // периоду (неделя/день как одна группа).
    const byDate = new Map<string, DiaryEntry[]>()
    for (const e of filtered) {
      if (!byDate.has(e.entry_date)) byDate.set(e.entry_date, [])
      byDate.get(e.entry_date)!.push(e)
    }
    let dates = [...byDate.keys()]
    dates.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    if (sort === 'oldest') dates = [...dates].reverse()

    if (period === 'all' || period === 'year' || period === 'month') {
      // Месячные секции.
      const sections = new Map<string, string[]>()
      for (const d of dates) {
        const mk = d.slice(0, 7)
        if (!sections.has(mk)) sections.set(mk, [])
        sections.get(mk)!.push(d)
      }
      const fmt = new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'ru-RU', {
        month: 'long',
        year: 'numeric',
      })
      return [...sections.entries()]
        .sort(([a], [b]) => (sort === 'oldest' ? (a < b ? -1 : 1) : a < b ? 1 : -1))
        .map(([mk, ds]) => {
          const monthDate = new Date(Number(mk.slice(0, 4)), Number(mk.slice(5, 7)) - 1, 1)
          return { key: mk, label: fmt.format(monthDate), days: buildDayGroups(ds, byDate) }
        })
    }
    // Недельные/дневные секции.
    const periods = buildPeriods(filtered, period === 'day' ? 'day' : 'week', lang)
    return periods.map((p) => ({
      key: p.key,
      label: p.label,
      days: buildDayGroups(dates.filter((d) => periodStart(d, period) === p.key), byDate),
    }))
  }, [searchResults, entries, lang, period, activePeriod, sort])

  const periodOptions: Array<{ id: PeriodFilter; label: string }> = [
    { id: 'all', label: t('diary.filter.all') },
    { id: 'year', label: t('diary.filter.year') },
    { id: 'month', label: t('diary.filter.month') },
    { id: 'week', label: t('diary.filter.week') },
    { id: 'day', label: t('diary.filter.day') },
  ]

  const availablePeriods = useMemo(
    () => (period === 'all' ? [] : buildPeriods(searchResults ?? entries, period, lang)),
    [searchResults, entries, period],
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between px-1 pt-1">
        <h1 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">
          🗓️ {t('dnav.history')}
        </h1>
        <span className="text-sm text-neutral-400">
          {t('diary.entriesCount', { n: searchResults?.length ?? entries.length })}
        </span>
      </div>

      {/* Поиск */}
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('diary.searchPlaceholder')}
        className="w-full rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 text-sm text-neutral-900 outline-none transition focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
      />

      {/* Фильтры периода + сортировка */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-1 overflow-x-auto rounded-xl bg-neutral-200/60 p-1 dark:bg-neutral-800/60">
          {periodOptions.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => {
                setPeriod(o.id)
                setActivePeriod(null)
              }}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                period === o.id
                  ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
                  : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

        {period !== 'all' && availablePeriods.length > 0 && (
          <div className="flex gap-1 overflow-x-auto">
            <button
              type="button"
              onClick={() => setActivePeriod(null)}
              className={`shrink-0 rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                activePeriod === null
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'border-neutral-200 text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800'
              }`}
            >
              {t('diary.filter.all')}
            </button>
            {availablePeriods.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setActivePeriod(p.key)}
                className={`shrink-0 rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                  activePeriod === p.key
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                    : 'border-neutral-200 text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-1 rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800/60">
          {(['newest', 'oldest'] as SortOrder[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSort(s)}
              className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition ${
                sort === s
                  ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
                  : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400'
              }`}
            >
              {s === 'newest' ? '↓' : '↑'} {t(s === 'newest' ? 'diary.sortNewest' : 'diary.sortOldest')}
            </button>
          ))}
        </div>
      </div>

      {searching && <div className="px-1 text-xs text-neutral-400">…</div>}

      {/* Лента по секциям */}
      {months.length === 0 && !searching && (
        <div className="rounded-2xl border border-dashed border-neutral-200 p-8 text-center text-sm text-neutral-400 dark:border-neutral-800">
          {query.trim().length >= 2 ? t('diary.noResults') : t('diary.historyEmpty')}
        </div>
      )}

      {months.map((section) => (
        <section key={section.key}>
          <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wider text-neutral-400">
            {section.label}
          </h2>
          <div className="flex flex-col gap-2">
            {section.days.map((day) => (
              <details
                key={day.date}
                className="group rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/60"
              >
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 p-4">
                  <span className="min-w-28 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                    {fmtDay(lang, day.date)}
                  </span>
                  <span className="text-xs text-neutral-400">
                    {t('diary.entriesCount', { n: day.entries.length })}
                  </span>
                  <span className="ml-auto flex items-center gap-1.5">
                    {day.tags.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="hidden rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500 sm:inline dark:bg-neutral-800 dark:text-neutral-400"
                      >
                        #{tag}
                      </span>
                    ))}
                    {day.avgMood !== null && (
                      <span className="text-xs text-neutral-500 dark:text-neutral-400" title={t('diary.avgMood')}>
                        {day.avgMood >= 7 ? '😊' : day.avgMood >= 5 ? '😐' : '😔'} {Math.round(day.avgMood)}/10
                      </span>
                    )}
                    <span className="text-xs text-neutral-300 transition group-open:rotate-90 dark:text-neutral-600">
                      ▸
                    </span>
                  </span>
                </summary>
                <div className="flex flex-col gap-2.5 border-t border-neutral-100 p-3 dark:border-neutral-800">
                  {day.entries.map((entry) => (
                    <DiaryEntryCard
                      key={entry.id}
                      entry={entry}
                      onEdit={handleEdit}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              </details>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
