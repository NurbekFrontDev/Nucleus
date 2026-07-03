import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useLang } from '../lib/i18n'
import { formatDateHuman } from '../lib/db'
import DatePicker from './DatePicker'
import IconButton from './IconButton'
import ConfirmDialog from './ConfirmDialog'
import {
  loadFutures,
  createFuture,
  closeFuture,
  reopenFuture,
  deleteFuture,
  fmtUsd,
  fmtPct,
  parseNum,
  type FutureStats,
  type FutureDirection,
} from '../lib/crypto'
import { readCache, writeCache } from '../lib/offlineCache'

const todayISO = () => new Date().toISOString().slice(0, 10)

const cardCls =
  'rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50'
const inputCls =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950'
const btnPrimary =
  'rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-50'
const btnGhost =
  'rounded-lg border border-neutral-300 px-3 py-2 text-sm transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
const labelCls = 'mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400'

export default function CryptoFutures() {
  const { user } = useAuth()
  const { t } = useLang()

  const cachedFut = readCache<FutureStats[]>(`crypto-fut:${user?.id ?? 'anon'}`)
  const [futures, setFutures] = useState<FutureStats[]>(cachedFut ?? [])
  const [loading, setLoading] = useState(!cachedFut)
  const [error, setError] = useState<string | null>(null)

  // Форма добавления позиции
  const [aSymbol, setASymbol] = useState('')
  const [aDirection, setADirection] = useState<FutureDirection>('long')
  const [aMargin, setAMargin] = useState('')
  const [aDate, setADate] = useState(todayISO())
  const [errSymbol, setErrSymbol] = useState(false)
  const [errMargin, setErrMargin] = useState(false)
  const [saving, setSaving] = useState(false)
  // Форма добавления позиции свёрнута по умолчанию; раскрывается по нажатию.
  const [addOpen, setAddOpen] = useState(false)

  // Закрытие позиции
  const [closingId, setClosingId] = useState<string | null>(null)
  const [cExit, setCExit] = useState('')
  const [cDate, setCDate] = useState(todayISO())
  const [errExit, setErrExit] = useState(false)

  const [toDelete, setToDelete] = useState<FutureStats | null>(null)

  const reload = useCallback(async () => {
    if (!user) return
    const ck = `crypto-fut:${user.id}`
    const cached = readCache<FutureStats[]>(ck)
    if (cached) {
      setFutures(cached)
      setLoading(false)
    } else {
      setLoading(true)
    }
    setError(null)
    try {
      const list = await loadFutures(user.id)
      setFutures(list)
      writeCache(ck, list)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void reload()
  }, [reload])

  async function handleAdd() {
    if (!user) return
    const symbol = aSymbol.trim()
    const margin = parseNum(aMargin)
    const badSymbol = symbol.length === 0
    const badMargin = margin <= 0
    setErrSymbol(badSymbol)
    setErrMargin(badMargin)
    if (badSymbol || badMargin) return
    setSaving(true)
    setError(null)
    try {
      await createFuture(user.id, {
        symbol,
        direction: aDirection,
        opened_at: aDate,
        margin_usd: margin,
      })
      setASymbol('')
      setADirection('long')
      setAMargin('')
      setADate(todayISO())
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  function startClose(f: FutureStats) {
    setClosingId(f.id)
    setCExit('')
    setCDate(todayISO())
    setErrExit(false)
  }

  async function handleClose(id: string) {
    const exit = parseNum(cExit)
    if (exit <= 0) {
      setErrExit(true)
      return
    }
    setError(null)
    try {
      await closeFuture(id, cDate, exit)
      setClosingId(null)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleReopen(id: string) {
    setError(null)
    try {
      await reopenFuture(id)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleDelete() {
    if (!toDelete) return
    setError(null)
    try {
      await deleteFuture(toDelete.id)
      setToDelete(null)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const totalMargin = futures.reduce((s, f) => s + Number(f.margin_usd), 0)
  const totalPnl = futures.reduce((s, f) => s + (f.pnl ?? 0), 0)

  const pnlColor = (n: number | null | undefined) =>
    n == null
      ? 'text-neutral-500 dark:text-neutral-400'
      : n > 0
        ? 'text-emerald-600 dark:text-emerald-400'
        : n < 0
          ? 'text-red-600 dark:text-red-400'
          : 'text-neutral-500 dark:text-neutral-400'

  if (loading) {
    return (
      <div className="py-10 text-center text-sm text-neutral-500 dark:text-neutral-400">
        {t('common.loading')}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Сводка */}
      {futures.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div className={cardCls}>
            <div className={labelCls}>{t('fut.totalMargin')}</div>
            <div className="text-lg font-semibold">{fmtUsd(totalMargin)}</div>
          </div>
          <div className={cardCls}>
            <div className={labelCls}>{t('fut.totalPnl')}</div>
            <div className={'text-lg font-semibold ' + pnlColor(totalPnl)}>
              {fmtUsd(totalPnl)}
            </div>
          </div>
        </div>
      )}

      {/* Список позиций */}
      {futures.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900/50 dark:text-neutral-400">
          {t('fut.empty')}
        </div>
      ) : (
        <div className="space-y-3">
          {futures.map((f) => {
            const isLong = f.direction === 'long'
            const isClosed = f.status === 'closed'
            return (
              <div key={f.id} className={cardCls}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{f.symbol}</span>
                      <span
                        className={
                          'rounded-md px-2 py-0.5 text-xs font-medium ' +
                          (isLong
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300')
                        }
                      >
                        {isLong ? t('fut.long') : t('fut.short')}
                      </span>
                      <span
                        className={
                          'rounded-md px-2 py-0.5 text-xs ' +
                          (isClosed
                            ? 'bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
                            : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300')
                        }
                      >
                        {isClosed ? t('fut.statusClosed') : t('fut.statusOpen')}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                      {isClosed
                        ? t('fut.closedOn', { d: formatDateHuman(f.closed_at ?? f.opened_at) })
                        : t('fut.openSince', { d: formatDateHuman(f.opened_at) })}
                    </div>
                  </div>
                  <div className="shrink-0">
                    <IconButton
                      icon="delete"
                      onClick={() => setToDelete(f)}
                      title={t('common.delete')}
                    />
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <div className={labelCls}>{t('fut.margin')}</div>
                    <div>{fmtUsd(Number(f.margin_usd))}</div>
                  </div>
                  {isClosed && (
                    <>
                      <div>
                        <div className={labelCls}>{t('fut.exit')}</div>
                        <div>{fmtUsd(f.exit_usd)}</div>
                      </div>
                      <div>
                        <div className={labelCls}>{t('fut.pnl')}</div>
                        <div className={pnlColor(f.pnl)}>
                          {fmtUsd(f.pnl)} ({fmtPct(f.pnlPct)})
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {!isClosed && (
                  <div className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                    {t('fut.openHint')}
                  </div>
                )}

                {/* Действия */}
                <div className="mt-3">
                  {isClosed ? (
                    <button className={btnGhost} onClick={() => handleReopen(f.id)}>
                      {t('fut.reopen')}
                    </button>
                  ) : closingId === f.id ? (
                    <div className="space-y-3 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className={labelCls}>{t('fut.exit')}</label>
                          <input
                            className={inputCls}
                            inputMode="decimal"
                            value={cExit}
                            onChange={(e) => setCExit(e.target.value)}
                            placeholder="0"
                          />
                          {errExit && (
                            <div className="mt-1 text-xs text-red-600 dark:text-red-400">
                              {t('fut.errExit')}
                            </div>
                          )}
                        </div>
                        <div>
                          <label className={labelCls}>{t('fut.closeDate')}</label>
                          <DatePicker value={cDate} onChange={setCDate} />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button className={btnPrimary} onClick={() => handleClose(f.id)}>
                          {t('fut.confirmClose')}
                        </button>
                        <button className={btnGhost} onClick={() => setClosingId(null)}>
                          {t('common.cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button className={btnGhost} onClick={() => startClose(f)}>
                      {t('fut.close')}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Форма добавления позиции — свёрнута по умолчанию, раскрывается по нажатию. */}
      {!addOpen ? (
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="flex w-full items-center justify-between rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm font-medium transition hover:border-emerald-400 dark:border-neutral-800 dark:bg-neutral-900/50 dark:hover:border-emerald-600"
        >
          <span>{t('fut.add')}</span>
          <span className="text-neutral-400">▾</span>
        </button>
      ) : (
      <div className={cardCls}>
        <button
          type="button"
          onClick={() => setAddOpen(false)}
          className="mb-3 flex w-full items-center justify-between text-sm font-medium text-neutral-500 transition hover:text-neutral-800 dark:hover:text-neutral-200"
        >
          <span>{t('fut.add')}</span>
          <span className="text-neutral-400">▴</span>
        </button>
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>{t('fut.symbol')}</label>
              <input
                className={inputCls}
                value={aSymbol}
                onChange={(e) => setASymbol(e.target.value)}
                placeholder="BTC"
              />
              {errSymbol && (
                <div className="mt-1 text-xs text-red-600 dark:text-red-400">
                  {t('fut.errSymbol')}
                </div>
              )}
            </div>
            <div>
              <label className={labelCls}>{t('fut.direction')}</label>
              <div className="flex overflow-hidden rounded-lg border border-neutral-300 dark:border-neutral-700">
                <button
                  type="button"
                  className={
                    'flex-1 px-3 py-2 text-sm transition ' +
                    (aDirection === 'long'
                      ? 'bg-emerald-500 font-medium text-neutral-950'
                      : 'hover:bg-neutral-100 dark:hover:bg-neutral-800')
                  }
                  onClick={() => setADirection('long')}
                >
                  {t('fut.long')}
                </button>
                <button
                  type="button"
                  className={
                    'flex-1 px-3 py-2 text-sm transition ' +
                    (aDirection === 'short'
                      ? 'bg-red-500 font-medium text-neutral-950'
                      : 'hover:bg-neutral-100 dark:hover:bg-neutral-800')
                  }
                  onClick={() => setADirection('short')}
                >
                  {t('fut.short')}
                </button>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>{t('fut.margin')}</label>
              <input
                className={inputCls}
                inputMode="decimal"
                value={aMargin}
                onChange={(e) => setAMargin(e.target.value)}
                placeholder="0"
              />
              {errMargin && (
                <div className="mt-1 text-xs text-red-600 dark:text-red-400">
                  {t('fut.errMargin')}
                </div>
              )}
            </div>
            <div>
              <label className={labelCls}>{t('fut.openDate')}</label>
              <DatePicker value={aDate} onChange={setADate} />
            </div>
          </div>
          <button className={btnPrimary} onClick={handleAdd} disabled={saving}>
            {saving ? t('common.saving') : t('fut.create')}
          </button>
        </div>
      </div>
      )}

      <ConfirmDialog
        open={toDelete !== null}
        title={t('fut.deletePos')}
        message={t('fut.deletePosMsg', { n: toDelete?.symbol ?? '' })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={handleDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  )
}
