-- =====================================================================
-- FinLit -- Цели: ручной порядок второстепенных целей
-- Добавляет столбец sort_order в goals, чтобы порядок, заданный кнопкой
-- «Переместить», сохранялся в базе и синхронизировался между устройствами
-- (телефон и компьютер). Выполнить один раз в Supabase SQL Editor.
-- Безопасно запускать повторно (IF NOT EXISTS).
-- =====================================================================

alter table public.goals
  add column if not exists sort_order integer not null default 0;

-- Бэкафилл: нумеруем существующие цели каждого пользователя по дате создания
-- (новые сверху), чтобы текущий порядок на экране сохранился до первой ручной
-- перестановки.
with ordered as (
  select id, row_number() over (
    partition by user_id order by created_at desc
  ) as rn
  from public.goals
)
update public.goals g
set sort_order = o.rn
from ordered o
where g.id = o.id;
