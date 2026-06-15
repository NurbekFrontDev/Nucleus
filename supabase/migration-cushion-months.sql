-- Подушка безопасности: храним выбор покрытия (3/6/12 месяцев) в базе,
-- чтобы значение синхронизировалось между устройствами (телефон + компьютер).
alter table public.app_settings
  add column if not exists cushion_months integer not null default 6;
