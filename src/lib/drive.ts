// Клиент Google Drive v3 для аудио дневника (v0.1.62).
// Единственное хранилище записей: ни локальных файлов, ни Supabase Storage.
// Аутентификация — OAuth2 refresh token пользователя (однократная настройка в
// Настройках дневника: Client ID + Client Secret + Refresh Token, scope drive.file —
// приложение видит только созданные им файлы). Ключи лежат в app_settings
// и синхронизируются между устройствами, поэтому телефон и ПК грузят в тот же Drive.
//
// Структура в Drive: Nucleus/DiaryAudio/YYYY/MM/YYYY-MM-DD-ЧЧММСС.webm —
// зеркально прежней папке вольта. Файл сразу открывается «всем по ссылке»
// (reader/anyone): иначе Obsidian не сможет воспроизвести аудио без локальной
// копии. ID файла — 33+ случайных символа, сама папка Drive остаётся приватной.

import { loadDiarySettings, type DiarySettings } from './diarySettings'
import { SUPABASE_URL } from './supabase'
import { log } from './logger'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'

/**
 * fetch с ретраями на сетевые сбои: внутри WebView соединения к Google иногда
 * умирают на коннекте (~21с тишины, затем «Failed to fetch»), а повторная
 * попытка через пару секунд проходит. 5xx/429 тоже ретраим, 4xx — нет.
 */
async function fetchRetry(url: string, init: RequestInit, tries = 3): Promise<Response> {
  let lastErr: unknown = null
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(url, init)
      if ((res.status < 500 && res.status !== 429) || attempt === tries - 1) return res
    } catch (e) {
      lastErr = e
      if (attempt === tries - 1) throw e
    }
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)))
  }
  throw lastErr
}

export type DriveConfig = { clientId: string; clientSecret: string; refreshToken: string }

/** Достаёт Drive-ключи из настроек дневника; null — интеграция не настроена. */
export function driveConfigFrom(s: DiarySettings | null | undefined): DriveConfig | null {
  const clientId = s?.driveClientId?.trim() ?? ''
  const clientSecret = s?.driveClientSecret?.trim() ?? ''
  const refreshToken = s?.driveRefreshToken?.trim() ?? ''
  if (!clientId || !clientSecret || !refreshToken) return null
  return { clientId, clientSecret, refreshToken }
}

/** Конфиг Drive текущего пользователя (null — не настроен). */
export async function getDriveConfig(userId: string): Promise<DriveConfig | null> {
  return driveConfigFrom(await loadDiarySettings(userId))
}

// Кэш access token: refreshToken -> { token, expiresAt } (запас 60 c).
const tokenCache = new Map<string, { token: string; expiresAt: number }>()

/**
 * Access token по refresh token (кэш до истечения). Бросает ошибку с текстом
 * от Google — она попадает в статус failed и лог, чтобы причину было видно.
 */
export async function getAccessToken(cfg: DriveConfig): Promise<string> {
  const cached = tokenCache.get(cfg.refreshToken)
  if (cached && Date.now() < cached.expiresAt) return cached.token
  const res = await fetchRetry(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`drive-auth-failed: http ${res.status} ${t.slice(0, 160)}`)
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!json.access_token) throw new Error('drive-auth-failed: no access_token')
  tokenCache.set(cfg.refreshToken, {
    token: json.access_token,
    expiresAt: Date.now() + Math.max(60, (json.expires_in ?? 3600) - 60) * 1000,
  })
  return json.access_token
}

// Кэш папок: «DiaryAudio/2026/10» -> folderId (в памяти + localStorage, чтобы
// не гонять files.list на каждую запись после перезапуска).
const folderCache = new Map<string, string>()
const FOLDER_LS_KEY = 'nucleus:drive:folders'

function loadFolderCache(): void {
  if (folderCache.size > 0) return
  try {
    const raw = localStorage.getItem(FOLDER_LS_KEY)
    if (!raw) return
    for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, string>)) {
      if (typeof v === 'string' && v) folderCache.set(k, v)
    }
  } catch {
    // нет localStorage — живём только в памяти
  }
}

function persistFolderCache(): void {
  try {
    localStorage.setItem(FOLDER_LS_KEY, JSON.stringify(Object.fromEntries(folderCache)))
  } catch {
    // не критично
  }
}

// ===== Папки Nucleus/DiaryAudio/YYYY/MM =====

const FOLDER_MIME = 'application/vnd.google-apps.folder'

/** Ищет папку по имени среди ДОЧЕРНИХ parent (scope drive.file видит только свои). */
async function findFolder(token: string, name: string, parent: string | null): Promise<string | null> {
  const clauses = [
    `name = ${JSON.stringify(name)}`,
    `mimeType = '${FOLDER_MIME}'`,
    'trashed = false',
    // В корне Drive ищем строго через 'root' in parents: вариант 'me' in parents
    // Drive API отвечает 404 «File not found» (проверено живым запросом), из-за
    // чего в v0.1.62 падала каждая загрузка.
    parent ? `'${parent}' in parents` : "'root' in parents",
  ]
  const url = `${DRIVE_API}/files?q=${encodeURIComponent(clauses.join(' and '))}&fields=files(id)&pageSize=5`
  const res = await fetchRetry(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`drive-list-failed: http ${res.status}`)
  const json = (await res.json()) as { files?: Array<{ id?: string }> }
  return json.files?.[0]?.id ?? null
}

async function createFolder(token: string, name: string, parent: string | null): Promise<string> {
  const res = await fetchRetry(`${DRIVE_API}/files?fields=id`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      ...(parent ? { parents: [parent] } : {}),
    }),
  })
  if (!res.ok) throw new Error(`drive-mkdir-failed: http ${res.status}`)
  const json = (await res.json()) as { id?: string }
  if (!json.id) throw new Error('drive-mkdir-failed: no id')
  return json.id
}

/** Ищет или создаёт цепочку папок; путь — сегменты от корня Drive. */
export async function ensureFolderPath(token: string, segments: string[]): Promise<string> {
  const key = segments.join('/')
  loadFolderCache()
  const cached = folderCache.get(key)
  if (cached) return cached
  let parent: string | null = null
  for (let i = 0; i < segments.length; i++) {
    const subKey = segments.slice(0, i + 1).join('/')
    const hit = folderCache.get(subKey)
    if (hit) {
      parent = hit
      continue
    }
    const found = await findFolder(token, segments[i], parent)
    parent = found ?? (await createFolder(token, segments[i], parent))
    folderCache.set(subKey, parent)
  }
  persistFolderCache()
  return parent as string
}

// ===== Загрузка аудио =====

/** Дата/время по зоне устройства, создавшего запись (та же конвенция имён, что у вольта). */
function inTz(d: Date, tz: string | null | undefined): Record<string, string> {
  const opts = { ...(tz ? { timeZone: tz } : {}), numberingSystem: 'latn' } as Intl.DateTimeFormatOptions
  const fmt = new Intl.DateTimeFormat('en-GB', { ...opts, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const out: Record<string, string> = {}
  for (const p of fmt.formatToParts(d)) if (p.type !== 'literal') out[p.type] = p.value
  return out
}

export function driveAudioName(createdAt: string, timezone: string | null | undefined, mime: string): string {
  const p = inTz(new Date(createdAt), timezone)
  const ext = mime.includes('mp4') ? 'm4a' : 'webm'
  return `${p.year}-${p.month}-${p.day}-${p.hour}${p.minute}${p.second}.${ext}`
}

/**
 * Ссылка для <audio> в Obsidian и в карточках Nucleus — через наш
 * стриминг-прокси diary-audio-stream. Прямые ссылки Drive непригодны для
 * Chromium: тот отдаёт application/octet-stream + nosniff + attachment,
 * и медиаплеер отказывается играть (0:00/0:00). Прокси отдаёт тот же
 * публичный файл с правильным Content-Type и поддержкой Range.
 */
export function driveStreamUrl(fileId: string): string {
  return `${SUPABASE_URL}/functions/v1/diary-audio-stream?id=${encodeURIComponent(fileId)}`
}

/** Открывает файл «всем, у кого есть ссылка» (reader). Без этого Obsidian не проиграет аудио. */
async function makePublic(token: string, fileId: string): Promise<void> {
  const res = await fetchRetry(`${DRIVE_API}/files/${encodeURIComponent(fileId)}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  })
  if (!res.ok) throw new Error(`drive-share-failed: http ${res.status}`)
}

/**
 * Загружает клип в Drive: Nucleus/DiaryAudio/YYYY/MM/<имя>. Возвращает fileId
 * (он же сохраняется в diary_entries.audio_path). Ретрай один раз при 401
 * (токен мог истечь прямо перед загрузкой).
 */
export async function uploadDiaryAudio(
  cfg: DriveConfig,
  entry: { created_at: string; timezone?: string | null },
  blob: Blob,
): Promise<string> {
  const token = await getAccessToken(cfg)
  log.info('diary', 'Drive upload: access token acquired')
  const mime = blob.type || 'audio/webm'
  const name = driveAudioName(entry.created_at, entry.timezone, mime)
  const [y, m] = name.slice(0, 10).split('-') // YYYY-MM-DD из имени
  const folderId = await ensureFolderPath(token, ['Nucleus', 'DiaryAudio', y, m])
  log.info('diary', 'Drive upload: folder ensured', { folderId, name, bytes: blob.size })

  const upload = async (accessToken: string): Promise<Response> => {
    const boundary = 'nucleus' + Math.random().toString(36).slice(2)
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify({ name, parents: [folderId] }),
      `\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
      blob,
      `\r\n--${boundary}--\r\n`,
    ])
    return fetchRetry(`${UPLOAD_API}/files?uploadType=multipart&fields=id`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    })
  }

  let res = await upload(token)
  if (res.status === 401) {
    tokenCache.delete(cfg.refreshToken)
    res = await upload(await getAccessToken(cfg))
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`drive-upload-failed: http ${res.status} ${t.slice(0, 160)}`)
  }
  const json = (await res.json()) as { id?: string }
  if (!json.id) throw new Error('drive-upload-failed: no id')
  try {
    await makePublic(token, json.id)
  } catch {
    // публичная ссылка не удалась — файл уже загружен, транскрипция не страдает;
    // воспроизведение в Obsidian подхватится при следующем синке вольта
  }
  return json.id
}

/** Удаляет файл из Drive. 404 = уже удалён — не ошибка. */
export async function deleteDriveFile(cfg: DriveConfig, fileId: string): Promise<void> {
  const res = await fetchRetry(`${DRIVE_API}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${await getAccessToken(cfg)}` },
  })
  if (!res.ok && res.status !== 404) throw new Error(`drive-delete-failed: http ${res.status}`)
}

/** audio_path, лежащий в Drive (id без слэшей), vs легаси-путь Supabase «user/дата/…». */
export function isDriveAudioPath(path: string | null | undefined): path is string {
  return !!path && !path.includes('/')
}
