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
create policy "Users can manage own oneoff tasks" on planner_oneoff
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
