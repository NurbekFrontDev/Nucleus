// Синхронизация дневника в вечный архив Second Brain (только Desktop/Tauri).
// Формат заметок и алгоритм — план «Дневник — Формат заметок Second Brain»:
//   F:\SecondBrain\personal\Diary\YYYY\MM\YYYY-MM-DD.md (одна заметка = день),
//   аудио — personal/Diary/audio/YYYY/MM/YYYY-MM-DD-ЧЧММСС.webm (вне git,
//   облачный бэкап — Google Drive), выжимка — выше, оригинал — ниже дословно.
// Вольт-заметка — append-only журнал: правки Нурбека неприкосновенны, новые
// записи дозаписываются в конец раздела «## Записи», updated обновляется.
// Ошибки (вольт недоступен) не блокируют UI: vault_synced_at не ставится,
// попытка повторяется при следующем триггере.

import { exists, mkdir, readTextFile, writeTextFile, writeFile } from '@tauri-apps/plugin-fs'
import { supabase } from './supabase'
import { isDesktop } from './native'
import type { DiaryEntry } from './diary'

// Строго ограниченный capability-скоуп в src-tauri/capabilities/default.json.
const VAULT_DIARY = 'F:\\SecondBrain\\personal\\Diary'
const VAULT_AUDIO = VAULT_DIARY + '\\audio'

// Русские названия месяцев для заголовка заметки (формат вольта фиксирован).
const RU_MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]

/** Доступен ли вольт-синк в этом окружении (только десктоп). */
export function isVaultSyncAvailable(): boolean {
  return isDesktop()
}

/** Дата/время по зоне устройства, создавшего запись (fallback — местная зона). */
function inTz(d: Date, tz: string | null | undefined, parts: Intl.DateTimeFormatOptions): Record<string, string> {
  const opts = { ...(tz ? { timeZone: tz } : {}), numberingSystem: 'latn' } as Intl.DateTimeFormatOptions
  const fmt = new Intl.DateTimeFormat('en-GB', { ...opts, ...parts })
  const out: Record<string, string> = {}
  for (const p of fmt.formatToParts(d)) if (p.type !== 'literal') out[p.type] = p.value
  return out
}

function audioFileName(entry: DiaryEntry): string {
  const d = new Date(entry.created_at)
  const p = inTz(d, entry.timezone, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return `${p.year}-${p.month}-${p.day}-${p.hour}${p.minute}${p.second}.webm`
}

function entryTimeHM(entry: DiaryEntry): string {
  const p = inTz(new Date(entry.created_at), entry.timezone, { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${p.hour}:${p.minute}`
}

function notePathFor(entryDate: string): string {
  const [y, m] = entryDate.split('-')
  return `${VAULT_DIARY}\\${y}\\${m}\\${entryDate}.md`
}

function audioDirFor(entryDate: string): string {
  const [y, m] = entryDate.split('-')
  return `${VAULT_AUDIO}\\${y}\\${m}`
}

// ===== Блок записи (шаблон из плана) =====

function mdTags(tags: string[] | undefined): string {
  return (tags ?? [])
    .filter(Boolean)
    .map((t) => '#' + String(t).trim().replace(/\s+/g, '_'))
    .join(' ')
}

function experimentLine(entry: DiaryEntry): string | null {
  const exp = entry.summary?.experiment
  if (!exp?.has_experiment_update) return null
  const parts: string[] = []
  if (exp.experiment_title) parts.push(exp.experiment_title)
  if (exp.day_number) {
    const target = exp.target_days ? ` из ${exp.target_days}` : ''
    parts.push(`день ${exp.day_number}${target}`)
  }
  if (exp.success_status !== undefined && exp.success_status !== null) {
    parts.push(exp.success_status ? 'соблюдено ✅' : 'не соблюдено ❌')
  }
  let line = parts.join(' — ')
  if (exp.coach_tip) line += ` — Совет коуча: ${exp.coach_tip}`
  return line || null
}

function quoteBlock(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => (l.trim() ? `> ${l}` : '>'))
    .join('\n')
}

function buildEntryBlock(entry: DiaryEntry, audioName: string | null): string {
  const s = entry.summary
  const lines: string[] = []
  lines.push(`### ${entryTimeHM(entry)} — ${s?.title ?? 'Запись'}`)
  if (s?.summary_text) lines.push(`**Выжимка:** ${s.summary_text}`)
  if (s?.key_events?.length) lines.push(`**События:** ${s.key_events.join('; ')}`)
  if (s?.insights?.length) lines.push(`**Инсайты:** ${s.insights.join('; ')}`)
  if (s?.action_items?.length) lines.push(`**Задачи:** ${s.action_items.join('; ')}`)
  if (typeof s?.mood_score === 'number') lines.push(`**Настроение:** ${s.mood_score}/10`)
  const tags = mdTags(s?.tags)
  if (tags) lines.push(`**Теги:** ${tags}`)
  const exp = experimentLine(entry)
  if (exp) lines.push(`**Эксперимент:** ${exp}`)
  lines.push(entry.source === 'voice' ? '**Источник:** голос (транскрибация Gemini)' : '**Источник:** текст')
  if (audioName) lines.push(`**Аудио:** ![[${audioName}]]`)
  lines.push('')
  lines.push('> [!quote] Оригинал (дословно, без изменений)')
  lines.push(quoteBlock(entry.original_text ?? ''))
  lines.push('')
  lines.push('---')
  return lines.join('\n')
}

function newDayNote(entry: DiaryEntry, firstBlock: string): string {
  const [y, m, d] = entry.entry_date.split('-').map(Number)
  const month = RU_MONTHS_GEN[(m ?? 1) - 1] ?? ''
  return [
    '---',
    `date: ${entry.entry_date}`,
    'type: diary',
    'domain: personal',
    'status: active',
    `created: ${entry.entry_date}`,
    `updated: ${entry.entry_date}`,
    'tags: [diary, личное]',
    `aliases: ["Дневник ${entry.entry_date}"]`,
    '---',
    `# Дневник — ${d} ${month} ${y}`,
    '',
    '## Записи',
    '',
    firstBlock,
  ].join('\n')
}

// Обновляет updated во frontmatter, не трогая остальное содержимое файла.
function touchUpdated(contents: string, entryDate: string): string {
  if (/^updated:.*$/m.test(contents)) {
    return contents.replace(/^updated:.*$/m, `updated: ${entryDate}`)
  }
  return contents
}

/** Скачивает аудио из бакета в вольт; возвращает имя файла или null. */
async function saveAudio(entry: DiaryEntry): Promise<string | null> {
  if (entry.source !== 'voice' || !entry.audio_path) return null
  const name = audioFileName(entry)
  const dir = audioDirFor(entry.entry_date)
  const full = `${dir}\\${name}`
  try {
    if (!(await exists(dir))) await mkdir(dir, { recursive: true })
    if (await exists(full)) return name // уже скачано — переиспользуем
    const { data } = await supabase.storage.from('diary-audio').createSignedUrl(entry.audio_path, 600)
    const url = data?.signedUrl
    if (!url) return null
    const res = await fetch(url)
    if (!res.ok) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    await writeFile(full, bytes)
    return name
  } catch (e) {
    console.warn('[vaultSync] аудио не записано:', e)
    return null
  }
}

async function syncSingleEntry(entry: DiaryEntry): Promise<void> {
  if (!entry.summary) return // записи без выжимки в вольт не пишутся (ждут ready)
  const path = notePathFor(entry.entry_date)
  const dir = `${VAULT_DIARY}\\${entry.entry_date.slice(0, 4)}\\${entry.entry_date.slice(5, 7)}`
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })

  const audioName = await saveAudio(entry)
  const block = buildEntryBlock(entry, audioName)

  if (await exists(path)) {
    const current = await readTextFile(path)
    // Дозапись строго в конец файла (конец раздела «## Записи»): всё, что
    // Нурбек дописал вручную, остаётся нетронутым выше.
    const sep = current.endsWith('\n') ? '' : '\n'
    const next = touchUpdated(current + sep + '\n' + block, entry.entry_date)
    await writeTextFile(path, next, { create: true, append: false })
  } else {
    await writeTextFile(path, newDayNote(entry, block), { create: true, append: false })
  }
}

export type VaultSyncResult = { synced: number; failed: number }

/**
 * Пишет в вольт все готовые (ready), ещё не записанные записи. Вызывается
 * на десктопе: при старте экрана дневника, после каждой новой записи,
 * по кнопке «Синхронизировать вольт».
 */
export async function syncVault(userId: string): Promise<VaultSyncResult> {
  const result: VaultSyncResult = { synced: 0, failed: 0 }
  if (!isVaultSyncAvailable()) return result

  const { data } = await supabase
    .from('diary_entries')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'ready')
    .is('vault_synced_at', null)
    .order('created_at', { ascending: true })

  for (const raw of data ?? []) {
    const entry = raw as unknown as DiaryEntry
    try {
      await syncSingleEntry(entry)
      const { error } = await supabase
        .from('diary_entries')
        .update({ vault_synced_at: new Date().toISOString() })
        .eq('id', entry.id)
      if (error) throw error
      result.synced++
    } catch (e) {
      // vault_synced_at не трогаем — повтор при следующем триггере.
      console.warn('[vaultSync] запись не синхронизирована:', e)
      result.failed++
    }
  }
  return result
}
