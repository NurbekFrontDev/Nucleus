-- ====================================================================
-- П-10: Шаблоны дней.
-- Шаблон = именованный набор дел, задающий «форму» дня
-- (напр. «Со сном утром» / «Без сна утром»). Создаётся
-- снимком текущего дня, применяется к выбранной дате.
-- Запустить в Supabase SQL Editor.
-- ====================================================================

create table if not exists public.planner_day_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  icon text,
  created_at timestamptz not null default now()
);

create table if not exists public.planner_day_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.planner_day_templates(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  note text,
  icon text,
  time_of_day text,
  at_time_start text,
  at_time_end text,
  priority text not null default 'none',
  important boolean not null default false,
  sort_order int not null default 0
);

create index if not exists idx_pdt_user on public.planner_day_templates(user_id);
create index if not exists idx_pdti_template on public.planner_day_template_items(template_id);
create index if not exists idx_pdti_user on public.planner_day_template_items(user_id);

-- RLS: каждый видит и меняет только свои шаблоны.
alter table public.planner_day_templates enable row level security;
alter table public.planner_day_template_items enable row level security;

drop policy if exists "own day templates" on public.planner_day_templates;
create policy "own day templates" on public.planner_day_templates
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own day template items" on public.planner_day_template_items;
create policy "own day template items" on public.planner_day_template_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
