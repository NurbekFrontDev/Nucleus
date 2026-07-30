-- Planner: per-weekday overrides for a task/habit.
-- Problem this solves: an item usually has the same start/end time every day,
-- but on one weekday (for example Sunday) it should start at another time,
-- or belong to another day section (morning / day / evening / all day).
-- A single-date override (planner_day_overrides) is not enough, because the
-- user wants it applied automatically EVERY Sunday.
--
-- Priority when building a day (see loadDay in src/lib/planner.ts):
--   planner_items (template)
--     -> planner_weekday_overrides (this weekday, every week)
--       -> planner_day_overrides (this exact date only, wins over everything)

create table if not exists public.planner_weekday_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid not null references public.planner_items (id) on delete cascade,
  -- ISO weekday: 1 = Monday .. 7 = Sunday
  weekday smallint not null check (weekday between 1 and 7),
  time_of_day text,
  at_time_start text,
  at_time_end text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, item_id, weekday)
);

create index if not exists planner_weekday_overrides_user_item_idx
  on public.planner_weekday_overrides (user_id, item_id);

alter table public.planner_weekday_overrides enable row level security;

drop policy if exists "planner_weekday_overrides_select_own" on public.planner_weekday_overrides;
create policy "planner_weekday_overrides_select_own"
  on public.planner_weekday_overrides for select
  using (auth.uid() = user_id);

drop policy if exists "planner_weekday_overrides_insert_own" on public.planner_weekday_overrides;
create policy "planner_weekday_overrides_insert_own"
  on public.planner_weekday_overrides for insert
  with check (auth.uid() = user_id);

drop policy if exists "planner_weekday_overrides_update_own" on public.planner_weekday_overrides;
create policy "planner_weekday_overrides_update_own"
  on public.planner_weekday_overrides for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "planner_weekday_overrides_delete_own" on public.planner_weekday_overrides;
create policy "planner_weekday_overrides_delete_own"
  on public.planner_weekday_overrides for delete
  using (auth.uid() = user_id);
