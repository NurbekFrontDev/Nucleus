-- Планировщик: неизменяемая история дней и удаление дела из одного дня.
--
-- 1) planner_items.schedule_changed_at
--    Дата последней смены РАСПИСАНИЯ дела (правило повтора, дни недели, старт).
--    Дни раньше этой даты считаются историей: они больше не пересчитываются
--    по новому правилу. Иначе, вернув «Пн» вместо «Вт», дело задним числом
--    появлялось в прошедшем понедельнике, где его никогда не было.
--
-- 2) planner_day_overrides.hidden
--    Дело убрано ТОЛЬКО из одного конкретного дня. Само дело остаётся в
--    «Мои дела» и продолжает появляться во все остальные дни.
--
-- Миграция идемпотентна: её можно выполнять повторно.

alter table public.planner_items
  add column if not exists schedule_changed_at date;

alter table public.planner_day_overrides
  add column if not exists hidden boolean not null default false;

-- Быстрый доступ к скрытым делам конкретного дня.
create index if not exists planner_day_overrides_hidden_idx
  on public.planner_day_overrides (user_id, date)
  where hidden;
