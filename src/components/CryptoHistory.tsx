import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useLang } from '../lib/i18n'
import { monthName } from '../lib/db'
import PeriodFilter, { type PeriodValue } from './PeriodFilter'
import {
  loadCryptoHistory,
  fmtUsd,
  fmtQty,
  fmtPct,
  type HistoryMonth,
  type HistorySpotEntry,
  type HistoryFutureEntry,
} from '../lib/crypto'

// Подробная история инвестиций по месяцам: спот-сделки по монетам и фьючерсы,
// с реализованным результатом и процентами. Стиль и фильтры -- как во вкладке
// «История» обычного учёта (период сверху, сортировка, раскрывающиеся карточки).

type T = (key: string, vars?: Record<string, string | number>) => string

const pad = (n: number) => String(n).padStart(2, '0')

function pnlColor(n: number | null | undefined): string {
  if (n == null) return 'text-neutral-500 dark:text-neutral-400'
  if (n > 0) return 'text-emerald-600 dark:text-emerald-400'
  if (n < 0) return 'text-red-500 dark:text-red-400'
  return 'text-neutral-500 dark:text-neutral-400'
}

const chipCls = (active: boolean) =>
  'rounded-full border px-3 py-1 text-xs transition ' +
  (active
    ? 'border-emerald-500 bg-emerald-500 font-medium text-neutral-950'
    : 'border-neutral-300 text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800')

const badgeCls = 'rounded-full px-2 py-0.5 text-[11px] font-medium'

function Field({
  label,
  value,
  className = '',
}: {
  label: string
  value: string
  className?: string
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-neutral-400 dark:text-neutral-500">{label}</div>
      <div className={'text-sm font-medium ' + className}>{value}</div>
    </div>
  )
}

function SpotRow({ e, t }: { e: HistorySpotEntry; t: T }) {
  return (
    <div className="rounded-lg border border-neutral-200 p-2.5 dark:border-neutral-800">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium">{e.symbol}</span>
            {e.closedInMonth && (
              <span
                className={
                  badgeCls +
                  ' bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
                }
              >
                {t('cryptoHist.closed')}
              </span>
            )}
          </div>
          {e.name && (
            <div className="truncate text-xs text-neutral-500 dark:text-neutral-400">
              {e.name}
            </div>
          )}
        </div>
        {e.realizedPnl != null && (
          <div className={`shrink-0 text-right text-sm font-semibold ${pnlColor(e.realizedPnl)}`}>
            {fmtUsd(e.realizedPnl)}
            <span className="block text-xs font-medium">{fmtPct(e.realizedPct)}</span>
          </div>
        )}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {e.buyQty > 0 && (
          <Field
            label={t('cryptoHist.bought')}
            value={`${fmtQty(e.buyQty)} · ${fmtUsd(e.buyCost)}`}
          />
        )}
        {e.sellQty > 0 && (
          <Field
            label={t('cryptoHist.sold')}
            value={`${fmtQty(e.sellQty)} · ${fmtUsd(e.sellProceeds)}`}
          />
        )}
      </div>
    </div>
  )
}

function FutureRow({ f, t }: { f: HistoryFutureEntry; t: T }) {
  const isLong = f.direction === 'long'
  return (
    <div className="rounded-lg border border-neutral-200 p-2.5 dark:border-neutral-800">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="font-medium">{f.symbol}</span>
          <span
            className={
              badgeCls +
              (isLong
                ? ' bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                : ' bg-red-500/15 text-red-600 dark:text-red-400')
            }
          >
            {isLong ? t('cryptoHist.long') : t('cryptoHist.short')}
          </span>
          <span
            className={
              badgeCls +
              (f.closed
                ? ' bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
                : ' bg-emerald-500/15 text-emerald-700 dark:text-emerald-400')
            }
          >
            {f.closed ? t('cryptoHist.closed') : t('cryptoHist.openPos')}
          </span>
        </div>
        {f.closed && f.pnl != null && (
          <div className={`shrink-0 text-right text-sm font-semibold ${pnlColor(f.pnl)}`}>
            {fmtUsd(f.pnl)}
            <span className="block text-xs font-medium">{fmtPct(f.pnlPct)}</span>
          </div>
        )}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Field label={t('cryptoHist.margin')} value={fmtUsd(f.margin)} />
        {f.exit != null && <Field label={t('cryptoHist.exit')} value={fmtUsd(f.exit)} />}
      </div>
    </div>
  )
}

export default function CryptoHistory() {
  const { user } = useAuth()
  const { t } = useLang()
  const [months, setMonths] = useState<HistoryMonth[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [period, setPeriod] = useState<PeriodValue | null>(null)
  const [sortOrder, setSortOrder] = useState<'new' | 'old'>('new')

  const reload = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setError(null)
    try {
      setMonths(await loadCryptoHistory(user.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void reload()
  }, [reload])

  // Итог месяца: если задана месячная сводка -- берём её итог; иначе считаем
  // реализованный спот плюс закрытые фьючерсы.
  const monthResult = (m: HistoryMonth) =>
    m.monthly ? m.monthly.pnl : m.spotRealized + m.futuresPnl

  const visible = months
    .filter((m) => {
      if (!period) return true
      const s = m.year + '-' + pad(m.month) + '-01'
      const e = m.year + '-' + pad(m.month) + '-31'
      return e >= period.start && s <= period.end
    })
    .sort((a, b) => {
      const cmp = a.year !== b.year ? a.year - b.year : a.month - b.month
      return sortOrder === 'new' ? -cmp : cmp
    })

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      <PeriodFilter
        onChange={setPeriod}
        modes={['month', 'year', 'all', 'range']}
        modesAlign="center"
      />

      {loading ? (
        <div className="py-10 text-center text-sm text-neutral-500 dark:text-neutral-400">
          {t('common.loading')}
        </div>
      ) : months.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900/50 dark:text-neutral-400">
          {t('cryptoHist.empty')}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-500">{t('common.sort')}</span>
            <button
              type="button"
              onClick={() => setSortOrder('new')}
              className={chipCls(sortOrder === 'new')}
            >
              {t('common.sortNew')}
            </button>
            <button
              type="button"
              onClick={() => setSortOrder('old')}
              className={chipCls(sortOrder === 'old')}
            >
              {t('common.sortOld')}
            </button>
          </div>

          {visible.length === 0 ? (
            <p className="text-sm text-neutral-500">{t('cryptoHist.noPeriod')}</p>
          ) : (
            visible.map((m) => {
              const open = openKey === m.key
              const res = monthResult(m)
              return (
                <div
                  key={m.key}
                  className="overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/40"
                >
                  <button
                    type="button"
                    onClick={() => setOpenKey(open ? null : m.key)}
                    className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition hover:bg-neutral-100 dark:hover:bg-neutral-800/40"
                  >
                    <span className="flex min-w-0 items-center gap-2 font-medium">
                      <span
                        className={`text-neutral-400 transition-transform ${open ? 'rotate-90' : ''}`}
                      >
                        ›
                      </span>
                      <span className="truncate">
                        {monthName(m.month - 1)} {m.year}
                      </span>
                    </span>
                    <span className={`shrink-0 text-right text-sm font-semibold ${pnlColor(res)}`}>
                      {fmtUsd(res)}
                      {m.monthly && (
                        <span className="block text-xs font-medium">
                          {fmtPct(m.monthly.pnlPct)}
                        </span>
                      )}
                    </span>
                  </button>

                  {open && (
                    <div className="animate-pop flex flex-col gap-4 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
                      {m.monthly && (
                        <div>
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                            {t('cryptoHist.monthStats')}
                          </p>
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <Field
                              label={t('cryptoHist.start')}
                              value={fmtUsd(m.monthly.start_value_usd)}
                            />
                            <Field
                              label={t('cryptoHist.deposit')}
                              value={fmtUsd(m.monthly.deposit_usd)}
                            />
                            <Field
                              label={t('cryptoHist.end')}
                              value={fmtUsd(m.monthly.end_value_usd)}
                            />
                            <Field
                              label={t('cryptoHist.result')}
                              value={fmtUsd(m.monthly.pnl)}
                              className={pnlColor(m.monthly.pnl)}
                            />
                          </div>
                        </div>
                      )}

                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                          {t('cryptoHist.spot')}
                        </p>
                        {m.spot.length === 0 ? (
                          <p className="text-xs text-neutral-500 dark:text-neutral-400">
                            {t('cryptoHist.noSpot')}
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {m.spot.map((e) => (
                              <SpotRow key={e.assetId} e={e} t={t} />
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="border-t border-neutral-200 dark:border-neutral-800" />

                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-orange-500 dark:text-orange-400">
                          {t('cryptoHist.futures')}
                        </p>
                        {m.futures.length === 0 ? (
                          <p className="text-xs text-neutral-500 dark:text-neutral-400">
                            {t('cryptoHist.noFutures')}
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {m.futures.map((f) => (
                              <FutureRow key={f.id} f={f} t={t} />
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
