-- Planner: длительность дела + снимок дня, который повторяется каждую неделю.
-- Запустить один раз в Supabase SQL Editor или через локальный migration script.
-- Все операции безопасны для повторного запуска.

-- Длительность в минутах. NULL = длительность не задана, тогда время конца вводится вручную.
alter table public.planner_items
  add column if not exists duration_min integer
  check (duration_min is null or (duration_min > 0 and duration_min <= 1440));

alter table if exists public.planner_day_overrides
  add column if not exists duration_min integer
  check (duration_min is null or (duration_min > 0 and duration_min <= 1440));

alter table if exists public.planner_weekday_overrides
  add column if not exists duration_min integer
  check (duration_min is null or (duration_min > 0 and duration_min <= 1440));

alter table if exists public.planner_day_template_items
  add column if not exists duration_min integer
  check (duration_min is null or (duration_min > 0 and duration_min <= 1440));

-- Снимок целого дня для конкретного дня недели.
-- Например: после настройки среды создаётся снимок, который действует
-- со среды effective_from и заменяет обычное расписание только по средам.
-- enabled=false — явный «сброс»: после этой даты снова работает обычный шаблон.
create table if not exists public.planner_weekly_day_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  effective_from date not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists planner_weekly_day_snapshots_lookup_idx
  on public.planner_weekly_day_snapshots (user_id, weekday, effective_from desc, created_at desc);

create table if not exists public.planner_weekly_day_snapshot_items (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.planner_weekly_day_snapshots(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references public.planner_items(id) on delete cascade,
  title text not null,
  note text,
  icon text,
  time_of_day text check (time_of_day in ('morning', 'day', 'evening', 'allday')),
  at_time_start text,
  at_time_end text,
  duration_min integer check (duration_min is null or (duration_min > 0 and duration_min <= 1440)),
  priority text not null default 'none' check (priority in ('none', 'low', 'medium', 'high')),
  important boolean not null default false,
  sort_order integer not null default 0
);

create index if not exists planner_weekly_day_snapshot_items_lookup_idx
  on public.planner_weekly_day_snapshot_items (snapshot_id, sort_order);

alter table public.planner_weekly_day_snapshots enable row level security;
alter table public.planner_weekly_day_snapshot_items enable row level security;

drop policy if exists "own planner_weekly_day_snapshots" on public.planner_weekly_day_snapshots;
create policy "own planner_weekly_day_snapshots" on public.planner_weekly_day_snapshots
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own planner_weekly_day_snapshot_items" on public.planner_weekly_day_snapshot_items;
create policy "own planner_weekly_day_snapshot_items" on public.planner_weekly_day_snapshot_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
