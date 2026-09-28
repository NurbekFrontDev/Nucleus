-- =====================================================================
-- Nucleus -- Модуль «Дневник» (таблицы, RLS, realtime, бакет diary-audio)
-- Ежедневная фиксация мыслей голосом/текстом с AI-выжимкой и трекингом
-- экспериментов/челленджей. Вечный архив -- Second Brain (вольт),
-- Supabase -- рабочее хранилище и транспорт аудио.
-- Выполнить ОДИН раз в Supabase: SQL Editor -> New query -> вставить и Run.
-- Безопасно запускать повторно (IF NOT EXISTS / DROP POLICY IF EXISTS).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) РЕЕСТР ЭКСПЕРИМЕНТОВ/ЧЕЛЛЕНДЖЕЙ.
--    Новые эксперименты создаёт AI-детекция (is_new_experiment в выжимке),
--    пользователь может закрыть/править вручную. status: 'active' |
--    'completed' | 'abandoned'. Даты -- локальные даты клиента (закон вольта).
-- ---------------------------------------------------------------------
create table if not exists public.diary_experiments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  criteria text,
  target_days int,
  started_on date not null default current_date,
  status text not null default 'active' check (status in ('active','completed','abandoned')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2) ЗАПИСИ ДНЕВНИКА.
--    entry_date: локальная дата клиента (заметка дня формируется по местному
--                времени пользователя, никогда не UTC).
--    source:     'voice' (аудио -> транскрипт) | 'text' (введённый текст).
--    status:     pending -> transcribing -> summarizing -> ready | failed.
--    original_text: транскрибированный или введённый текст (дословно).
--    audio_path: путь в приватном бакете diary-audio ({user_id}/{date}/{id}.webm).
--    summary:    ParsedDiarySummary целиком (jsonb, пишет Edge Function).
--    experiment_id: эксперимент, обновлённый этой записью (AI-матч или новый).
--    vault_synced_at: отметка успешной записи в Second Brain (вольт).
-- ---------------------------------------------------------------------
create table if not exists public.diary_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_date date not null,
  source text not null check (source in ('voice','text')),
  status text not null default 'pending'
    check (status in ('pending','transcribing','summarizing','ready','failed')),
  original_text text,
  audio_path text,
  summary jsonb,
  experiment_id uuid references public.diary_experiments(id) on delete set null,
  timezone text,
  vault_synced_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists diary_entries_user_date_idx
  on public.diary_entries (user_id, entry_date desc);
create index if not exists diary_experiments_user_status_idx
  on public.diary_experiments (user_id, status);

-- ---------------------------------------------------------------------
-- 3) RLS: все операции строго по user_id (паттерн остальных таблиц Nucleus).
-- ---------------------------------------------------------------------
alter table public.diary_entries enable row level security;
alter table public.diary_experiments enable row level security;

drop policy if exists "own diary_entries" on public.diary_entries;
create policy "own diary_entries" on public.diary_entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own diary_experiments" on public.diary_experiments;
create policy "own diary_experiments" on public.diary_experiments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 4) Realtime: живое обновление карточек записи и блока экспериментов.
-- ---------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.diary_entries;
exception
  when duplicate_object then null; -- уже добавлена
end $$;

do $$
begin
  alter publication supabase_realtime add table public.diary_experiments;
exception
  when duplicate_object then null; -- уже добавлена
end $$;

-- ---------------------------------------------------------------------
-- 5) Приватный бакет diary-audio: ТОЛЬКО транспорт аудио (запись -> Edge
--    Function -> скачивание десктопом в вольт). Политики: только владелец.
--    Объект {user_id}/{YYYY-MM-DD}/{entry_id}.webm. Lifecycle-очистку после
--    30 дней (страховка поверх vault_synced_at) настроить в Dashboard:
--    Storage -> diary-audio -> Rules -> delete objects older than 30 days
--    (Supabase lifecycle). Вечное хранение аудио -- вольт + Google Drive.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('diary-audio', 'diary-audio', false, 20971520)
on conflict (id) do nothing;

drop policy if exists "own diary-audio read" on storage.objects;
create policy "own diary-audio read" on storage.objects
  for select using (
    bucket_id = 'diary-audio' and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "own diary-audio insert" on storage.objects;
create policy "own diary-audio insert" on storage.objects
  for insert with check (
    bucket_id = 'diary-audio' and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "own diary-audio delete" on storage.objects;
create policy "own diary-audio delete" on storage.objects
  for delete using (
    bucket_id = 'diary-audio' and auth.uid()::text = (storage.foldername(name))[1]
  );
