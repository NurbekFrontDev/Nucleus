-- Отметки прокрастинации/выгорания на конкретные дни.
create table if not exists planner_day_mood (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  mood text not null check (mood in ('procrastination', 'burnout')),
  note text,
  unique(user_id, date)
);
alter table planner_day_mood enable row level security;
create policy "Users own day_mood" on planner_day_mood
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
