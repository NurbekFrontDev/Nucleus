// Supabase Edge Function: get-crypto-prices
// Возвращает актуальные цены криптовалют в USD по списку символов.
// Вызывается с фронтенда: supabase.functions.invoke('get-crypto-prices', { body: { symbols } }).
//
// Стратегия (покрываем и крупные монеты, и мемкоины):
//   1) Coinbase spot — быстрый и точный для крупных монет (BTC, ETH, SOL...),
//      без ключа и лимитов, поиск по точному символу SYM-USD.
//   2) CoinGecko — для всего, что Coinbase не нашёл (мемкоины и альты):
//      сначала /search резолвит символ в coin id (берём с наибольшей капитализацией),
//      затем один вызов /simple/price отдаёт цены сразу по всем id.
//
// Ответ: { prices: Record<SYMBOL, number>, missing: string[] }.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

function reply(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Цена с Coinbase: GET /v2/prices/{SYM}-USD/spot -> { data: { amount: "65000.00" } }.
async function fromCoinbase(sym: string): Promise<number | null> {
  try {
    const res = await fetch(
      'https://api.coinbase.com/v2/prices/' + encodeURIComponent(sym) + '-USD/spot',
    )
    if (!res.ok) return null
    const json = await res.json()
    const n = Number(json?.data?.amount)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

// Резолвит символ монеты в CoinGecko coin id через /search.
// Среди точных совпадений по символу берём монету с наибольшей капитализацией
// (наименьший market_cap_rank) — это почти всегда «настоящая» монета, а не клон.
async function resolveCoinGeckoId(sym: string): Promise<string | null> {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/search?query=' + encodeURIComponent(sym),
      { headers: { Accept: 'application/json' } },
    )
    if (!res.ok) return null
    const json = await res.json()
    const coins = (json?.coins ?? []) as Array<{
      id: string
      symbol: string
      market_cap_rank: number | null
    }>
    if (coins.length === 0) return null
    const exact = coins.filter((c) => c.symbol?.toUpperCase() === sym)
    const pool = exact.length > 0 ? exact : coins
    pool.sort(
      (a, b) =>
        (a.market_cap_rank ?? Number.MAX_SAFE_INTEGER) -
        (b.market_cap_rank ?? Number.MAX_SAFE_INTEGER),
    )
    return pool[0]?.id ?? null
  } catch {
    return null
  }
}

// Цены сразу по нескольким coin id: GET /simple/price?ids=...&vs_currencies=usd.
async function fromCoinGecko(ids: string[]): Promise<Record<string, number>> {
  if (ids.length === 0) return {}
  try {
    const idsParam = ids.map(encodeURIComponent).join(',')
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=' +
        idsParam +
        '&vs_currencies=usd',
      { headers: { Accept: 'application/json' } },
    )
    if (!res.ok) return {}
    const json = await res.json()
    const out: Record<string, number> = {}
    for (const id of ids) {
      const n = Number(json?.[id]?.usd)
      if (Number.isFinite(n) && n > 0) out[id] = n
    }
    return out
  } catch {
    return {}
  }
}

// Цена SPL-токена Solana по адресу контракта (mint) через DexScreener.
// GET /latest/dex/tokens/{mint} -> { pairs: [{ priceUsd, liquidity: { usd } }] }.
// Берём пару с наибольшей ликвидностью -- она самая репрезентативная.
// Работает для любых токенов Solana, включая мемкоины с pump.fun.
async function fromDexScreener(mint: string): Promise<number | null> {
  try {
    const res = await fetch(
      'https://api.dexscreener.com/latest/dex/tokens/' + encodeURIComponent(mint),
      { headers: { Accept: 'application/json' } },
    )
    if (!res.ok) return null
    const json = await res.json()
    const pairs = (json?.pairs ?? []) as Array<{
      priceUsd?: string
      liquidity?: { usd?: number }
    }>
    let best: { price: number; liq: number } | null = null
    for (const p of pairs) {
      const price = Number(p?.priceUsd)
      const liq = Number(p?.liquidity?.usd ?? 0)
      if (Number.isFinite(price) && price > 0) {
        if (!best || liq > best.liq) best = { price, liq }
      }
    }
    return best?.price ?? null
  } catch {
    return null
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Принимаем символы и адреса контрактов из тела (POST) или из query.
  let symbols: string[] = []
  let contracts: string[] = []
  try {
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}))
      if (Array.isArray(body?.symbols)) symbols = body.symbols as string[]
      if (Array.isArray(body?.contracts)) contracts = body.contracts as string[]
    } else {
      const url = new URL(req.url)
      const rawSym = url.searchParams.get('symbols')
      if (rawSym) symbols = rawSym.split(',')
      const rawCon = url.searchParams.get('contracts')
      if (rawCon) contracts = rawCon.split(',')
    }
  } catch {
    symbols = []
    contracts = []
  }

  const norm = Array.from(
    new Set(
      symbols
        .map((s) => String(s ?? '').trim().toUpperCase())
        .filter((s) => s.length > 0 && s.length <= 20),
    ),
  ).slice(0, 50)

  // Адреса контрактов (Solana mint) -- как есть, регистр важен (base58).
  const contractList = Array.from(
    new Set(
      contracts
        .map((s) => String(s ?? '').trim())
        .filter((s) => s.length >= 20 && s.length <= 80),
    ),
  ).slice(0, 50)

  if (norm.length === 0 && contractList.length === 0) {
    return reply({ prices: {}, contracts: {}, missing: [] })
  }

  const prices: Record<string, number> = {}
  const contractPrices: Record<string, number> = {}

  // 1) Coinbase по каждому символу (параллельно).
  const cb = await Promise.all(
    norm.map(async (s) => [s, await fromCoinbase(s)] as const),
  )
  const missing: string[] = []
  for (const [s, p] of cb) {
    if (p != null) prices[s] = p
    else missing.push(s)
  }

  // 2) CoinGecko для тех, кого Coinbase не нашёл.
  if (missing.length > 0) {
    const resolved = await Promise.all(
      missing.map(async (s) => [s, await resolveCoinGeckoId(s)] as const),
    )
    const symById = new Map<string, string>()
    const ids: string[] = []
    for (const [s, id] of resolved) {
      if (id) {
        symById.set(id, s)
        ids.push(id)
      }
    }
    const cg = await fromCoinGecko(ids)
    for (const id of Object.keys(cg)) {
      const s = symById.get(id)
      if (s) prices[s] = cg[id]
    }
  }

  // Контракты: цена по адресу токена через DexScreener (параллельно).
  if (contractList.length > 0) {
    const dx = await Promise.all(
      contractList.map(async (c) => [c, await fromDexScreener(c)] as const),
    )
    for (const [c, p] of dx) {
      if (p != null) contractPrices[c] = p
    }
  }

  const stillMissing = [
    ...norm.filter((s) => !(s in prices)),
    ...contractList.filter((c) => !(c in contractPrices)),
  ]
  return reply({ prices, contracts: contractPrices, missing: stillMissing })
})
