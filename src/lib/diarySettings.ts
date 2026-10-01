// Настройки модуля «Дневник» (per-user). Хранятся в таблице app_settings,
// поэтому одно изменение с ПК моментально применяется и на телефоне —
// таблица уже в WATCHED_TABLES realtimeSync, экран настроек перечитывает
// состояние по событию nucleus-sync.

import { supabase } from './supabase'

export type DiarySettings = {
  smartTranscription: boolean
  summaryPrompt: string | null
  geminiKey: string | null
  groqKey: string | null
  // OAuth Google Drive (хранилище аудио дневника). Пустые = Drive не подключён.
  driveClientId: string | null
  driveClientSecret: string | null
  driveRefreshToken: string | null
  // Уровень «размышлений» (reasoning_effort) GPT-OSS 120B при выжимке.
  // null = серверный дефолт edge-функции (low). allowed: diary-ai/index.ts.
  reasoningEffort: string | null
  // Канонические фразы из словаря Voxel (пишутся edge-функцией diary-dictionary,
  // здесь только читаются для показа счётчика). Read-only в UI.
  vocabulary: string[]
}

export const DIARY_SETTINGS_DEFAULTS: DiarySettings = {
  smartTranscription: true,
  summaryPrompt: null,
  geminiKey: null,
  groqKey: null,
  reasoningEffort: null,
  driveClientId: null,
  driveClientSecret: null,
  driveRefreshToken: null,
  vocabulary: [],
}

const SELECT =
  'diary_smart_transcription, diary_summary_prompt, diary_gemini_key, diary_groq_key, diary_reasoning_effort, diary_drive_client_id, diary_drive_client_secret, diary_drive_refresh_token, diary_vocabulary'

/** Текущие настройки дневника пользователя (дефолты при любой ошибке). */
export async function loadDiarySettings(userId: string): Promise<DiarySettings> {
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select(SELECT)
      .eq('user_id', userId)
      .maybeSingle()
    if (error || !data) return { ...DIARY_SETTINGS_DEFAULTS }
    const r = data as Record<string, unknown>
    return {
      smartTranscription: r.diary_smart_transcription !== false,
      summaryPrompt:
        typeof r.diary_summary_prompt === 'string' && r.diary_summary_prompt.trim()
          ? r.diary_summary_prompt
          : null,
      geminiKey:
        typeof r.diary_gemini_key === 'string' && r.diary_gemini_key.trim() ? r.diary_gemini_key : null,
      groqKey:
        typeof r.diary_groq_key === 'string' && r.diary_groq_key.trim() ? r.diary_groq_key : null,
      reasoningEffort:
        typeof r.diary_reasoning_effort === 'string' && r.diary_reasoning_effort.trim()
          ? r.diary_reasoning_effort.trim()
          : null,
      driveClientId:
        typeof r.diary_drive_client_id === 'string' && r.diary_drive_client_id.trim()
          ? r.diary_drive_client_id
          : null,
      driveClientSecret:
        typeof r.diary_drive_client_secret === 'string' && r.diary_drive_client_secret.trim()
          ? r.diary_drive_client_secret
          : null,
      driveRefreshToken:
        typeof r.diary_drive_refresh_token === 'string' && r.diary_drive_refresh_token.trim()
          ? r.diary_drive_refresh_token
          : null,
      vocabulary: Array.isArray(r.diary_vocabulary)
        ? (r.diary_vocabulary as unknown[]).filter((p): p is string => typeof p === 'string')
        : [],
    }
  } catch {
    return { ...DIARY_SETTINGS_DEFAULTS }
  }
}

/**
 * Сохраняет изменения настроек (частичный апдейт одной строки пользователя).
 * Ключи передаём как есть — RLS «own app_settings» прячет их от других
 * аккаунтов, а пустые строки схлопываем в null (значит «использовать серверный
 * секрет/дефолт»).
 */
export async function saveDiarySettings(
  userId: string,
  patch: Partial<DiarySettings>,
): Promise<void> {
  const row: Record<string, unknown> = { user_id: userId, updated_at: new Date().toISOString() }
  if (patch.smartTranscription !== undefined) row.diary_smart_transcription = patch.smartTranscription
  if (patch.summaryPrompt !== undefined) {
    const v = patch.summaryPrompt?.trim() ?? ''
    row.diary_summary_prompt = v.length > 0 ? v : null
  }
  if (patch.geminiKey !== undefined) {
    const v = patch.geminiKey?.trim() ?? ''
    row.diary_gemini_key = v.length > 0 ? v : null
  }
  if (patch.groqKey !== undefined) {
    const v = patch.groqKey?.trim() ?? ''
    row.diary_groq_key = v.length > 0 ? v : null
  }
  if (patch.reasoningEffort !== undefined) {
    const v = patch.reasoningEffort?.trim() ?? ''
    row.diary_reasoning_effort = v.length > 0 ? v : null
  }
  if (patch.driveClientId !== undefined) {
    const v = patch.driveClientId?.trim() ?? ''
    row.diary_drive_client_id = v.length > 0 ? v : null
  }
  if (patch.driveClientSecret !== undefined) {
    const v = patch.driveClientSecret?.trim() ?? ''
    row.diary_drive_client_secret = v.length > 0 ? v : null
  }
  if (patch.driveRefreshToken !== undefined) {
    const v = patch.driveRefreshToken?.trim() ?? ''
    row.diary_drive_refresh_token = v.length > 0 ? v : null
  }
  const { error } = await supabase
    .from('app_settings')
    .upsert(row, { onConflict: 'user_id' })
  if (error) throw error
}

/**
 * Ставит настройку в офлайн-очередь, если сети нет (общий паттерн приложения:
// изменение дойдёт до базы при появлении сети, а Realtime разнесёт его дальше).
 */
export async function saveDiarySetting(
  userId: string,
  key: keyof DiarySettings,
  value: boolean | string | null,
): Promise<void> {
  await saveDiarySettings(userId, { [key]: value } as Partial<DiarySettings>)
}
