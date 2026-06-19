import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useLang } from '../lib/i18n'
import { monthName } from '../lib/db'
import IconButton from './IconButton'
import ConfirmDialog from './ConfirmDialog'
import {
  loadCryptoSnapshotLive,
  loadMonthly,
  upsertMonthly,
  deleteMonthly,
  fmtUsd,
  fmtPct,
  parseNum,
  type CryptoSnapshot,
  type MonthlyStats,
} from '../lib/crypto'

const cardCls =
  'rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50'
const inputCls =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950'
const btnPrimary =
  'rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-50'
const labelCls = 'mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400'

const now = new Date()

export default function CryptoOverview() {
  const { user } = useAuth()
  const { t } = useLang()

  const [snapshot, setSnapshot] = useState<CryptoSnapshot | null>(null)
  const [monthly, setMonthly] = useState<MonthlyStats[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Форма добавления месяца
  const [aYear, setAYear] = useState(String(now.getFullYear()))
  const [aMonth, setAMonth] = useState(now.getMonth()) // 0..11
  const [aDeposit, setADeposit] = useState('')
  const [aEnd, setAEnd] = useState('')
  const [aNote, setANote] = useState('')
  const [errValue, setErrValue] = useState(false)
  const [saving, setSaving] = useState(false)

  const [toDelete, setToDelete] = useState<MonthlyStats | null>(null)

  const reload = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setError(null)
    try {
      const [snap, months] = await Promise.all([
        loadCryptoSnapshotLive(user.id),
        loadMonthly(user.id),
      ])
      setSnapshot(snap)
      setMonthly(months)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void reload()
  }, [reload])

  async function handleSave() {
    if (!user) return
    const deposit = parseNum(aDeposit)
    const end = parseNum(aEnd)
    const year = Number(aYear)
    if (end <= 0 || deposit < 0 || !year) {
      setErrValue(true)
      return
    }
    setErrValue(false)
    setSaving(true)
    setError(null)
    try {
      await upsertMonthly(user.id, {
        year,
        month: aMonth + 1,
        deposit_usd: deposit,
        end_value_usd: end,
        note: aNote || null,
      })
      setADeposit('')
      setAEnd('')
      setANote('')
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!toDelete) return
    setError(null)
    try {
      await deleteMonthly(toDelete.id)
      setToDelete(null)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const pnlColor = (n: number | null | undefined) =>
    n == null
      ? 'text-neutral-500 dark:text-neutral-400'
      : n > 0
        ? 'text-emerald-600 dark:text-emerald-400'
        : n < 0
          ? 'text-red-600 dark:text-red-400'
          : 'text-neutral-500 dark:text-neutral-400'

  const monthLabel = (m: MonthlyStats) => monthName(m.month - 1) + ' ' + m.year

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

      {/* Снимок */}
      {snapshot && (
        <div className={cardCls}>
          <div className="mb-3 text-sm font-medium">{t('ov.snapshot')}</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <div className={labelCls}>{t('ov.spotInvested')}</div>
              <div className="text-base font-semibold">
                {fmtUsd(snapshot.spotInvested)}
              </div>
            </div>
            <div>
              <div className={labelCls}>{t('ov.spotValue')}</div>
              <div className="text-base font-semibold">
                {fmtUsd(snapshot.spotValue)}
              </div>
            </div>
            <div>
              <div className={labelCls}>{t('ov.spotPnl')}</div>
              <div className={'text-base font-semibold ' + pnlColor(snapshot.spotPnl)}>
                {fmtUsd(snapshot.spotPnl)}
              </div>
            </div>
            <div>
              <div className={labelCls}>{t('ov.futuresMargin')}</div>
              <div className="text-base font-semibold">
                {fmtUsd(snapshot.futuresMargin)}
              </div>
            </div>
            <div>
              <div className={labelCls}>{t('ov.futuresPnl')}</div>
              <div
                className={'text-base font-semibold ' + pnlColor(snapshot.futuresClosedPnl)}
              >
                {fmtUsd(snapshot.futuresClosedPnl)}
              </div>
            </div>
            <div>
              <div className={labelCls}>{t('ov.openPositions')}</div>
              <div className="text-base font-semibold">
                {t('ov.openSpot', { n: snapshot.openSpotCount })}
                {' · '}
                {t('ov.openFutures', { n: snapshot.openFuturesCount })}
              </div>
            </div>
          </div>
          <div className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
            {t('ov.liveNote')}
          </div>
        </div>
      )}

      {/* Помесячная сводка */}
      <div className={cardCls}>
        <div className="mb-3 text-sm font-medium">{t('ov.monthly')}</div>
        {monthly.length === 0 ? (
          <div className="rounded-xl border border-dashed border-neutral-300 p-4 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
            {t('ov.empty')}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-12 gap-2 px-1 text-xs text-neutral-500 dark:text-neutral-400">
              <div className="col-span-4">{t('ov.month')}</div>
              <div className="col-span-3 text-right">{t('ov.depositCol')}</div>
              <div className="col-span-2 text-right">{t('ov.endCol')}</div>
              <div className="col-span-3 text-right">{t('ov.pnlCol')}</div>
            </div>
            {monthly.map((m) => (
              <div
                key={m.id}
                className="grid grid-cols-12 items-center gap-2 rounded-xl border border-neutral-200 px-2 py-2 text-sm dark:border-neutral-800"
              >
                <div className="col-span-4 flex items-center gap-1">
                  <IconButton
                    icon="delete"
                    onClick={() => setToDelete(m)}
                    title={t('common.delete')}
                  />
                  <span className="truncate">{monthLabel(m)}</span>
                </div>
                <div className="col-span-3 text-right">{fmtUsd(m.deposit_usd)}</div>
                <div className="col-span-2 text-right">{fmtUsd(m.end_value_usd)}</div>
                <div className={'col-span-3 text-right font-medium ' + pnlColor(m.pnl)}>
                  {fmtUsd(m.pnl)}
                  <span className="block text-xs">{fmtPct(m.pnlPct)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Форма добавления / обновления месяца */}
        <div className="mt-4 border-t border-neutral-200 pt-4 dark:border-neutral-800">
          <div className="mb-3 text-sm font-medium">{t('ov.addMonth')}</div>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>{t('ov.month')}</label>
                <select
                  className={inputCls}
                  value={aMonth}
                  onChange={(e) => setAMonth(Number(e.target.value))}
                >
                  {Array.from({ length: 12 }, (_, i) => (
                    <option key={i} value={i}>
                      {monthName(i)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>{t('ov.year')}</label>
                <input
                  className={inputCls}
                  inputMode="numeric"
                  value={aYear}
                  onChange={(e) => setAYear(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>{t('ov.deposit')}</label>
                <input
                  className={inputCls}
                  inputMode="decimal"
                  value={aDeposit}
                  onChange={(e) => setADeposit(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div>
                <label className={labelCls}>{t('ov.endValue')}</label>
                <input
                  className={inputCls}
                  inputMode="decimal"
                  value={aEnd}
                  onChange={(e) => setAEnd(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
            <div>
              <label className={labelCls}>{t('ov.note')}</label>
              <input
                className={inputCls}
                value={aNote}
                onChange={(e) => setANote(e.target.value)}
              />
            </div>
            {errValue && (
              <div className="text-xs text-red-600 dark:text-red-400">
                {t('ov.errValue')}
              </div>
            )}
            <button className={btnPrimary} onClick={handleSave} disabled={saving}>
              {saving ? t('common.saving') : t('ov.saveMonth')}
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={toDelete !== null}
        title={t('ov.deleteMonth')}
        message={t('ov.deleteMonthMsg', { m: toDelete ? monthLabel(toDelete) : '' })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={handleDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  )
}
