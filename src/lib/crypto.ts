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
  contract_address: string | null
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

// Парсинг ввода количества/цены. Понимает оба формата:
//  - разделитель тысяч запятыми + точка-десятичная (как в Phantom): 15,272.87724
//  - запятая как десятичный разделитель (европейский ввод): 0,005
// Возвращает корректное число; при мусоре -- 0.
export function parseNum(input: string): number {
  if (!input) return 0
  let s = input.replace(/\s/g, '')
  if (s.includes(',') && s.includes('.')) {
    // Есть и запятая, и точка -> запятая это разделитель тысяч, убираем её.
    s = s.replace(/,/g, '')
  } else if (s.includes(',')) {
    // Только запятая -> считаем её десятичным разделителем.
    s = s.replace(/,/g, '.')
  }
  s = s.replace(/[^\d.]/g, '')
  // Если случайно осталось несколько точек -- оставляем первую как десятичную.
  const firstDot = s.indexOf('.')
  if (firstDot !== -1) {
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, '')
  }
  const n = Number(s)
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

  return list.map((a) => {
    // Цену ищем сначала по адресу контракта (мемкоины Solana), затем по тикеру.
    const live =
      (a.contract_address ? prices?.[a.contract_address.trim()] : undefined) ??
      prices?.[a.symbol.toUpperCase()]
    return computeStats(a, byAsset.get(a.id) ?? [], live)
  })
}

export async function createAsset(
  userId: string,
  input: {
    symbol: string
    name?: string | null
    contract_address?: string | null
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
      contract_address: input.contract_address?.trim() || null,
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
  // Если к сделке привязан авто-расход — удаляем и его, чтобы не оставлять «висячий» расход.
  const { data: tx } = await supabase
    .from('crypto_transactions')
    .select('expense_id')
    .eq('id', id)
    .maybeSingle()
  const { error } = await supabase.from('crypto_transactions').delete().eq('id', id)
  if (error) throw error
  const expenseId = (tx as { expense_id?: string | null } | null)?.expense_id
  if (expenseId) await supabase.from('expenses').delete().eq('id', expenseId)
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
  patch: Partial<
    Pick<CryptoAsset, 'symbol' | 'name' | 'contract_address' | 'note' | 'opened_at'>
  >,
): Promise<void> {
  const { error } = await supabase.from('crypto_assets').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteAsset(id: string): Promise<void> {
  // Сначала удаляем связанные авто-расходы по сделкам актива (сами сделки уйдут каскадом).
  const { data: txs } = await supabase
    .from('crypto_transactions')
    .select('expense_id')
    .eq('asset_id', id)
  const expenseIds = ((txs ?? []) as { expense_id: string | null }[])
    .map((t) => t.expense_id)
    .filter((e): e is string => !!e)
  if (expenseIds.length > 0) {
    await supabase.from('expenses').delete().in('id', expenseIds)
  }
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

// ===== Фьючерсы =====
export type FutureDirection = 'long' | 'short'
export type FutureStatus = 'open' | 'closed'

export type CryptoFuture = {
  id: string
  user_id: string
  symbol: string
  direction: FutureDirection
  opened_at: string
  margin_usd: number
  closed_at: string | null
  exit_usd: number | null
  status: FutureStatus
  note: string | null
  sort_order: number
  created_at: string
}

// Фьючерс с посчитанным итогом: pnl = exit_usd - margin_usd, % = pnl / margin * 100.
export type FutureStats = CryptoFuture & {
  pnl: number | null
  pnlPct: number | null
}

export function computeFutureStats(f: CryptoFuture): FutureStats {
  let pnl: number | null = null
  let pnlPct: number | null = null
  if (f.status === 'closed' && f.exit_usd != null) {
    pnl = round2(Number(f.exit_usd) - Number(f.margin_usd))
    pnlPct = Number(f.margin_usd) > 0 ? (pnl / Number(f.margin_usd)) * 100 : null
  }
  return { ...f, pnl, pnlPct }
}

export async function loadFutures(userId: string): Promise<FutureStats[]> {
  const { data, error } = await supabase
    .from('crypto_futures')
    .select('*')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return ((data ?? []) as CryptoFuture[]).map(computeFutureStats)
}

export async function createFuture(
  userId: string,
  input: {
    symbol: string
    direction: FutureDirection
    opened_at: string
    margin_usd: number
    note?: string | null
  },
): Promise<CryptoFuture> {
  const { data: last } = await supabase
    .from('crypto_futures')
    .select('sort_order')
    .eq('user_id', userId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextOrder = (last?.sort_order ?? 0) + 1
  const { data, error } = await supabase
    .from('crypto_futures')
    .insert({
      user_id: userId,
      symbol: input.symbol.trim().toUpperCase(),
      direction: input.direction,
      opened_at: input.opened_at,
      margin_usd: input.margin_usd,
      status: 'open',
      note: input.note?.trim() || null,
      sort_order: nextOrder,
    })
    .select('*')
    .single()
  if (error || !data) throw error ?? new Error('Insert failed')
  return data as CryptoFuture
}

export async function closeFuture(
  id: string,
  closed_at: string,
  exit_usd: number,
): Promise<void> {
  const { error } = await supabase
    .from('crypto_futures')
    .update({ status: 'closed', closed_at, exit_usd })
    .eq('id', id)
  if (error) throw error
}

export async function reopenFuture(id: string): Promise<void> {
  const { error } = await supabase
    .from('crypto_futures')
    .update({ status: 'open', closed_at: null, exit_usd: null })
    .eq('id', id)
  if (error) throw error
}

export async function updateFuture(
  id: string,
  patch: Partial<
    Pick<CryptoFuture, 'symbol' | 'direction' | 'margin_usd' | 'note' | 'opened_at'>
  >,
): Promise<void> {
  const { error } = await supabase.from('crypto_futures').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteFuture(id: string): Promise<void> {
  const { error } = await supabase.from('crypto_futures').delete().eq('id', id)
  if (error) throw error
}

export async function saveFuturesOrder(ids: string[]): Promise<void> {
  await Promise.all(
    ids.map((id, i) =>
      supabase.from('crypto_futures').update({ sort_order: i + 1 }).eq('id', id),
    ),
  )
}

// ===== Месячная сводка =====
export type CryptoMonthly = {
  id: string
  user_id: string
  year: number
  month: number
  deposit_usd: number
  end_value_usd: number
  note: string | null
  created_at: string
}

// Месяц с посчитанным итогом: pnl = end_value - deposit, % = pnl / deposit * 100.
export type MonthlyStats = CryptoMonthly & {
  pnl: number
  pnlPct: number | null
}

export function computeMonthlyStats(m: CryptoMonthly): MonthlyStats {
  const pnl = round2(Number(m.end_value_usd) - Number(m.deposit_usd))
  const pnlPct =
    Number(m.deposit_usd) > 0 ? (pnl / Number(m.deposit_usd)) * 100 : null
  return { ...m, pnl, pnlPct }
}

export async function loadMonthly(userId: string): Promise<MonthlyStats[]> {
  const { data, error } = await supabase
    .from('crypto_monthly')
    .select('*')
    .eq('user_id', userId)
    .order('year', { ascending: false })
    .order('month', { ascending: false })
  if (error) throw error
  return ((data ?? []) as CryptoMonthly[]).map(computeMonthlyStats)
}

export async function upsertMonthly(
  userId: string,
  input: {
    year: number
    month: number
    deposit_usd: number
    end_value_usd: number
    note?: string | null
  },
): Promise<CryptoMonthly> {
  const { data, error } = await supabase
    .from('crypto_monthly')
    .upsert(
      {
        user_id: userId,
        year: input.year,
        month: input.month,
        deposit_usd: input.deposit_usd,
        end_value_usd: input.end_value_usd,
        note: input.note?.trim() || null,
      },
      { onConflict: 'user_id,year,month' },
    )
    .select('*')
    .single()
  if (error || !data) throw error ?? new Error('Upsert failed')
  return data as CryptoMonthly
}

export async function deleteMonthly(id: string): Promise<void> {
  const { error } = await supabase.from('crypto_monthly').delete().eq('id', id)
  if (error) throw error
}

// ===== Агрегатный снимок (для вкладки «Обзор») =====
export type CryptoSnapshot = {
  spotInvested: number
  spotValue: number | null
  spotPnl: number | null
  futuresMargin: number
  futuresClosedPnl: number
  openSpotCount: number
  openFuturesCount: number
}

// Сводный снимок по обоим спот-портфелям и фьючерсам.
// Стоимость и P/L по открытым позициям считаются только при наличии живой цены (появится позже).
export async function loadCryptoSnapshot(
  userId: string,
  prices?: Record<string, number>,
): Promise<CryptoSnapshot> {
  const [main, meme, futures] = await Promise.all([
    loadPortfolio(userId, 'main', prices),
    loadPortfolio(userId, 'meme', prices),
    loadFutures(userId),
  ])
  const assets = [...main, ...meme]
  let spotInvested = 0
  let spotValue = 0
  let spotPnl = 0
  let hasValue = false
  let openSpotCount = 0
  for (const a of assets) {
    spotInvested += a.invested
    if (a.marketValue != null) {
      spotValue += a.marketValue
      hasValue = true
    }
    if (a.pnl != null) spotPnl += a.pnl
    if (a.status === 'open') openSpotCount++
  }
  let futuresMargin = 0
  let futuresClosedPnl = 0
  let openFuturesCount = 0
  for (const f of futures) {
    futuresMargin += Number(f.margin_usd)
    if (f.pnl != null) futuresClosedPnl += f.pnl
    if (f.status === 'open') openFuturesCount++
  }
  return {
    spotInvested: round2(spotInvested),
    spotValue: hasValue ? round2(spotValue) : null,
    spotPnl: hasValue ? round2(spotPnl) : null,
    futuresMargin: round2(futuresMargin),
    futuresClosedPnl: round2(futuresClosedPnl),
    openSpotCount,
    openFuturesCount,
  }
}

// ===== Живые цены (этап 7) =====
// Берём актуальные цены монет в USD через серверную функцию Supabase
// «get-crypto-prices» (источники: Coinbase + CoinGecko). Браузеру эти источники
// напрямую дёргать неудобно (CORS и лимиты), поэтому ходим через Edge Function --
// тот же подход, что и с курсами валют (get-rate).
// Возвращаем карту СИМВОЛ(в верхнем регистре) -> цена в USD. При любой ошибке --
// пустая карта (тогда стоимость и прибыль по открытым позициям просто не считаются).
export async function loadCryptoPrices(
  input: { symbols?: string[]; contracts?: string[] },
): Promise<Record<string, number>> {
  const symbols = Array.from(
    new Set((input.symbols ?? []).map((s) => s.trim().toUpperCase()).filter(Boolean)),
  )
  const contracts = Array.from(
    new Set((input.contracts ?? []).map((s) => s.trim()).filter(Boolean)),
  )
  if (symbols.length === 0 && contracts.length === 0) return {}
  try {
    const { data, error } = await supabase.functions.invoke('get-crypto-prices', {
      body: { symbols, contracts },
    })
    if (error) return {}
    const res = data as {
      prices?: Record<string, number>
      contracts?: Record<string, number>
    } | null
    const out: Record<string, number> = {}
    // Цены по тикеру: ключ -- символ в верхнем регистре.
    const bySymbol = res?.prices ?? {}
    for (const key of Object.keys(bySymbol)) {
      const n = Number(bySymbol[key])
      if (n > 0) out[key.toUpperCase()] = n
    }
    // Цены по адресу контракта: ключ -- адрес токена как есть (регистр важен).
    const byContract = res?.contracts ?? {}
    for (const key of Object.keys(byContract)) {
      const n = Number(byContract[key])
      if (n > 0) out[key] = n
    }
    return out
  } catch {
    return {}
  }
}

// Тикеры и адреса контрактов открытых спот-активов (нужны, чтобы запросить живые цены).
export async function loadOpenCryptoPriceKeys(
  userId: string,
): Promise<{ symbols: string[]; contracts: string[] }> {
  const { data, error } = await supabase
    .from('crypto_assets')
    .select('symbol, contract_address')
    .eq('user_id', userId)
    .eq('status', 'open')
  if (error) return { symbols: [], contracts: [] }
  const rows = (data ?? []) as { symbol: string; contract_address: string | null }[]
  const symbols = Array.from(
    new Set(rows.map((a) => a.symbol?.toUpperCase()).filter((s): s is string => !!s)),
  )
  const contracts = Array.from(
    new Set(
      rows.map((a) => a.contract_address?.trim()).filter((s): s is string => !!s),
    ),
  )
  return { symbols, contracts }
}

// Снимок портфеля с живыми ценами: подтягивает цены открытых монет и считает
// стоимость и прибыль. Если цены недоступны -- ведёт себя как loadCryptoSnapshot без цен.
export async function loadCryptoSnapshotLive(userId: string): Promise<CryptoSnapshot> {
  const { symbols, contracts } = await loadOpenCryptoPriceKeys(userId)
  const prices = await loadCryptoPrices({ symbols, contracts })
  return loadCryptoSnapshot(userId, prices)
}
