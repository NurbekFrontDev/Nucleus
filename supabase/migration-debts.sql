-- =====================================================================
-- FinLit — Этап D: Долги (вкладка)
-- Выполнить в Supabase: SQL Editor -> New query -> вставить и Run.
-- =====================================================================

-- Долги по людям (кому и сколько должен)
create table if not exists public.debts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  person text not null,
  amount numeric(14,2) not null default 0,
  note text,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

-- Платежи по долгам (каждый платёж попадает в расходы категории «Долги»)
create table if not exists public.debt_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  debt_id uuid not null references public.debts(id) on delete cascade,
  expense_id uuid references public.expenses(id) on delete set null,
  amount numeric(14,2) not null,
  date date not null default current_date,
  created_at timestamptz not null default now()
);

create index if not exists idx_debts_user on public.debts (user_id);
create index if not exists idx_debt_payments_user on public.debt_payments (user_id);
create index if not exists idx_debt_payments_debt on public.debt_payments (debt_id);

alter table public.debts enable row level security;
alter table public.debt_payments enable row level security;

drop policy if exists "own debts" on public.debts;
create policy "own debts" on public.debts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own debt_payments" on public.debt_payments;
create policy "own debt_payments" on public.debt_payments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
