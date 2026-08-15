-- Миграция: интервалы скрытия дел (сохранение истории в прошлых днях)
-- Запустить ОДИН раз в Supabase SQL Editor:
alter table planner_items add column if not exists hidden_intervals jsonb default '[]'::jsonb;
