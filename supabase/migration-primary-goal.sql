-- =====================================================================
-- FinLit — главная цель + распределение 80/20 внутри категории «Цели»
-- Выполнить в Supabase: SQL Editor -> New query -> вставить и Run.
-- Безопасно запускать повторно (IF NOT EXISTS).
-- =====================================================================

-- 1) Флаг главной цели. Главная цель одна (контролируется приложением).
alter table public.goals
  add column if not exists is_primary boolean not null default false;

-- 2) Доля главной цели внутри категории «Цели», в процентах (по умолчанию 80).
--    Второстепенным целям достаётся остаток (100 - это значение).
alter table public.app_settings
  add column if not exists goals_primary_split integer not null default 80;
