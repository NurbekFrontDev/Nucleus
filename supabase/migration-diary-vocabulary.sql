-- v0.1.56: словарь Voxel (Ф3) — канонические фразы для Gemini customVocabulary.
-- Пишется edge-функцией diary-dictionary (push из Voxel), читается diary-ai.
alter table app_settings add column if not exists diary_vocabulary jsonb;

comment on column app_settings.diary_vocabulary is
  'Канонические фразы словаря Voxel (customVocabulary для Gemini 3.5 Transcribe); push из Voxel через diary-dictionary';
