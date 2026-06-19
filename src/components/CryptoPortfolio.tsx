import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useLang } from '../lib/i18n'
import { formatDateHuman, loadCryptoAutoExpense, createCryptoExpense } from '../lib/db'
import DatePicker from './DatePicker'
import IconButton from './IconButton'
import ConfirmDialog from './ConfirmDialog'
import {
  loadPortfolio,
  createAsset,
  addTransaction,
  deleteTransaction,
  closeAsset,
  reopenAsset,
  deleteAsset,
  fmtUsd,
  fmtQty,
  fmtPct,
  parseNum,
  type AssetStats,
  type Portfolio,
  type TxType,
} from '../lib/crypto'

type Props = {
  portfolio: Portfolio
}

const todayISO = () => new Date().toISOString().slice(0, 10)

// Стили в духе приложения (emerald-акцент, тёмная тема по умолчанию).
const cardCls =
  'rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50'
const inputCls =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950'
const btnPrimary =
  'rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-50'
const btnGhost =
  'rounded-lg border border-neutral-300 px-3 py-2 text-sm transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
const labelCls = 'mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400'

function pnlColor(n: number | null | undefined): string {
  if (n == null) return 'text-neutral-500 dark:text-neutral-400'
  if (n > 0) return 'text-emerald-600 dark:text-emerald-400'
  if (n < 0) return 'text-red-500 dark:text-red-400'
  return 'text-neutral-500 dark:text-neutral-400'
}

export default function CryptoPortfolio({ portfolio }: Props) {
  const { t } = useLang()
  const { user } = useAuth()

  const [assets, setAssets] = useState<AssetStats[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Форма добавления актива.
  const [aSymbol, setASymbol] = useState('')
  const [aName, setAName] = useState('')
  const [aQty, setAQty] = useState('')
  const [aPrice, setAPrice] = useState('')
  const [aDate, setADate] = useState(todayISO())
  const [adding, setAdding] = useState(false)

  // Форма сделки (для раскрытого актива).
  const [tType, setTType] = useState<TxType>('buy')
  const [tQty, setTQty] = useState('')
  const [tPrice, setTPrice] = useState('')
  const [tDate, setTDate] = useState(todayISO())
  const [savingTrade, setSavingTrade] = useState(false)

  // Закрытие позиции.
  const [closingId, setClosingId] = useState<string | null>(null)
  const [cDate, setCDate] = useState(todayISO())
  const [cPrice, setCPrice] = useState('')

  // Подтверждения удаления.
  const [assetToDelete, setAssetToDelete] = useState<AssetStats | null>(null)
  const [txToDelete, setTxToDelete] = useState<string | null>(null)

  // Авто-расход при покупке крипты (настройка из app_settings, синк между устройствами).
  const [autoExpense, setAutoExpense] = useState(true)

  const reload = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const data = await loadPortfolio(user.id, portfolio)
      setAssets(data)
    } catch {
      setError(t('common.error'))
    } finally {
      setLoading(false)
    }
  }, [user, portfolio, t])

  useEffect(() => {
    let active = true
    if (!user) return
    setLoading(true)
    loadPortfolio(user.id, portfolio)
      .then((data) => {
        if (active) setAssets(data)
      })
      .catch(() => {
        if (active) setError(t('common.error'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [user, portfolio, t])

  useEffect(() => {
    if (!user) return
    let active = true
    loadCryptoAutoExpense(user.id)
      .then((v) => {
        if (active) setAutoExpense(v)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [user])

  function resetTradeForm() {
    setTType('buy')
    setTQty('')
    setTPrice('')
    setTDate(todayISO())
  }

  function toggleExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id))
    setClosingId(null)
    resetTradeForm()
  }

  async function handleAddAsset() {
    if (!user) return
    const symbol = aSymbol.trim()
    if (!symbol) {
      setError(t('inv.errSymbol'))
      return
    }
    const qty = parseNum(aQty)
    const price = parseNum(aPrice)
    if (qty <= 0 || price <= 0) {
      setError(t('inv.errQtyPrice'))
      return
    }
    setAdding(true)
    try {
      const date = aDate || todayISO()
      const asset = await createAsset(user.id, {
        symbol,
        name: aName,
        portfolio,
        opened_at: date,
      })
      const expenseId = autoExpense
        ? await createCryptoExpense(user.id, {
            amountUsd: qty * price,
            date,
            note: t('inv.buyNote').replace('{s}', symbol.toUpperCase()),
          })
        : null
      await addTransaction(user.id, {
        asset_id: asset.id,
        type: 'buy',
        quantity: qty,
        price_usd: price,
        date,
        expense_id: expenseId,
      })
      setASymbol('')
      setAName('')
      setAQty('')
      setAPrice('')
      setADate(todayISO())
      setError(null)
      await reload()
    } catch {
      setError(t('common.saveFailed'))
    } finally {
      setAdding(false)
    }
  }

  async function handleAddTrade(assetId: string) {
    if (!user) return
    const qty = parseNum(tQty)
    const price = parseNum(tPrice)
    if (qty <= 0 || price <= 0) {
      setError(t('inv.errQtyPrice'))
      return
    }
    setSavingTrade(true)
    try {
      const txDate = tDate || todayISO()
      const sym = assets.find((x) => x.id === assetId)?.symbol ?? ''
      const expenseId =
        autoExpense && tType === 'buy'
          ? await createCryptoExpense(user.id, {
              amountUsd: qty * price,
              date: txDate,
              note: t('inv.buyNote').replace('{s}', sym),
            })
          : null
      await addTransaction(user.id, {
        asset_id: assetId,
        type: tType,
        quantity: qty,
        price_usd: price,
        date: txDate,
        expense_id: expenseId,
      })
      resetTradeForm()
      setError(null)
      await reload()
    } catch {
      setError(t('common.saveFailed'))
    } finally {
      setSavingTrade(false)
    }
  }

  async function handleClose(assetId: string) {
    const price = parseNum(cPrice)
    if (price <= 0) {
      setError(t('inv.errQtyPrice'))
      return
    }
    try {
      await closeAsset(assetId, cDate || todayISO(), price)
      setClosingId(null)
      setCPrice('')
      setCDate(todayISO())
      setError(null)
      await reload()
    } catch {
      setError(t('common.saveFailed'))
    }
  }

  async function handleReopen(assetId: string) {
    try {
      await reopenAsset(assetId)
      await reload()
    } catch {
      setError(t('common.saveFailed'))
    }
  }

  async function confirmDeleteAsset() {
    if (!assetToDelete) return
    try {
      await deleteAsset(assetToDelete.id)
      if (expandedId === assetToDelete.id) setExpandedId(null)
      await reload()
    } catch {
      setError(t('common.saveFailed'))
    } finally {
      setAssetToDelete(null)
    }
  }

  async function confirmDeleteTrade() {
    if (!txToDelete) return
    try {
      await deleteTransaction(txToDelete)
      await reload()
    } catch {
      setError(t('common.saveFailed'))
    } finally {
      setTxToDelete(null)
    }
  }

  const totalInvested = assets.reduce((s, a) => s + (a.invested || 0), 0)
  const totalValue = assets.reduce(
    (s, a) => s + (a.marketValue ?? a.invested ?? 0),
    0,
  )

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold">
        {t(portfolio === 'meme' ? 'inv.memeTitle' : 'inv.spotTitle')}
      </h2>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Сводка по портфелю */}
      {assets.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div className={cardCls}>
            <div className="text-xs text-neutral-500 dark:text-neutral-400">
              {t('inv.totalInvested')}
            </div>
            <div className="mt-1 text-lg font-semibold">{fmtUsd(totalInvested)}</div>
          </div>
          <div className={cardCls}>
            <div className="text-xs text-neutral-500 dark:text-neutral-400">
              {t('inv.totalValue')}
            </div>
            <div className="mt-1 text-lg font-semibold">{fmtUsd(totalValue)}</div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
          {t('common.loading')}
        </div>
      ) : assets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900/50 dark:text-neutral-400">
          {t('inv.empty')}
        </div>
      ) : (
        <div className="space-y-2">
          {assets.map((a) => {
            const expanded = expandedId === a.id
            const isClosed = a.status === 'closed'
            return (
              <div key={a.id} className={cardCls}>
                {/* Заголовок актива */}
                <button
                  type="button"
                  onClick={() => toggleExpand(a.id)}
                  className="flex w-full items-center justify-between gap-3 text-left"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{a.symbol}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] ${
                          isClosed
                            ? 'bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
                            : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                        }`}
                      >
                        {isClosed ? t('inv.statusClosed') : t('inv.statusOpen')}
                      </span>
                    </div>
                    {a.name && (
                      <div className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                        {a.name}
                      </div>
                    )}
                    <div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                      {t('inv.held')}: {fmtQty(a.quantity)}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-semibold">{fmtUsd(a.marketValue)}</div>
                    <div className={`text-xs ${pnlColor(a.pnl)}`}>
                      {a.pnl == null
                        ? '–'
                        : `${fmtUsd(a.pnl)} (${fmtPct(a.pnlPct)})`}
                    </div>
                  </div>
                </button>

                {expanded && (
                  <div className="mt-4 space-y-4 border-t border-neutral-200 pt-4 dark:border-neutral-800">
                    {/* Показатели */}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                      <Stat label={t('inv.avgPrice')} value={fmtUsd(a.avgBuyPrice)} />
                      <Stat label={t('inv.invested')} value={fmtUsd(a.invested)} />
                      <Stat label={t('inv.value')} value={fmtUsd(a.marketValue)} />
                      <Stat
                        label={t('inv.pnl')}
                        value={a.pnl == null ? '–' : fmtUsd(a.pnl)}
                        className={pnlColor(a.pnl)}
                      />
                      <Stat
                        label={t('inv.apy')}
                        value={fmtPct(a.apy)}
                        className={pnlColor(a.apy)}
                      />
                    </div>

                    {!isClosed && a.priceUsd == null && (
                      <div className="text-xs text-neutral-400 dark:text-neutral-500">
                        {t('inv.priceHint')}
                      </div>
                    )}

                    {/* Добавить сделку (только для открытых) */}
                    {!isClosed && (
                      <div className="rounded-xl bg-neutral-50 p-3 dark:bg-neutral-950/40">
                        <div className="mb-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                          {t('inv.addBuy')}
                        </div>
                        <div className="mb-2 inline-flex rounded-lg border border-neutral-300 p-0.5 dark:border-neutral-700">
                          <button
                            type="button"
                            onClick={() => setTType('buy')}
                            className={`rounded-md px-3 py-1 text-sm transition ${
                              tType === 'buy'
                                ? 'bg-emerald-500 text-neutral-950'
                                : 'text-neutral-500 dark:text-neutral-400'
                            }`}
                          >
                            {t('inv.buy')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setTType('sell')}
                            className={`rounded-md px-3 py-1 text-sm transition ${
                              tType === 'sell'
                                ? 'bg-red-500 text-white'
                                : 'text-neutral-500 dark:text-neutral-400'
                            }`}
                          >
                            {t('inv.sell')}
                          </button>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-3">
                          <div>
                            <label className={labelCls}>{t('inv.qty')}</label>
                            <input
                              className={inputCls}
                              inputMode="decimal"
                              value={tQty}
                              onChange={(e) => setTQty(e.target.value)}
                            />
                          </div>
                          <div>
                            <label className={labelCls}>{t('inv.price')}</label>
                            <input
                              className={inputCls}
                              inputMode="decimal"
                              value={tPrice}
                              onChange={(e) => setTPrice(e.target.value)}
                            />
                          </div>
                          <div>
                            <label className={labelCls}>{t('inv.openDate')}</label>
                            <DatePicker value={tDate} onChange={setTDate} />
                          </div>
                        </div>
                        <div className="mt-2">
                          <button
                            type="button"
                            disabled={savingTrade}
                            onClick={() => handleAddTrade(a.id)}
                            className={btnPrimary}
                          >
                            {t('inv.addTrade')}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Список сделок */}
                    <div>
                      <div className="mb-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                        {t('inv.trades').replace('{n}', String(a.txs.length))}
                      </div>
                      {a.txs.length === 0 ? (
                        <div className="text-xs text-neutral-400 dark:text-neutral-500">
                          {t('inv.noTrades')}
                        </div>
                      ) : (
                        <ul className="space-y-1">
                          {a.txs.map((tx) => (
                            <li
                              key={tx.id}
                              className="flex items-center justify-between gap-2 rounded-lg bg-neutral-50 px-3 py-1.5 text-xs dark:bg-neutral-950/40"
                            >
                              <span className="min-w-0 truncate">
                                <span className="text-neutral-400">
                                  {formatDateHuman(tx.date)}
                                </span>{' '}
                                <span
                                  className={
                                    tx.type === 'buy'
                                      ? 'text-emerald-600 dark:text-emerald-400'
                                      : 'text-red-500 dark:text-red-400'
                                  }
                                >
                                  {tx.type === 'buy' ? t('inv.buy') : t('inv.sell')}
                                </span>{' '}
                                {fmtQty(tx.quantity)} @ {fmtUsd(tx.price_usd)} ={' '}
                                {fmtUsd(tx.amount_usd)}
                              </span>
                              <IconButton
                                icon="delete"
                                title={t('inv.deleteTrade')}
                                onClick={() => setTxToDelete(tx.id)}
                              />
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* Закрытие / повторное открытие + удаление */}
                    <div className="flex flex-wrap items-center gap-2">
                      {isClosed ? (
                        <button
                          type="button"
                          onClick={() => handleReopen(a.id)}
                          className={btnGhost}
                        >
                          {t('inv.reopen')}
                        </button>
                      ) : closingId === a.id ? (
                        <div className="w-full rounded-xl bg-neutral-50 p-3 dark:bg-neutral-950/40">
                          <div className="grid gap-2 sm:grid-cols-2">
                            <div>
                              <label className={labelCls}>{t('inv.closePrice')}</label>
                              <input
                                className={inputCls}
                                inputMode="decimal"
                                value={cPrice}
                                onChange={(e) => setCPrice(e.target.value)}
                              />
                            </div>
                            <div>
                              <label className={labelCls}>{t('inv.closeDate')}</label>
                              <DatePicker value={cDate} onChange={setCDate} />
                            </div>
                          </div>
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              onClick={() => handleClose(a.id)}
                              className={btnPrimary}
                            >
                              {t('inv.confirmClose')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setClosingId(null)}
                              className={btnGhost}
                            >
                              {t('common.cancel')}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setClosingId(a.id)
                            setCPrice('')
                            setCDate(todayISO())
                          }}
                          className={btnGhost}
                        >
                          {t('inv.close')}
                        </button>
                      )}
                      <div className="ml-auto">
                        <IconButton
                          icon="delete"
                          title={t('inv.deleteAsset')}
                          onClick={() => setAssetToDelete(a)}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Форма добавления актива */}
      <div className={cardCls}>
        <div className="mb-3 text-sm font-medium">{t('inv.addAsset')}</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <label className={labelCls}>{t('inv.symbol')}</label>
            <input
              className={inputCls}
              value={aSymbol}
              onChange={(e) => setASymbol(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>{t('inv.name')}</label>
            <input
              className={inputCls}
              value={aName}
              onChange={(e) => setAName(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>{t('inv.qty')}</label>
            <input
              className={inputCls}
              inputMode="decimal"
              value={aQty}
              onChange={(e) => setAQty(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>{t('inv.price')}</label>
            <input
              className={inputCls}
              inputMode="decimal"
              value={aPrice}
              onChange={(e) => setAPrice(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>{t('inv.openDate')}</label>
            <DatePicker value={aDate} onChange={setADate} />
          </div>
        </div>
        <div className="mt-3">
          <button
            type="button"
            disabled={adding}
            onClick={handleAddAsset}
            className={btnPrimary}
          >
            {t('inv.create')}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={assetToDelete != null}
        title={t('inv.deleteAsset')}
        message={t('inv.deleteAssetMsg').replace(
          '{n}',
          assetToDelete?.symbol ?? '',
        )}
        danger
        confirmLabel={t('common.delete')}
        onConfirm={confirmDeleteAsset}
        onCancel={() => setAssetToDelete(null)}
      />
      <ConfirmDialog
        open={txToDelete != null}
        title={t('inv.deleteTrade')}
        message={t('inv.deleteTradeMsg')}
        danger
        confirmLabel={t('common.delete')}
        onConfirm={confirmDeleteTrade}
        onCancel={() => setTxToDelete(null)}
      />
    </div>
  )
}

function Stat({
  label,
  value,
  className = '',
}: {
  label: string
  value: string
  className?: string
}) {
  return (
    <div>
      <div className="text-xs text-neutral-500 dark:text-neutral-400">{label}</div>
      <div className={`font-medium ${className}`}>{value}</div>
    </div>
  )
}
