-- =====================================================================
-- FinLit — схема базы данных (Этап 3)
-- Выполнить в Supabase: SQL Editor -> New query -> вставить и Run.
-- =====================================================================

-- 1) КАТЕГОРИИ (проценты редактируются пользователем)
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  percent numeric(5,2) not null default 0,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- 2) МЕСЯЦЫ (плановый доход на месяц)
create table if not exists public.months (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  year int not null,
  month int not null check (month between 1 and 12),
  planned_income numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, year, month)
);

-- 3) ДОХОДЫ (факт прихода денег)
create table if not exists public.incomes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  month_id uuid references public.months(id) on delete set null,
  amount numeric(14,2) not null,
  date date not null default current_date,
  description text,
  created_at timestamptz not null default now()
);

-- 4) РАСХОДЫ (факт трат по категориям)
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  month_id uuid references public.months(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  amount numeric(14,2) not null,
  date date not null default current_date,
  description text,
  created_at timestamptz not null default now()
);

-- Индексы для скорости
create index if not exists idx_categories_user on public.categories (user_id);
create index if not exists idx_months_user on public.months (user_id);
create index if not exists idx_incomes_user_month on public.incomes (user_id, month_id);
create index if not exists idx_expenses_user_month on public.expenses (user_id, month_id);
create index if not exists idx_expenses_category on public.expenses (category_id);

-- =====================================================================
-- RLS: каждый видит и меняет только свои данные
-- =====================================================================
alter table public.categories enable row level security;
alter table public.months enable row level security;
alter table public.incomes enable row level security;
alter table public.expenses enable row level security;

create policy "own categories" on public.categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own months" on public.months
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own incomes" on public.incomes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own expenses" on public.expenses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =====================================================================
-- Авто-создание 6 категорий при регистрации нового пользователя
-- (проценты по умолчанию; потом меняются в Настройках)
-- =====================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.categories (user_id, name, percent, sort_order) values
    (new.id, 'Сбережения', 10, 1),
    (new.id, 'Инвестиции', 10, 2),
    (new.id, 'Долги', 20, 3),
    (new.id, 'Обязательные', 30, 4),
    (new.id, 'Цели/Хотелки', 20, 5),
    (new.id, 'Свободные', 10, 6);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
