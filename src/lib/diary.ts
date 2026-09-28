// Сервис модуля «Дневник»: записи, пайплайн AI (транскрибация + выжимка),
// эксперименты, офлайн-очередь. Вечный архив — Second Brain (vaultSync.ts),
// здесь — рабочее хранилище Supabase и вызовы Edge Function diary-ai.
//
// Статусная машина записи: pending → transcribing → summarizing → ready | failed.
// Офлайн: строка записи уходит через общий офлайн-слой supabase (offlineFetch),
// аудио до загрузки лежит в IndexedDB; пайплайн продолжается автоматически,
// когда очередь офлайн-изменений доходит до базы (событие nucleus:offline-flushed).

import { supabase } from './supabase'
import { isOnline } from './offlineSync'

// ===== Типы (ParsedDiarySummary — из Echo, без изменений) =====

export type ParsedExperimentUpdate = {
  has_experiment_update: boolean
  matched_experiment_id?: string | null
  is_new_experiment?: boolean
  experiment_title?: string
  target_days?: number
  criteria?: string
  day_number?: number
  success_status?: boolean
  challenges_identified?: string
  coach_tip?: string
}

export type ParsedDiarySummary = {
  title: string
  summary_text: string
  key_events: string[]
  insights: string[]
  action_items: string[]
  mood_score: number
  tags: string[]
  experiment?: ParsedExperimentUpdate
}

export type DiaryStatus = 'pending' | 'transcribing' | 'summarizing' | 'ready' | 'failed'

export type DiaryEntry = {
  id: string
  user_id: string
  entry_date: string // локальная дата клиента YYYY-MM-DD
  source: 'voice' | 'text'
  status: DiaryStatus
  original_text: string | null
  audio_path: string | null
  summary: ParsedDiarySummary | null
  experiment_id: string | null
  timezone: string | null
  vault_synced_at: string | null
  created_at: string
}

export type DiaryExperiment = {
  id: string
  user_id: string
  title: string
  criteria: string | null
  target_days: number | null
  started_on: string
  status: 'active' | 'completed' | 'abandoned'
  created_at: string
}

// ===== Локальные даты (закон вольта: у клиента — его время, не UTC) =====

/** Локальная дата в формате YYYY-MM-DD. */
export function localDateStr(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function todayStr(): string {
  return localDateStr(new Date())
}

function clientTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** Время HH:MM по зоне устройства, создавшего запись (fallback — местное время). */
export function entryTimeHM(createdAt: string, timezone?: string | null): string {
  const d = new Date(createdAt)
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      ...(timezone ? { timeZone: timezone } : {}),
      // Intl не должен подменять цифры — forceLatn на всякий случай
      numberingSystem: 'latn',
    } as Intl.DateTimeFormatOptions).format(d)
  } catch {
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
  }
}

// ===== Офлайн-кэш аудио (IndexedDB: entryId -> клип до успешной загрузки) =====

const AUDIO_DB = 'nucleus-diary-audio'
const AUDIO_STORE = 'clips'
let audioDb: Promise<IDBDatabase | null> | null = null

function openAudioDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  if (!audioDb) {
    audioDb = new Promise((resolve) => {
      try {
        const req = indexedDB.open(AUDIO_DB, 1)
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(AUDIO_STORE)) {
            req.result.createObjectStore(AUDIO_STORE)
          }
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => resolve(null)
      } catch {
        resolve(null)
      }
    })
  }
  return audioDb
}

async function audioCachePut(entryId: string, blob: Blob): Promise<void> {
  const db = await openAudioDb()
  if (!db) return
  try {
    const tx = db.transaction(AUDIO_STORE, 'readwrite')
    tx.objectStore(AUDIO_STORE).put(blob, entryId)
  } catch {
    // кэш не критичен: без него голосовая запись офлайн не восстановится,
    // но строка и текст всё равно не потеряются
  }
}

async function audioCacheGet(entryId: string): Promise<Blob | null> {
  const db = await openAudioDb()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(AUDIO_STORE, 'readonly')
      const req = tx.objectStore(AUDIO_STORE).get(entryId)
      req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

async function audioCacheDelete(entryId: string): Promise<void> {
  const db = await openAudioDb()
  if (!db) return
  try {
    const tx = db.transaction(AUDIO_STORE, 'readwrite')
    tx.objectStore(AUDIO_STORE).delete(entryId)
  } catch {
    // не критично
  }
}

// ===== Edge Function diary-ai =====

type DiaryAiResult<T> = { data?: T; error?: string; detail?: string }

async function diaryAi<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<DiaryAiResult<T>>('diary-ai', { body })
  if (error) throw new Error(error.message || 'diary-ai network')
  if (!data || data.error) throw new Error(data?.detail || data?.error || 'diary-ai error')
  return data as T
}

// ===== Записи: чтение =====

export async function fetchDayEntries(userId: string, date: string): Promise<DiaryEntry[]> {
  const { data } = await supabase
    .from('diary_entries')
    .select('*')
    .eq('user_id', userId)
    .eq('entry_date', date)
    .order('created_at', { ascending: true })
    .throwOnError()
  return (data ?? []) as unknown as DiaryEntry[]
}

/** История: записи за период (включая сегодняшние), старые сверху. */
export async function fetchEntriesRange(
  userId: string,
  fromDate: string,
  toDate: string,
): Promise<DiaryEntry[]> {
  const { data } = await supabase
    .from('diary_entries')
    .select('*')
    .eq('user_id', userId)
    .gte('entry_date', fromDate)
    .lte('entry_date', toDate)
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: true })
    .throwOnError()
  return (data ?? []) as unknown as DiaryEntry[]
}

/**
 * Сколько готовых записей ещё не записано в вольт. Считаем только ready:
 * записи в обработке (pending/transcribing/summarizing) и failed физически
 * в вольт попасть не могут — считать их «не в вольте» значит вечно показывать
 * пользователю ложное ожидающее число.
 */
export async function countUnsyncedEntries(userId: string): Promise<number> {
  const { count } = await supabase
    .from('diary_entries')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'ready')
    .is('vault_synced_at', null)
  return count ?? 0
}

// ===== Записи: создание =====

export type SendOptions = { createdNow?: Date }

/**
 * Создаёт запись и запускает пайплайн. id генерирует клиент (не сервер):
 * путь аудио и офлайн-кэш строятся вокруг него ещё до ответа сети, и
 * офлайн-очередь не требует маппинга временных id.
 */
async function insertEntry(
  userId: string,
  source: 'voice' | 'text',
  opts: SendOptions & { originalText?: string } = {},
): Promise<DiaryEntry> {
  const id = crypto.randomUUID()
  const created = opts.createdNow ?? new Date()
  const audioPath =
    source === 'voice' ? `${userId}/${todayStr()}/${id}.webm` : null
  const row = {
    id,
    user_id: userId,
    entry_date: todayStr(),
    source,
    // Офлайн — ждём в очереди; онлайн — сразу следующий шаг пайплайна.
    status: isOnline() ? (source === 'voice' ? 'transcribing' : 'summarizing') : 'pending',
    // Текст записи известен сразу (текстовая запись) — едёт в той же строке,
    // чтобы офлайн-вставка была самодостаточной.
    original_text: opts.originalText ?? null,
    audio_path: audioPath,
    timezone: clientTimezone(),
    created_at: created.toISOString(),
  }
  const { data, error } = await supabase
    .from('diary_entries')
    .insert(row)
    .select()
    .single()
    .throwOnError()
  if (error) throw error
  return data as unknown as DiaryEntry
}

/**
 * Текстовая запись: оригинал уходит вместе со строкой (одна вставка, офлайн —
 * через очередь общего офлайн-слоя).
 */
export async function sendTextEntry(
  userId: string,
  text: string,
): Promise<{ entry: DiaryEntry; done: boolean }> {
  const entry = await insertEntry(userId, 'text', { originalText: text })
  if (!isOnline()) return { entry, done: false }
  void continueEntry(userId, entry.id).catch(() => {})
  return { entry, done: false }
}

/**
 * Голосовая запись: клип кэшируется локально сразу (переживёт закрытие
 * приложения без сети), дальше — обычный пайплайн.
 */
export async function sendVoiceEntry(
  userId: string,
  clip: { blob: Blob; ext: string },
): Promise<{ entry: DiaryEntry; done: boolean }> {
  const entry = await insertEntry(userId, 'voice')
  await audioCachePut(entry.id, clip.blob)
  if (!isOnline()) return { entry, done: false }
  void continueEntry(userId, entry.id).catch(() => {})
  return { entry, done: false }
}

// ===== Пайплайн записи =====

/** Возвращает подписанный URL приватного бакета (или null). */
async function signedAudioUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from('diary-audio').createSignedUrl(path, 600)
  return data?.signedUrl ?? null
}

async function uploadAudioClip(path: string, blob: Blob): Promise<boolean> {
  const { error } = await supabase.storage
    .from('diary-audio')
    .upload(path, blob, { upsert: true, contentType: blob.type || 'audio/webm' })
  return !error
}

/** Продолжает пайплайн одной записи с текущего шага. Возвращает финальную запись. */
export async function continueEntry(userId: string, entryId: string): Promise<DiaryEntry | null> {
  const { data } = await supabase
    .from('diary_entries')
    .select('*')
    .eq('id', entryId)
    .eq('user_id', userId)
    .maybeSingle()
  const entry = data as unknown as DiaryEntry | null
  if (!entry || entry.status === 'ready' || entry.status === 'failed') return entry

  try {
    // Шаг 1: транскрипт (только голос и только если его ещё нет).
    let original = entry.original_text
    if (!original) {
      if (entry.source !== 'voice' || !entry.audio_path) {
        await supabase.from('diary_entries').update({ status: 'failed' }).eq('id', entry.id)
        return null
      }
      await supabase.from('diary_entries').update({ status: 'transcribing' }).eq('id', entry.id)

      let uploaded = false
      if (isOnline()) {
        const cached = await audioCacheGet(entry.id)
        if (cached) uploaded = await uploadAudioClip(entry.audio_path, cached)
        else uploaded = true // клип уже в бакете (запись с другого устройства)
      }
      if (!uploaded) throw new Error('audio-upload-failed')

      const url = await signedAudioUrl(entry.audio_path)
      if (!url) throw new Error('signed-url-failed')
      const audioRes = await fetch(url)
      if (!audioRes.ok) throw new Error('audio-download-failed')
      const { transcript } = await diaryAi<{ transcript: string }>({
        op: 'transcribe',
        audioPath: entry.audio_path,
      })
      original = transcript
      await supabase
        .from('diary_entries')
        .update({ original_text: transcript, status: 'summarizing' })
        .eq('id', entry.id)
      // Транскрипт в бакете, локальный клип больше не нужен.
      await audioCacheDelete(entry.id)
    } else if (entry.status !== 'summarizing') {
      await supabase.from('diary_entries').update({ status: 'summarizing' }).eq('id', entry.id)
    }

    // Шаг 2: выжимка (эксперименты подаются списком — см. активные).
    const experiments = await fetchActiveExperiments(userId)
    const activeExperiments = await Promise.all(
      experiments.map(async (e) => ({
        id: e.id,
        title: e.title,
        criteria: e.criteria,
        target_days: e.target_days,
        started_on: e.started_on,
        last_day_number: await experimentDaysTracked(userId, e.id),
      })),
    )
    const { summary } = await diaryAi<{ summary: ParsedDiarySummary }>({
      op: 'summarize',
      text: original,
      activeExperiments,
    })

    // Шаг 3: регистр экспериментов — AI-матч или создание нового.
    let experimentId: string | null = null
    const exp = summary.experiment
    if (exp?.has_experiment_update) {
      if (exp.is_new_experiment && exp.experiment_title) {
        experimentId = await createExperiment(userId, {
          title: exp.experiment_title,
          criteria: exp.criteria ?? null,
          target_days: exp.target_days ?? null,
          started_on: entry.entry_date,
        })
      } else if (exp.matched_experiment_id) {
        const known = experiments.some((e) => e.id === exp.matched_experiment_id)
        experimentId = known ? exp.matched_experiment_id : null
      }
    }

    const { data: updated } = await supabase
      .from('diary_entries')
      .update({
        summary,
        status: 'ready',
        ...(experimentId ? { experiment_id: experimentId } : {}),
      })
      .eq('id', entry.id)
      .select()
      .single()
      .throwOnError()
    return updated as unknown as DiaryEntry
  } catch (e) {
    // Ошибка пайплайна не теряет запись: статус failed и кнопка «Повторить».
    await supabase.from('diary_entries').update({ status: 'failed' }).eq('id', entry.id)
    throw e
  }
}

/** Ручной «Повторить» для failed. */
export async function retryEntry(userId: string, entryId: string): Promise<void> {
  await supabase
    .from('diary_entries')
    .update({ status: 'pending' })
    .eq('id', entryId)
    .eq('user_id', userId)
  await continueEntry(userId, entryId)
}

// ===== Редактирование и удаление =====

/**
 * Сохраняет отредактированный оригинал и заново прогоняет выжимку:
 * модель пересматривает текст и возвращает обновлённую структуру.
 * Возвращает обновлённую запись (или null, если выжимка не удалась —
 * тогда оригинал всё равно сохранён, см. updateOriginalText).
 */
export async function saveEditedEntry(userId: string, entryId: string, newText: string): Promise<DiaryEntry | null> {
  const value = newText.trim()
  if (!value) throw new Error('empty-text')
  const entry = await updateOriginalText(userId, entryId, value)
  if (!entry) return null

  // Перегоняем выжимку по новому оригиналу.
  const experiments = await fetchActiveExperiments(userId)
  const activeExperiments = await Promise.all(
    experiments.map(async (e) => ({
      id: e.id,
      title: e.title,
      criteria: e.criteria,
      target_days: e.target_days,
      started_on: e.started_on,
      last_day_number: await experimentDaysTracked(userId, e.id),
    })),
  )
  const { summary } = await diaryAi<{ summary: ParsedDiarySummary }>({
    op: 'summarize',
    text: value,
    activeExperiments,
  })

  // Ре-матч эксперимента по новой выжимке.
  let experimentId: string | null = null
  const exp = summary.experiment
  if (exp?.has_experiment_update) {
    if (exp.is_new_experiment && exp.experiment_title) {
      experimentId = await createExperiment(userId, {
        title: exp.experiment_title,
        criteria: exp.criteria ?? null,
        target_days: exp.target_days ?? null,
        started_on: entry.entry_date,
      })
    } else if (exp.matched_experiment_id) {
      const known = experiments.some((e) => e.id === exp.matched_experiment_id)
      experimentId = known ? exp.matched_experiment_id : null
    }
  }

  const { data: updated } = await supabase
    .from('diary_entries')
    // vault_synced_at обнуляем: выжимка изменилась — блок в вольте надо
    // переписать (десктоп подхватит и заменит его через replaceEntryInVault).
    .update({
      summary,
      status: 'ready',
      vault_synced_at: null,
      ...(experimentId ? { experiment_id: experimentId } : {}),
    })
    .eq('id', entryId)
    .eq('user_id', userId)
    .select()
    .single()
    .throwOnError()
  return (updated as unknown as DiaryEntry | null) ?? null
}

/** Меняет только оригинальный текст записи (без перегонки выжимки). */
export async function updateOriginalText(
  userId: string,
  entryId: string,
  newText: string,
): Promise<DiaryEntry | null> {
  const { data, error } = await supabase
    .from('diary_entries')
    .update({ original_text: newText })
    .eq('id', entryId)
    .eq('user_id', userId)
    .select()
    .maybeSingle()
  if (error) throw error
  return (data as unknown as DiaryEntry | null) ?? null
}

/**
 * Удаляет запись: строку в БД и аудиоклип в бакете (если был).
 * Вольт-заметку чистит vaultSync.removeEntryFromVault — он знает формат файла.
 * Аудиокэш IndexedDB тоже подтираем на всякий случай.
 */
export async function deleteEntry(userId: string, entry: DiaryEntry): Promise<void> {
  await audioCacheDelete(entry.id)
  if (entry.audio_path) {
    await supabase.storage.from('diary-audio').remove([entry.audio_path]).then(undefined, () => {})
  }
  const { error } = await supabase
    .from('diary_entries')
    .delete()
    .eq('id', entry.id)
    .eq('user_id', userId)
  if (error) throw error
}

// ===== Эксперименты =====

export async function fetchActiveExperiments(userId: string): Promise<DiaryExperiment[]> {
  const { data } = await supabase
    .from('diary_experiments')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('started_on', { ascending: false })
  return (data ?? []) as unknown as DiaryExperiment[]
}

/** Сколько ДНЕЙ (не записей) уже отслежено по эксперименту. */
async function experimentDaysTracked(userId: string, experimentId: string): Promise<number> {
  const { data } = await supabase
    .from('diary_entries')
    .select('entry_date')
    .eq('user_id', userId)
    .eq('experiment_id', experimentId)
    .eq('status', 'ready')
  const days = new Set((data ?? []).map((r) => (r as { entry_date: string }).entry_date))
  return days.size
}

export async function createExperiment(
  userId: string,
  exp: { title: string; criteria: string | null; target_days: number | null; started_on: string },
): Promise<string | null> {
  const { data } = await supabase
    .from('diary_experiments')
    .insert({ user_id: userId, ...exp })
    .select('id')
    .single()
  return (data as { id: string } | null)?.id ?? null
}

// ===== Автопродолжение пайплайнов (офлайн-записи, прерванные шаги) =====

const resuming = new Set<string>()
let resumeRunning = false

/**
 * Ищет записи, застрявшие до выжимки (офлайн-очередь дошла до базы, приложение
 * было закрыто посреди пайплайна) и продолжает их. Вызывается при старте
 * экрана дневника, при появлении сети и после офлайн-флеша.
 */
export async function resumePendingPipelines(userId: string): Promise<void> {
  if (!isOnline() || resumeRunning) return
  resumeRunning = true
  try {
    const { data } = await supabase
      .from('diary_entries')
      .select('id')
      .eq('user_id', userId)
      .in('status', ['pending', 'transcribing', 'summarizing'])
      .order('created_at', { ascending: true })
      .limit(20)
    const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id)
    for (const id of ids) {
      if (resuming.has(id)) continue
      resuming.add(id)
      try {
        await continueEntry(userId, id)
      } catch {
        // continueEntry сам пометит failed; идём дальше по списку
      } finally {
        resuming.delete(id)
      }
    }
  } catch {
    // нет сети/таблицы — попробуем в следующий триггер
  } finally {
    resumeRunning = false
  }
}
