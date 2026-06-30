-- П-8: отметка «Важно» для матрицы Эйзенхауэра (отдельно от срочности-цвета).
-- Запусти один раз в Supabase → SQL Editor. Повторный запуск безопасен.
alter table planner_items
  add column if not exists important boolean not null default false;
