-- Благотворительность списком: несколько крупных целей вместо одной.
-- Раньше единственная цель хранилась полями в app_settings
-- (charity_goal_name / charity_goal_target). Теперь — отдельная таблица,
-- как у обычных целей: одна главная (is_primary) и сколько угодно второстепенных.

create table if not exists public.charity_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null default '',
  target numeric not null default 0,
  is_primary boolean not null default false,
  sort_order integer not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists charity_goals_user_idx on public.charity_goals (user_id, sort_order);

-- Не больше одной главной цели на пользователя.
create unique index if not exists charity_goals_one_primary
  on public.charity_goals (user_id)
  where is_primary;

alter table public.charity_goals enable row level security;

drop policy if exists "charity_goals owner" on public.charity_goals;
create policy "charity_goals owner" on public.charity_goals
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Привязка пополнения к конкретной цели.
-- NULL у старых записей = пополнение главной цели (обратная совместимость).
alter table public.expenses
  add column if not exists charity_goal_id uuid references public.charity_goals (id) on delete set null;

create index if not exists expenses_charity_goal_idx on public.expenses (charity_goal_id);

-- Перенос старой единственной цели из app_settings в новую таблицу.
-- Выполняется один раз: если у пользователя ещё нет ни одной цели.
insert into public.charity_goals (user_id, name, target, is_primary, sort_order)
select s.user_id,
       coalesce(s.charity_goal_name, ''),
       coalesce(s.charity_goal_target, 0),
       true,
       0
from public.app_settings s
where coalesce(s.charity_goal_target, 0) > 0
  and not exists (
    select 1 from public.charity_goals g where g.user_id = s.user_id
  );
