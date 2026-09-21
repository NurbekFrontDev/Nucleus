-- =====================================================================
-- Миграция: Админ-панель (список установок Nucleus на устройствах).
-- Запустить ОДИН раз в Supabase SQL Editor.
--
-- Каждая установка приложения (ПК/телефон) при запуске пишет сюда
-- «сердцебиение»: платформа, модель устройства, версия ОС и приложения,
-- имя и email пользователя, время последней активности.
-- RLS: пользователь видит и меняет только свои строки; весь список
-- читает исключительно админ (email ниже проверяется по JWT).
-- =====================================================================

create table if not exists public.app_installs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  install_id text not null,
  email text,
  user_name text,
  platform text not null check (platform in ('windows', 'android', 'web')),
  device_name text,
  os_version text,
  app_version text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, install_id)
);

alter table public.app_installs enable row level security;

-- Каждый пользователь пишет только строки своих установок.
drop policy if exists "own app_installs" on public.app_installs;
create policy "own app_installs" on public.app_installs
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Читать весь список установок может только админ (email из JWT).
drop policy if exists "admin read app_installs" on public.app_installs;
create policy "admin read app_installs" on public.app_installs
  for select
  using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'dlaprogrammirovanieidlaameriki@gmail.com');

-- Realtime: живое обновление списка в админ-панели.
do $$
begin
  alter publication supabase_realtime add table public.app_installs;
exception
  when duplicate_object then null; -- уже добавлена
end $$;
