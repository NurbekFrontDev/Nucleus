-- =====================================================================
-- FinLit - ИИ-8: мягкий дневной лимит обращений к ассистенту.
-- Бережёт расходы на API: считаем число обращений к ИИ за сегодня.
-- При смене дня счётчик сбрасывается (логика на стороне приложения).
-- Выполнить в Supabase: SQL Editor -> New query -> вставить и Run.
-- =====================================================================

alter table public.app_settings
  add column if not exists ai_usage_day date,
  add column if not exists ai_usage_count integer not null default 0;
