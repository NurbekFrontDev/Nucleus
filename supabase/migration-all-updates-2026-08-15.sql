-- ============================================================================
-- Nucleus: Полная миграция всех новых возможностей (15 августа 2026)
-- ============================================================================

-- 1. Валюта отображения в app_settings
alter table app_settings add column if not exists display_currency text not null default 'USD';

-- 2. Имя пользователя в app_settings (для регистрации и обращения в чате ИИ)
alter table app_settings add column if not exists user_name text;

-- 3. Скрытие дел из экрана «Сегодня» (без архивации)
alter table planner_items add column if not exists hidden_today boolean not null default false;

-- 4. Разовые задачи (One-off tasks с авто-очисткой через 7 дней)
create table if not exists planner_oneoff (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  note text,
  target_date date,
  done_at timestamptz,
  created_at timestamptz not null default now()
);
alter table planner_oneoff enable row level security;
drop policy if exists "Users can manage own oneoff tasks" on planner_oneoff;
create policy "Users can manage own oneoff tasks" on planner_oneoff
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 5. Отметки настроения дня: прокрастинация и выгорание (planner_day_mood)
create table if not exists planner_day_mood (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  mood text not null check (mood in ('procrastination', 'burnout')),
  note text,
  unique(user_id, date)
);
alter table planner_day_mood enable row level security;
drop policy if exists "Users own day_mood" on planner_day_mood;
create policy "Users own day_mood" on planner_day_mood
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
