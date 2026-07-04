-- =====================================================================
-- Nucleus -- ОДНОРАЗОВЫЙ РЕМОНТ (не миграция).
-- Исправляет уже рассинхронившиеся прошлые дни после бага «правка
-- меняла через день». Проблема: у некоторых прошлых дней была ручная
-- правка дня без снимка названия (title IS NULL), поэтому они показывали
-- НОВОЕ название шаблона.
-- Решение: берём ОРИГИНАЛЬНОЕ название из снимка-заморозки (frozen=true)
-- того же дела и проставляем его таким дням.
-- Запустить ОДИН раз в Supabase (SQL Editor). Безопасно повторно (трогает
-- только строки с title IS NULL за прошлые даты).
-- =====================================================================

update public.planner_day_overrides o
set title = f.title,
    icon = coalesce(o.icon, f.icon),
    updated_at = now()
from (
  select distinct on (item_id) item_id, title, icon
  from public.planner_day_overrides
  where frozen = true and title is not null
) f
where o.item_id = f.item_id
  and o.title is null
  and o.date < current_date;
