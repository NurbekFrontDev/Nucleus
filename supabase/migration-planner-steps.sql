-- =====================================================================
-- Nucleus — Планировщик: добавление подзадач / шагов (Steps) к делам и привычкам.
-- Позволяет декомпозировать задачи и привычки на цепочку микро-шагов.
-- =====================================================================

-- 1. Добавляем колонку steps в planner_items (по умолчанию пустой JSON-массив)
ALTER TABLE public.planner_items ADD COLUMN IF NOT EXISTS steps JSONB DEFAULT '[]'::jsonb;

-- 2. Расширяем допустимые статусы в planner_logs (добавляем in_progress для частичного выполнения шагов)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'planner_logs_status_check'
  ) THEN
    ALTER TABLE public.planner_logs DROP CONSTRAINT planner_logs_status_check;
    ALTER TABLE public.planner_logs ADD CONSTRAINT planner_logs_status_check CHECK (status IN ('done', 'skip', 'fail', 'in_progress'));
  END IF;
END $$;
