import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useLang } from '../lib/i18n'
import { fetchEntriesRange, type DiaryEntry } from '../lib/diary'
import { readCache, writeCache } from '../lib/offlineCache'
import { onSyncEvent } from '../lib/realtimeSync'
import DiaryEntryCard from '../components/DiaryEntryCard'

// Экран «История»: лента дней по месяцам (дата, число записей, теги, среднее
// настроение) с раскрытием карточек и поиском по выжимкам/тегам/оригиналу
// (v1 — ilike без векторов).

const HISTORY_WINDOW_DAYS = 90
const CACHE_KEY = 'diary:history'

type MonthGroup = {
  key: string
  label: string
  days: DayGroup[]
}

type DayGroup = {
  date: string
  entries: DiaryEntry[]
  tags: string[]
  avgMood: number | null
}

function groupByMonths(entries: DiaryEntry[], lang: string): MonthGroup[] {
  const fmt = new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'ru-RU', {
    month: 'long',
    year: 'numeric',
  })
  const months = new Map<string, Map<string, DiaryEntry[]>>()
  for (const e of entries) {
    const mk = e.entry_date.slice(0, 7)
    if (!months.has(mk)) months.set(mk, new Map())
    const days = months.get(mk)!
    if (!days.has(e.entry_date)) days.set(e.entry_date, [])
    days.get(e.entry_date)!.push(e)
  }

  return [...months.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([mk, days]) => ({
      key: mk,
      label: fmt.format(new Date(Number(mk.slice(0, 4)), Number(mk.slice(5, 7)) - 1, 1)),
      days: [...days.entries()]
        .sort(([a], [b]) => (a < b ? 1 : -1))
        .map(([date, dayEntries]) => {
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
          const topTags = [...tagCount.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([tag]) => tag)
          return {
            date,
            entries: dayEntries,
            tags: topTags,
            avgMood: moodN > 0 ? moodSum / moodN : null,
          }
        }),
    }))
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

  const months = useMemo(() => groupByMonths(searchResults ?? entries, lang), [searchResults, entries, lang])

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

      {searching && <div className="px-1 text-xs text-neutral-400">…</div>}

      {/* Лента по месяцам */}
      {months.length === 0 && !searching && (
        <div className="rounded-2xl border border-dashed border-neutral-200 p-8 text-center text-sm text-neutral-400 dark:border-neutral-800">
          {query.trim().length >= 2 ? t('diary.noResults') : t('diary.historyEmpty')}
        </div>
      )}

      {months.map((month) => (
        <section key={month.key}>
          <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wider text-neutral-400">
            {month.label}
          </h2>
          <div className="flex flex-col gap-2">
            {month.days.map((day) => (
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
                    <DiaryEntryCard key={entry.id} entry={entry} />
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
