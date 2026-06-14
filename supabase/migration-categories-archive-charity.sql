-- =====================================================================
-- FinLit — миграция: архивация категорий + категория «Благотворительность»
-- Запусти ОДИН РАЗ в Supabase → SQL Editor → New query → вставь и Run.
-- ВАЖНО: запускать ДО деплоя нового кода (код уже ожидает колонку archived).
-- =====================================================================

-- 1) Мягкое удаление категорий: archived = true вместо физического удаления,
--    чтобы прошлые расходы в истории сохраняли название категории.
alter table public.categories
  add column if not exists archived boolean not null default false;

-- 2) Новая категория «Благотворительность» (5%).
--    Забираем 5% у «Свободные» (было 10% → станет 5%), чтобы сумма осталась 100%.
update public.categories
  set percent = 5
  where name = 'Свободные';

insert into public.categories (user_id, name, percent, sort_order)
select u.id, 'Благотворительность', 5, 7
from auth.users u
where not exists (
  select 1 from public.categories c
  where c.user_id = u.id and c.name = 'Благотворительность'
);
