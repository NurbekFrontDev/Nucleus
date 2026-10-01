-- =====================================================================
-- Nucleus v0.1.62 — Google Drive как единственное хранилище аудио дневника.
--
-- app_settings: OAuth-ключи Google Drive per-user (как diary_gemini_key):
--   - diary_drive_client_id      OAuth Client ID (Google Cloud Console)
--   - diary_drive_client_secret  OAuth Client Secret
--   - diary_drive_refresh_token  Refresh Token (однократная авторизация)
-- Ключи синхронизируются между устройствами через Realtime: и ПК, и телефон
-- загружают аудио в один и тот же Drive. RLS «own app_settings» прячет их
-- от других аккаунтов. Supabase Storage (бакет diary-audio) больше не
-- используется: аудио уходит напрямую в Drive с устройства записи.
--
-- Применить: Supabase SQL Editor -> вставить -> Run (идемпотентный).
-- =====================================================================

alter table public.app_settings
  add column if not exists diary_drive_client_id text,
  add column if not exists diary_drive_client_secret text,
  add column if not exists diary_drive_refresh_token text;
