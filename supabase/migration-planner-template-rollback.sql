-- =====================================================================
-- Nucleus — Планировщик: снимки отката шаблонов дня (Template Rollback).
-- Позволяет вернуть день к исходному состоянию после применения шаблона.
-- Идемпотентно: безопасно запускать повторно.
-- =====================================================================

create table if not exists public.planner_day_template_rollbacks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  template_id uuid references public.planner_day_templates(id) on delete set null,
  template_name text not null,
  applied_at timestamptz not null default now(),
  previous_overrides jsonb not null default '[]'::jsonb,
  previous_orders jsonb not null default '[]'::jsonb,
  archived_oneoff_ids jsonb not null default '[]'::jsonb,
  created_oneoff_ids jsonb not null default '[]'::jsonb,
  unique (user_id, date)
);

create index if not exists idx_planner_day_template_rollbacks_date
  on public.planner_day_template_rollbacks (user_id, date);

alter table public.planner_day_template_rollbacks enable row level security;

drop policy if exists "own planner_day_template_rollbacks" on public.planner_day_template_rollbacks;
create policy "own planner_day_template_rollbacks" on public.planner_day_template_rollbacks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
