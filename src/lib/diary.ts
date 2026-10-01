// Сервис модуля «Дневник»: записи, пайплайн AI (транскрибация + выжимка),
// эксперименты, офлайн-очередь. Вечный архив — Second Brain (vaultSync.ts),
// здесь — рабочее хранилище Supabase (только БД метаданных) и вызовы Edge
// Function diary-ai. Аудио с v0.1.62 живёт в Google Drive (drive.ts) на обоих
// платформах: ни локальных файлов, ни Supabase Storage. Путь бакета в
// audio_path остался только у легаси-записей до v0.1.62 — их пайплайн
// дожимается по прежней ветке.
//
// Статусная машина записи: pending → transcribing → summarizing → ready | failed.
// Офлайн: строка записи уходит через общий офлайн-слой supabase (offlineFetch),
// аудио до загрузки лежит в IndexedDB; пайплайн продолжается автоматически,
// когда очередь офлайн-изменений доходит до базы (событие nucleus:offline-flushed).

import { supabase } from './supabase'
import { isOnline } from './offlineSync'
import { log } from './logger'
import fixWebmDuration from 'fix-webm-duration'
import { deleteDriveFile, driveStreamUrl, driveAudioName, getDriveConfig, isDriveAudioPath, uploadDiaryAudio } from './drive'

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

/**
 * Вызов Edge Function diary-ai. Транскрибация с ретраями внутри может думать
 * до минуты+, поэтому клиентский таймаут — 120 c (AbortSignal.timeout);
 * истёк — честная ошибка ai-timeout вместо вечного «думает».
 */
async function diaryAi<T>(body: Record<string, unknown>, timeoutMs = 120_000): Promise<T> {
  try {
    const { data, error } = await supabase.functions.invoke<DiaryAiResult<T>>('diary-ai', {
      body,
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (error) throw new Error(error.message || 'diary-ai network')
    if (!data || data.error) throw new Error(data?.detail || data?.error || 'diary-ai error')
    return data as T
  } catch (e) {
    if ((e as Error)?.name === 'TimeoutError' || (e as Error)?.name === 'AbortError') {
      throw new Error(`ai-timeout-${Math.round(timeoutMs / 1000)}s`)
    }
    throw e
  }
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
 * офлайн-кэш строится вокруг него ещё до ответа сети, и офлайн-очередь не
 * требует маппинга временных id. audio_path для голоса появляется позже —
 * после загрузки в Google Drive туда пишется fileId (см. doContinueEntry).
 */
async function insertEntry(
  userId: string,
  source: 'voice' | 'text',
  opts: SendOptions & { originalText?: string } = {},
): Promise<DiaryEntry> {
  const id = crypto.randomUUID()
  const created = opts.createdNow ?? new Date()
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
    audio_path: null,
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
 * Ссылка на аудио записи для плеера в карточках (Сегодня/История).
 * Новые записи: стриминг-прокси из Drive (правильный Content-Type для
 * Chromium). Легаси до v0.1.62: подписанный URL приватного бакета на час.
 */
export async function getEntryAudioUrl(entry: DiaryEntry): Promise<string | null> {
  if (entry.source !== 'voice' || !entry.audio_path) return null
  if (isDriveAudioPath(entry.audio_path)) return driveStreamUrl(entry.audio_path)
  try {
    const { data } = await supabase.storage.from('diary-audio').createSignedUrl(entry.audio_path, 3600)
    return data?.signedUrl ?? null
  } catch {
    return null
  }
}

/**
 * Текстовая запись: оригинал уходит вместе со строкой (одна вставка, офлайн —
 * через очередь общего офлайн-слоя). Пайплайн не запускается здесь — экран
 * сам вызывает runEntryPipeline, чтобы узнать о завершении и перерисовать
 * карточку (см. DiaryToday).
 */
export async function sendTextEntry(
  userId: string,
  text: string,
): Promise<{ entry: DiaryEntry; done: boolean }> {
  const entry = await insertEntry(userId, 'text', { originalText: text })
  return { entry, done: false }
}

/**
 * Голосовая запись: клип кэшируется локально сразу (переживёт закрытие
 * приложения без сети), дальше — обычный пайплайн. Для webm в заголовок
 * вписывается реальная длительность (MediaRecorder её не пишет — плееры
 * показывали 0:00/Infinity и ломаный прогресс-бар).
 */
export async function sendVoiceEntry(
  userId: string,
  clip: { blob: Blob; ext: string; durationMs?: number },
): Promise<{ entry: DiaryEntry; done: boolean }> {
  let blob = clip.blob
  if (clip.ext === 'webm' && typeof clip.durationMs === 'number' && clip.durationMs > 0) {
    try {
      blob = await fixWebmDuration(blob, clip.durationMs)
    } catch (e) {
      log.warn('diary', `webm duration patch failed, uploading as-is: ${String((e as Error)?.message ?? e)}`, {}, userId)
    }
  }
  const entry = await insertEntry(userId, 'voice')
  await audioCachePut(entry.id, blob)
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

// ===== Загрузка аудио в Drive: напрямую, при сбое — через сервер =====

function blobToBase64(blob: Blob): Promise<string> {
  return blob.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf)
    let binary = ''
    const CHUNK = 0x8000
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
    }
    return btoa(binary)
  })
}

/**
 * Fallback-загрузка в Drive через Edge Function: в некоторых WebView прямые
 * соединения к googleapis.com умирают на коннекте («Failed to fetch»), а канал
 * Supabase работает всегда — клип уезжает на сервер (base64), сервер льёт его
 * в Drive своими-же ключами пользователя. Возвращает fileId.
 */
async function uploadAudioViaEdge(
  userId: string,
  entry: DiaryEntry,
  blob: Blob,
): Promise<string> {
  const mime = blob.type || 'audio/webm'
  const dataBase64 = await blobToBase64(blob)
  const { fileId } = await diaryAi<{ fileId: string }>(
    {
      op: 'drive-upload',
      fileName: driveAudioName(entry.created_at, entry.timezone, mime),
      mime,
      dataBase64,
    },
    180_000,
  )
  log.info('diary', 'Audio uploaded to Google Drive (server fallback)', { fileId }, userId)
  return fileId
}

/** Продолжает пайплайн одной записи с текущего шага. Возвращает финальную запись. */
export async function continueEntry(userId: string, entryId: string): Promise<DiaryEntry | null> {
  return continueEntryImpl(userId, entryId)
}

/**
 * Глобальная защита от параллельного прогона одного пайплайна: два
 * одновременных вызова (отправка + resume при возврате сети/перевходе на
 * вкладку) раньше приводили к двойной выжимке и ДУБЛЮ эксперимента в БД
 * (каждый прогон создавал свою строку). Повторный вызов для той же записи
 * просто дожидается уже идущего прогона.
 */
const inFlight = new Map<string, Promise<DiaryEntry | null>>()

function continueEntryImpl(userId: string, entryId: string): Promise<DiaryEntry | null> {
  const existing = inFlight.get(entryId)
  if (existing) return existing
  const run = doContinueEntry(userId, entryId).finally(() => inFlight.delete(entryId))
  inFlight.set(entryId, run)
  return run
}

async function doContinueEntry(userId: string, entryId: string): Promise<DiaryEntry | null> {
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
      if (entry.source !== 'voice') {
        await supabase.from('diary_entries').update({ status: 'failed' }).eq('id', entry.id)
        return null
      }
      await supabase.from('diary_entries').update({ status: 'transcribing' }).eq('id', entry.id)

      let transcribeBody: Record<string, unknown>
      if (isDriveAudioPath(entry.audio_path)) {
        // Аудио уже в Google Drive (загружено этим или другим устройством).
        transcribeBody = { op: 'transcribe', driveFileId: entry.audio_path }
      } else if (entry.audio_path) {
        // Легаси (до v0.1.62): путь в бакете diary-audio, дожимаем по-старому.
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
        transcribeBody = { op: 'transcribe', audioPath: entry.audio_path }
      } else {
        // Основной флоу: загрузка клипа в Google Drive, fileId — в audio_path.
        if (!isOnline()) throw new Error('audio-upload-failed')
        const cfg = await getDriveConfig(userId)
        if (!cfg) throw new Error('drive-not-configured')
        const cached = await audioCacheGet(entry.id)
        if (!cached) throw new Error('audio-blob-missing')
        let fileId: string
        try {
          fileId = await uploadDiaryAudio(cfg, entry, cached)
        } catch (directErr) {
          // Прямой канал упал (сеть WebView → Google): пробуем через сервер.
          log.warn('diary', `Direct Drive upload failed, trying server fallback: ${String((directErr as Error)?.message ?? directErr)}`, {}, userId)
          fileId = await uploadAudioViaEdge(userId, entry, cached)
        }
        await supabase.from('diary_entries').update({ audio_path: fileId }).eq('id', entry.id)
        entry.audio_path = fileId
        log.info('diary', 'Audio uploaded to Google Drive', { fileId }, userId)
        transcribeBody = { op: 'transcribe', driveFileId: fileId, mime: cached.type || 'audio/webm' }
      }
      const { transcript } = await diaryAi<{ transcript: string }>(transcribeBody)
      original = transcript
      await supabase
        .from('diary_entries')
        .update({ original_text: transcript, status: 'summarizing' })
        .eq('id', entry.id)
      // Аудио в Drive, локальный клип больше не нужен.
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
    // Причину фиксируем в app_logs ПОЛНОСТЬЮ (сообщение + стек/детали от
    // провайдера), чтобы «Failed» в ленте никогда не был загадкой.
    log.error('diary', `Entry pipeline failed: ${String((e as Error)?.message ?? e)}`, {
      entryId,
      status: 'failed',
      hadAudioPath: !!entry.audio_path,
    }, userId)
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

/**
 * Запускает пайплайн записи в фоне и глотает ошибки (запись останется failed
 * с кнопкой «Повторить»). Экран вызывает после отправки, чтобы дождаться
 * готовности и перерисовать карточку.
 */
export function runEntryPipeline(userId: string, entryId: string): Promise<void> {
  return continueEntry(userId, entryId).then(
    () => {},
    () => {},
  )
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
 * Удаляет запись: строку в БД и аудиофайл (Drive для новых записей, бакет
 * diary-audio для легаси до v0.1.62). Вольт-заметку чистит
 * vaultSync.removeEntryFromVault — он знает формат файла.
 * Аудиокэш IndexedDB тоже подтираем на всякий случай.
 */
export async function deleteEntry(userId: string, entry: DiaryEntry): Promise<void> {
  await audioCacheDelete(entry.id)
  if (entry.audio_path) {
    if (isDriveAudioPath(entry.audio_path)) {
      const cfg = await getDriveConfig(userId)
      if (cfg) await deleteDriveFile(cfg, entry.audio_path).catch(() => {})
    } else {
      await supabase.storage.from('diary-audio').remove([entry.audio_path]).then(undefined, () => {})
    }
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

export type ExperimentPatch = {
  title: string
  criteria: string | null
  target_days: number | null
  started_on: string
}

/** Полное редактирование эксперимента: название, срок, критерии, дата старта. */
export async function updateExperiment(
  userId: string,
  experimentId: string,
  patch: ExperimentPatch,
): Promise<void> {
  const { error } = await supabase
    .from('diary_experiments')
    .update({
      title: patch.title,
      criteria: patch.criteria,
      target_days: patch.target_days,
      started_on: patch.started_on,
    })
    .eq('id', experimentId)
    .eq('user_id', userId)
  if (error) throw error
}

/**
 * Удаляет эксперимент. Записи дневника не пропадают: у них просто снимается
 * ссылка (experiment_id = null) — история остаётся, исчезает только прогресс
 * карточки эксперимента.
 */
export async function deleteExperiment(userId: string, experimentId: string): Promise<void> {
  await supabase
    .from('diary_entries')
    .update({ experiment_id: null })
    .eq('experiment_id', experimentId)
    .eq('user_id', userId)
  const { error } = await supabase
    .from('diary_experiments')
    .delete()
    .eq('id', experimentId)
    .eq('user_id', userId)
  if (error) throw error
}

// ===== Автопродолжение пайплайнов (офлайн-записи, прерванные шаги) =====

let resumeRunning = false

/**
 * Ищет записи, застрявшие до выжимки (офлайн-очередь дошла до базы, приложение
 * было закрыто посреди пайплайна) и продолжает их. Вызывается при старте
 * экрана дневника, при появлении сети и после офлайн-флеша. От параллельности
 * защищает continueEntry: повторный вызов для той же записи дожидается
 * уже идущего прогона.
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
      try {
        await continueEntry(userId, id)
      } catch {
        // continueEntry сам пометит failed; идём дальше по списку
      }
    }
  } catch {
    // нет сети/таблицы — попробуем в следующий триггер
  } finally {
    resumeRunning = false
  }
}
