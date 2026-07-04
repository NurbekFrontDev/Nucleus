-- =====================================================================
-- Nucleus -- Планировщик: «заморозка» прошлых дней при изменении дела.
-- Расширяет planner_day_overrides, чтобы хранить снимок дела на конкретный
-- день ЦЕЛИКОМ (в т.ч. НАЗВАНИЕ и иконку) и отличать авто-снимок заморозки
-- от ручной правки дня.
--   title, icon -> снимок названия/иконки дела на этот день (если null —
--                  берётся значение из шаблона planner_items);
--   frozen      -> true у авто-снимка (создан при изменении дела в «Мои дела»,
--                  чтобы прошлые дни не менялись); false у ручной правки дня
--                  (для неё показывается значок ✎ и кнопка сброса).
-- Логика: при изменении дела в «Мои дела» его старые значения записываются в
-- planner_day_overrides (frozen=true) для всех ПРОШЕДШИХ дней, где дело
-- показывалось, а сам шаблон меняется только для сегодня и будущих дней.
-- Выполнить ОДИН раз в Supabase (SQL Editor) или через run-migration.mjs.
-- Безопасно запускать повторно (IF NOT EXISTS).
-- =====================================================================

alter table public.planner_day_overrides
  add column if not exists title text;
alter table public.planner_day_overrides
  add column if not exists icon text;
alter table public.planner_day_overrides
  add column if not exists frozen boolean not null default false;
