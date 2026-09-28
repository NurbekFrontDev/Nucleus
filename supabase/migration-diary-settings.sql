-- =====================================================================
-- Nucleus v0.1.55 — настройки модуля «Дневник» + журнал событий (app_logs).
--
-- 1. app_settings: per-user настройки дневника. Хранятся в БД (а не в
--    localStorage), поэтому автоматически синхронизируются между ПК и
--    телефоном через Realtime (таблица уже в WATCHED_TABLES).
--    - diary_smart_transcription: SMART/VERBATIM режим Gemini 3.5 Transcribe
--      (умное форматирование vs дословная расшифровка).
--    - diary_summary_prompt: кастомный системный промпт выжимки (null = серверный
--      дефолт из Edge Function). Редактируется пользователем в Настройках.
--    - diary_gemini_key / diary_groq_key: свои API-ключи (null = секреты Supabase).
--      Edge Function читает их по JWT пользователя; RLS гарантирует, что
--      пользователь видит и меняет только свою строку.
--
-- 2. app_logs: единый журнал событий приложения для подвкладки «Логи» в
--    админ-панели. Пишется клиентом (ПК и телефон) при любых значимых действиях:
--    отправка записи, транскрибация, выжимка, вольт-синк, правки, удаления,
--    смена настроек, ошибки.
--
-- Применить: Supabase SQL Editor -> вставить -> Run.
-- =====================================================================

-- ===== 1. Настройки дневника =====

alter table public.app_settings
  add column if not exists diary_smart_transcription boolean not null default true,
  add column if not exists diary_summary_prompt text,
  add column if not exists diary_gemini_key text,
  add column if not exists diary_groq_key text;

-- Ключи не должны светиться в случайных выборках: RLS «own app_settings»
-- уже ограничивает всё таблицей пользователя (см. migration-backup-reminder.sql).

-- ===== 2. Журнал событий =====

create table if not exists public.app_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  level text not null default 'info' check (level in ('info', 'warn', 'error')),
  scope text not null default 'app',          -- diary | planner | settings | auth | vault
  message text not null,
  meta jsonb not null default '{}'::jsonb,
  platform text,                               -- windows | android | web
  created_at timestamptz not null default now()
);

alter table public.app_logs enable row level security;

drop policy if exists "own app_logs" on public.app_logs;
create policy "own app_logs" on public.app_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists app_logs_user_created_idx
  on public.app_logs (user_id, created_at desc);

-- ===== 3. Realtime: журнал и настройки стримятся на все устройства =====

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_logs'
  ) then
    alter publication supabase_realtime add table public.app_logs;
  end if;
end$$;
