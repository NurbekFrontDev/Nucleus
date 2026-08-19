-- Добавляем колонку reminder_time для разовых задач (время напоминания 'HH:MM')
alter table planner_oneoff add column if not exists reminder_time text;

-- Перезагружаем кэш схемы PostgREST
notify pgrst, 'reload schema';
