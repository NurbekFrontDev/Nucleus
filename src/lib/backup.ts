import { Capacitor } from '@capacitor/core'
import { supabase } from './supabase'

// ===== Бэкап данных одной кнопкой (А-6) =====
// Собираем все данные пользователя из Supabase в один JSON и сохраняем:
//  - в облако: приватный бакет Storage «backups», папка <userId>/;
//  - на телефоне: тихо в папку Documents/Necleus Backup (без окна «Поделиться»);
//  - на ПК: если пользователь один раз выбрал папку (File System Access API) — тихо туда;
//    иначе обычное скачивание в папку загрузок браузера.
// Больше не нужен PowerShell/pg_dump: кнопка работает и на телефоне, и на компьютере.

// Все пользовательские таблицы, попадающие в бэкап. Имена сверены с кодом
// (schema.sql, db.ts, crypto.ts, planner.ts, water.ts, assistant.ts). У всех есть
// колонка user_id, поэтому выгружаем только строки текущего пользователя.
export const BACKUP_TABLES = [
  'app_settings',
  'categories',
  'months',
  'incomes',
  'expenses',
  'currencies',
  'goals',
  'goal_contributions',
  'debts',
  'debt_payments',
  'crypto_assets',
  'crypto_transactions',
  'crypto_futures',
  'crypto_monthly',
  'planner_items',
  'planner_logs',
  'planner_day_order',
  'planner_day_overrides',
  'planner_reflections',
  'pomodoro_sessions',
  'water_logs',
  'ai_messages',
]

const BUCKET = 'backups'

// Папка на телефоне внутри Documents (название совпадает с той, что создал
// пользователь: «Necleus Backup»).
const DEVICE_SUBDIR = 'Necleus Backup'

// Куда сохранён бэкап (коды). Могут комбинироваться через '+', напр. 'device+cloud'.
export type BackupWhere = 'device' | 'pc' | 'download' | 'cloud' | null

export type BackupResult = {
  fileName: string
  tableCount: number
  rowCount: number
  cloud: boolean
  file: boolean
  where: BackupWhere // куда сохранён файл (без учёта облака)
  target: string // итоговый код места для отображения (напр. 'device+cloud')
  skipped: string[]
}

function todayStamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// ===== Человекочитаемая метка «куда сохранёно» =====
export function backupTargetLabel(target: string | null | undefined, lang: 'ru' | 'en'): string {
  if (!target) return lang === 'en' ? 'unknown' : 'неизвестно'
  const map: Record<string, { ru: string; en: string }> = {
    device: { ru: 'папка на телефоне', en: 'phone folder' },
    pc: { ru: 'папка на ПК', en: 'PC folder' },
    download: { ru: 'загрузки', en: 'downloads' },
    cloud: { ru: 'облако', en: 'cloud' },
    'cloud-auto': { ru: 'облако (авто)', en: 'cloud (auto)' },
  }
  return target
    .split('+')
    .map((p) => map[p]?.[lang] ?? p)
    .join(' + ')
}

// ===== File System Access API: папка для бэкапов на ПК =====
// Браузер не может молча писать в произвольный путь (E:\...). Но если пользователь
// один раз выберет папку через системный диалог, мы сохраним её handle в IndexedDB и
// дальше пишем туда без лишних окон.
const IDB_DB = 'nucleus-backup'
const IDB_STORE = 'handles'
const DIR_KEY = 'backupDir'

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await idb()
    return await new Promise<T | null>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly')
      const r = tx.objectStore(IDB_STORE).get(key)
      r.onsuccess = () => resolve((r.result as T) ?? null)
      r.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

async function idbSet(key: string, val: unknown): Promise<void> {
  try {
    const db = await idb()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).put(val, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } catch {
    // не критично
  }
}

// Есть ли в браузере File System Access API (Chrome/Edge на ПК).
export function supportsFsAccess(): boolean {
  return (
    typeof window !== 'undefined' &&
    'showDirectoryPicker' in window &&
    !Capacitor.isNativePlatform()
  )
}

// Открывает системный выбор папки и запоминает её. Возвращает имя папки.
export async function pickBackupDir(): Promise<string | null> {
  try {
    const picker = (window as unknown as { showDirectoryPicker?: (o?: unknown) => Promise<FileSystemDirectoryHandle> })
      .showDirectoryPicker
    if (!picker) return null
    const handle = await picker({ mode: 'readwrite' })
    await idbSet(DIR_KEY, handle)
    return handle.name ?? null
  } catch {
    // пользователь отменил выбор или браузер не поддерживает
    return null
  }
}

// Имя ранее выбранной папки (для показа в настройках). null — не выбрана.
export async function getSavedDirName(): Promise<string | null> {
  const h = await idbGet<FileSystemDirectoryHandle>(DIR_KEY)
  return h?.name ?? null
}

// Возвращает сохранённый handle папки, если есть право на запись.
async function getWritableDir(interactive: boolean): Promise<FileSystemDirectoryHandle | null> {
  const h = await idbGet<FileSystemDirectoryHandle>(DIR_KEY)
  if (!h) return null
  try {
    const opts = { mode: 'readwrite' as const }
    const anyH = h as unknown as {
      queryPermission?: (o: unknown) => Promise<PermissionState>
      requestPermission?: (o: unknown) => Promise<PermissionState>
    }
    let perm: PermissionState = anyH.queryPermission ? await anyH.queryPermission(opts) : 'granted'
    if (perm !== 'granted' && interactive && anyH.requestPermission) {
      perm = await anyH.requestPermission(opts)
    }
    if (perm !== 'granted') return null
    return h
  } catch {
    return null
  }
}

// Собирает все данные пользователя в один объект. Таблицы, которых нет или к которым
// нет доступа, тихо пропускаются (попадают в skipped), бэкап при этом не падает.
export async function collectBackup(
  userId: string,
): Promise<{ payload: Record<string, unknown>; rowCount: number; skipped: string[] }> {
  const tables: Record<string, unknown> = {}
  let rowCount = 0
  const skipped: string[] = []
  for (const table of BACKUP_TABLES) {
    try {
      const { data, error } = await supabase.from(table).select('*').eq('user_id', userId)
      if (error) {
        skipped.push(table)
        continue
      }
      tables[table] = data ?? []
      rowCount += (data ?? []).length
    } catch {
      skipped.push(table)
    }
  }
  const payload = {
    app: 'Nucleus / FinLit',
    version: 1,
    exportedAt: new Date().toISOString(),
    userId,
    tables,
  }
  return { payload, rowCount, skipped }
}

// Загрузка JSON в приватный бакет Storage, в папку пользователя.
async function uploadToCloud(userId: string, fileName: string, json: string): Promise<boolean> {
  try {
    const path = `${userId}/${fileName}`
    const blob = new Blob([json], { type: 'application/json' })
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
      contentType: 'application/json',
      upsert: true,
    })
    return !error
  } catch {
    return false
  }
}

// Сохранение файла на устройство. Возвращает код места (или null при ошибке):
//  - 'телефон' -> Documents/Necleus Backup, без окна «Поделиться»;
//  - 'ПК' (pc) -> выбранная папка через File System Access API;
//  - 'download' -> обычное скачивание в браузере (если папка не выбрана).
// interactive=true — вызов внутри клика (можно запросить разрешение на папку).
async function saveToDevice(fileName: string, json: string, interactive: boolean): Promise<BackupWhere> {
  try {
    if (Capacitor.isNativePlatform()) {
      const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
      await Filesystem.writeFile({
        path: `${DEVICE_SUBDIR}/${fileName}`,
        data: json,
        directory: Directory.Documents,
        encoding: Encoding.UTF8,
        recursive: true,
      })
      return 'device'
    }

    // Веб/десктоп: сначала пробуем тихо записать в выбранную папку.
    const dir = await getWritableDir(interactive)
    if (dir) {
      try {
        const fh = await dir.getFileHandle(fileName, { create: true })
        const w = await fh.createWritable()
        await w.write(json)
        await w.close()
        return 'pc'
      } catch {
        // не удалось — падаем на обычное скачивание
      }
    }

    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 2000)
    return 'download'
  } catch {
    return null
  }
}

// Отмечает в app_settings, что бэкап сделан (сбрасывает напоминание BackupReminder)
// и сохраняет куда именно сохранён последний бэкап (last_backup_target).
async function markBackupDone(userId: string, auto: boolean, target: string): Promise<void> {
  const nowIso = new Date().toISOString()
  const patch: Record<string, unknown> = {
    user_id: userId,
    last_backup_at: nowIso,
    last_backup_target: target,
    backup_snooze_until: null,
    updated_at: nowIso,
  }
  if (auto) patch.last_auto_backup_at = nowIso
  try {
    await supabase.from('app_settings').upsert(patch, { onConflict: 'user_id' })
  } catch {
    // не критично
  }
}

// Главная функция кнопки «Сделать бэкап»: собирает данные, кладёт в облако и
// (по умолчанию) на устройство. Возвращает сводку для показа пользователю.
export async function runBackup(
  userId: string,
  opts?: { toDevice?: boolean; auto?: boolean },
): Promise<BackupResult> {
  const toDevice = opts?.toDevice ?? true
  const auto = !!opts?.auto
  const { payload, rowCount, skipped } = await collectBackup(userId)
  const json = JSON.stringify(payload, null, 2)
  const fileName = `finlit-backup-${todayStamp()}.json`

  const cloud = await uploadToCloud(userId, fileName, json)
  // На ПК запрос разрешения на папку возможен только при ручном бэкапе (есть жест клика).
  const where: BackupWhere = toDevice ? await saveToDevice(fileName, json, !auto) : null

  // Собираем итоговый код места.
  let target: string
  if (auto) {
    target = 'cloud-auto'
  } else {
    const parts: string[] = []
    if (where) parts.push(where)
    if (cloud) parts.push('cloud')
    target = parts.join('+') || 'none'
  }

  // Отмечаем как сделанный, только если удалось сохранить хотя бы куда-то.
  if (cloud || where) await markBackupDone(userId, auto, target)

  return {
    fileName,
    tableCount: Object.keys(payload.tables as Record<string, unknown>).length,
    rowCount,
    cloud,
    file: !!where,
    where,
    target,
    skipped,
  }
}

// Авто-бэкап при открытии приложения: не чаще, чем раз в backup_every_days дней.
// Только в облако (без скачивания файла, чтобы не мешать пользователю). Если рано
// или авто-бэкап выключен — возвращает null. Иначе возвращает сводку (для тоста).
export async function maybeAutoBackup(userId: string): Promise<BackupResult | null> {
  try {
    const { data } = await supabase
      .from('app_settings')
      .select('backup_auto, backup_every_days, last_auto_backup_at')
      .eq('user_id', userId)
      .maybeSingle()
    const d = data as {
      backup_auto?: boolean | null
      backup_every_days?: number | null
      last_auto_backup_at?: string | null
    } | null
    if (!d || !d.backup_auto) return null
    const everyDays = Number(d.backup_every_days) > 0 ? Number(d.backup_every_days) : 7
    const last = d.last_auto_backup_at ? new Date(d.last_auto_backup_at).getTime() : 0
    if (last) {
      const ageDays = (Date.now() - last) / (24 * 3600 * 1000)
      if (ageDays < everyDays) return null
    }
    return await runBackup(userId, { toDevice: false, auto: true })
  } catch {
    // авто-бэкап не критичен
    return null
  }
}
