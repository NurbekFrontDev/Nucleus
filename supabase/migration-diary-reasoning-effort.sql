-- =====================================================================
-- Nucleus v0.1.66 — thinking effort AI-выжимки дневника (GPT-OSS 120B / Groq).
--
-- app_settings.diary_reasoning_effort: уровень «размышлений» модели
-- openai/gpt-oss-120b при выжимке записи. Принимается API Groq (проверено
-- эмпирически, см. supabase/functions/diary-ai/index.ts):
--   none | default | minimal | low | medium | high | xhigh | max
-- null = серверный дефолт edge-функции (low: самые быстрые выжимки).
--
-- Идемпотентно. Применить: Supabase SQL Editor -> вставить -> Run.
-- =====================================================================

alter table public.app_settings
  add column if not exists diary_reasoning_effort text;
