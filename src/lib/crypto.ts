import { supabase } from './supabase'

// ===== Типы =====
export type Portfolio = 'main' | 'meme'
export type AssetStatus = 'open' | 'closed'
export type TxType = 'buy' | 'sell'

export type CryptoAsset = {
  id: string
  user_id: string
  symbol: string
  name: string | null
  portfolio: Portfolio
  status: AssetStatus
  opened_at: string
  closed_at: string | null
  close_price_usd: number | null
  note: string | null
  sort_order: number
  created_at: string
}

export type CryptoTransaction = {
  id: string
  user_id: string
  asset_id: string
  type: TxType
  quantity: number
  price_usd: number
  amount_usd: number
  date: string
  expense_id: string | null
  note: string | null
  created_at: string
}

// Актив с посчитанными показателями (количество, средняя цена, вложения, P/L, APY).
export type AssetStats = CryptoAsset & {
  txs: CryptoTransaction[]
  quantity: number
  boughtQty: number
  soldQty: number
  buyCost: number
  sellProceeds: number
  avgBuyPrice: number
  invested: number
  priceUsd: number | null
  marketValue: number | null
  pnl: number | null
  pnlPct: number | null
  apy: number | null
}

const DAY_MS = 24 * 60 * 60 * 1000
const round2 = (n: number) => Math.round(n * 100) / 100

// ===== Форматирование =====
export function fmtUsd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '–'
  const sign = n < 0 ? '-' : ''
  return (
    sign +
    '$' +
    Math.abs(n).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  )
}

export function fmtQty(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '–'
  return n.toLocaleString('en-US', { maximumFractionDigits: 8 })
}

export function fmtPct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '–'
  const sign = n > 0 ? '+' : ''
  return sign + n.toFixed(2) + '%'
}

// Парсинг ввода: убираем пробелы, заменяем запятую на точку, оставляем число.
export function parseNum(input: string): number {
  if (!input) return 0
  const cleaned = input.replace(/\s/g, '').replace(',', '.').replace(/[^\d.]/g, '')
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

// ===== Подсчёт показателей по сделкам =====
// livePrice (если есть) используется для открытых позиций; для закрытых берём close_price_usd.
export function computeStats(
  asset: CryptoAsset,
  txs: CryptoTransaction[],
  livePrice?: number | null,
): AssetStats {
  let boughtQty = 0
  let soldQty = 0
  let buyCost = 0
  let sellProceeds = 0
  for (const tx of txs) {
    if (tx.type === 'buy') {
      boughtQty += Number(tx.quantity)
      buyCost += Number(tx.amount_usd)
    } else {
      soldQty += Number(tx.quantity)
      sellProceeds += Number(tx.amount_usd)
    }
  }
  const quantity = Math.max(0, boughtQty - soldQty)
  const avgBuyPrice = boughtQty > 0 ? buyCost / boughtQty : 0
  const invested = round2(avgBuyPrice * quantity)

  const priceUsd =
    asset.status === 'closed' ? asset.close_price_usd : livePrice ?? null

  let marketValue: number | null = null
  let pnl: number | null = null
  let pnlPct: number | null = null
  let apy: number | null = null

  if (priceUsd != null) {
    marketValue = round2(quantity * priceUsd)
    // Прибыль = (текущая стоимость остатка + выручка от продаж) - все покупки.
    pnl = round2(marketValue + sellProceeds - buyCost)
    pnlPct = buyCost > 0 ? (pnl / buyCost) * 100 : null
    const endMs = asset.closed_at
      ? new Date(asset.closed_at + 'T00:00:00').getTime()
      : Date.now()
    const startMs = new Date(asset.opened_at + 'T00:00:00').getTime()
    const days = Math.max(1, (endMs - startMs) / DAY_MS)
    if (buyCost > 0) {
      const ratio = (marketValue + sellProceeds) / buyCost
      if (ratio > 0) apy = (Math.pow(ratio, 365 / days) - 1) * 100
    }
  }

  return {
    ...asset,
    txs,
    quantity,
    boughtQty,
    soldQty,
    buyCost: round2(buyCost),
    sellProceeds: round2(sellProceeds),
    avgBuyPrice,
    invested,
    priceUsd,
    marketValue,
    pnl,
    pnlPct,
    apy,
  }
}

// ===== Запросы =====
export async function loadPortfolio(
  userId: string,
  portfolio: Portfolio,
  prices?: Record<string, number>,
): Promise<AssetStats[]> {
  const { data: assets, error } = await supabase
    .from('crypto_assets')
    .select('*')
    .eq('user_id', userId)
    .eq('portfolio', portfolio)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  const list = (assets ?? []) as CryptoAsset[]
  if (list.length === 0) return []

  const ids = list.map((a) => a.id)
  const { data: txData, error: txErr } = await supabase
    .from('crypto_transactions')
    .select('*')
    .in('asset_id', ids)
    .order('date', { ascending: true })
  if (txErr) throw txErr
  const txs = (txData ?? []) as CryptoTransaction[]

  const byAsset = new Map<string, CryptoTransaction[]>()
  for (const tx of txs) {
    const arr = byAsset.get(tx.asset_id) ?? []
    arr.push(tx)
    byAsset.set(tx.asset_id, arr)
  }

  return list.map((a) =>
    computeStats(a, byAsset.get(a.id) ?? [], prices?.[a.symbol.toUpperCase()]),
  )
}

export async function createAsset(
  userId: string,
  input: {
    symbol: string
    name?: string | null
    portfolio: Portfolio
    opened_at: string
    note?: string | null
  },
): Promise<CryptoAsset> {
  const { data: last } = await supabase
    .from('crypto_assets')
    .select('sort_order')
    .eq('user_id', userId)
    .eq('portfolio', input.portfolio)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextOrder = (last?.sort_order ?? 0) + 1

  const { data, error } = await supabase
    .from('crypto_assets')
    .insert({
      user_id: userId,
      symbol: input.symbol.trim().toUpperCase(),
      name: input.name?.trim() || null,
      portfolio: input.portfolio,
      status: 'open',
      opened_at: input.opened_at,
      note: input.note?.trim() || null,
      sort_order: nextOrder,
    })
    .select('*')
    .single()
  if (error || !data) throw error ?? new Error('Insert failed')
  return data as CryptoAsset
}

export async function addTransaction(
  userId: string,
  input: {
    asset_id: string
    type: TxType
    quantity: number
    price_usd: number
    date: string
    expense_id?: string | null
    note?: string | null
  },
): Promise<CryptoTransaction> {
  const amount_usd = round2(input.quantity * input.price_usd)
  const { data, error } = await supabase
    .from('crypto_transactions')
    .insert({
      user_id: userId,
      asset_id: input.asset_id,
      type: input.type,
      quantity: input.quantity,
      price_usd: input.price_usd,
      amount_usd,
      date: input.date,
      expense_id: input.expense_id ?? null,
      note: input.note?.trim() || null,
    })
    .select('*')
    .single()
  if (error || !data) throw error ?? new Error('Insert failed')
  return data as CryptoTransaction
}

export async function deleteTransaction(id: string): Promise<void> {
  const { error } = await supabase.from('crypto_transactions').delete().eq('id', id)
  if (error) throw error
}

export async function closeAsset(
  id: string,
  closed_at: string,
  close_price_usd: number,
): Promise<void> {
  const { error } = await supabase
    .from('crypto_assets')
    .update({ status: 'closed', closed_at, close_price_usd })
    .eq('id', id)
  if (error) throw error
}

export async function reopenAsset(id: string): Promise<void> {
  const { error } = await supabase
    .from('crypto_assets')
    .update({ status: 'open', closed_at: null, close_price_usd: null })
    .eq('id', id)
  if (error) throw error
}

export async function updateAsset(
  id: string,
  patch: Partial<Pick<CryptoAsset, 'symbol' | 'name' | 'note' | 'opened_at'>>,
): Promise<void> {
  const { error } = await supabase.from('crypto_assets').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteAsset(id: string): Promise<void> {
  const { error } = await supabase.from('crypto_assets').delete().eq('id', id)
  if (error) throw error
}

export async function saveAssetsOrder(ids: string[]): Promise<void> {
  await Promise.all(
    ids.map((id, i) =>
      supabase.from('crypto_assets').update({ sort_order: i + 1 }).eq('id', id),
    ),
  )
}
