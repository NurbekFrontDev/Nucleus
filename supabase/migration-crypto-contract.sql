-- Адрес контракта (mint) для крипто-активов.
-- Нужен, чтобы тянуть живую цену токенов Solana (включая мемкоины с pump.fun)
-- по адресу токена через DexScreener, когда тикера нет на Coinbase/CoinGecko.
alter table public.crypto_assets
  add column if not exists contract_address text;
