-- Валюта отображения в app_settings.
-- Хранит код валюты (USD, EUR, RUB и т.д.), символ которой подставляется
-- в formatSum по всему приложению. Все суммы по-прежнему хранятся в долларах.
alter table app_settings add column if not exists display_currency text not null default 'USD';
