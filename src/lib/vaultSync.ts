// Синхронизация дневника в вечный архив Second Brain (только Desktop/Tauri).
// Формат заметок и алгоритм — план «Дневник — Формат заметок Second Brain»:
//   F:\SecondBrain\personal\Diary\YYYY\MM\YYYY-MM-DD.md (одна заметка = день),
//   выжимка — выше, оригинал — ниже дословно.
// С v0.1.62 аудио в вольт НЕ скачивается: записи ссылаются на Google Drive
// через HTML-embed <audio> (Obsidian играет прямую ссылку без локального
// файла). Легаси-записи до v0.1.62 (аудио в бакете diary-audio) по-прежнему
// скачиваются в personal/Diary/audio/YYYY/MM/ и вставляются как ![[…]].
//
// Блок одной записи начинается скрытым маркером <!-- diary:UUID -->: по нему
// синк идемпотентен — повторная синхронизация не дублирует запись, а редактирование
// и удаление точно находят свой блок. Правки Нурбека вне блоков неприкосновенны:
// мы переставляем/вырезаем только свои блоки, остальной текст файла не трогаем.

import { exists, mkdir, readTextFile, writeTextFile, writeFile, remove } from '@tauri-apps/plugin-fs'
import { supabase } from './supabase'
import { isDesktop } from './native'
import { driveStreamUrl, isDriveAudioPath } from './drive'
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

function buildEntryBlock(entry: DiaryEntry, audioName: string | null, audioUrl: string | null): string {
  const s = entry.summary
  const lines: string[] = []
  lines.push(`<!-- diary:${entry.id} -->`)
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
  if (audioUrl) lines.push(`**Аудио:** <audio controls preload="metadata" src="${audioUrl}"></audio>`)
  else if (audioName) lines.push(`**Аудио:** ![[${audioName}]]`)
  lines.push('')
  lines.push('> [!quote] Оригинал (дословно, без изменений)')
  lines.push(quoteBlock(entry.original_text ?? ''))
  lines.push('')
  lines.push('---')
  return lines.join('\n')
}

// Маркер блока: скрытый HTML-комментарий, Obsidian не рендерит его на холсте.
function markerFor(entryId: string): string {
  return `<!-- diary:${entryId} -->`
}

// ===== Поиск и перестановка блоков внутри заметки =====

/** Индекс начала блока записи (маркера) в тексте заметки, -1 если нет. */
function blockStart(contents: string, entryId: string): number {
  return contents.indexOf(markerFor(entryId))
}

/**
 * Конец блока: позиция сразу после закрывающего '---'. Если маркер следующего
 * блока или конец файла встречаются раньше — обрезаем по ним (защита от
 * повреждённой заметки). Возвращает [start, endExclusive].
 */
function blockRange(contents: string, entryId: string): [number, number] | null {
  const start = blockStart(contents, entryId)
  if (start < 0) return null
  const nextMarker = contents.indexOf('\n<!-- diary:', start + 1)
  const limit = nextMarker < 0 ? contents.length : nextMarker
  const seg = contents.slice(start, limit)
  // Блок заканчивается строкой '---' (одинокой, не таблицей и не frontmatter).
  const m = seg.match(/\n---[ \t]*\r?\n?$/)
  const end = m ? start + m.index! + m[0].length : limit
  return [start, end]
}

/**
 * Fallback-поиск блока для заметок, записанных версиями до v0.1.55 (без
 * маркеров): блок опознаётся по заголовку «### HH:MM — Title».
 */
function legacyBlockRange(contents: string, entry: DiaryEntry): [number, number] | null {
  const time = entryTimeHM(entry)
  const title = entry.summary?.title ?? ''
  const heading = title ? `### ${time} — ${title}` : `### ${time}`
  const idx = contents.indexOf(heading)
  if (idx < 0) return null
  const nextMarker = contents.indexOf('\n<!-- diary:', idx + 1)
  const nextHeading = contents.indexOf('\n### ', idx + 1)
  let limit = contents.length
  for (const pos of [nextMarker, nextHeading]) if (pos >= 0 && pos < limit) limit = pos
  const seg = contents.slice(idx, limit)
  const m = seg.match(/\n---[ \t]*\r?\n?$/)
  const end = m ? idx + m.index! + m[0].length : limit
  return [idx, end]
}

/**
 * Fallback №2 — блок до v0.1.55, у которого после редактирования записи
 * изменился title: точный заголовок уже не совпадает, и раньше это приводило
 * к дозаписи дубля вместо замены (v0.1.56). created_at записи не меняется,
 * поэтому ищем блок по времени «### HH:MM —» без привязки к названию; из
 * кандидатов предпочитаем тот, что содержит оригинальный текст записи.
 */
function legacyTimeBlockRange(contents: string, entry: DiaryEntry): [number, number] | null {
  const time = entryTimeHM(entry)
  const snippet = (entry.original_text ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
  const re = /^### (\d{2}:\d{2}) — .*$/gm
  let first: [number, number] | null = null
  let match: RegExpExecArray | null
  while ((match = re.exec(contents)) !== null) {
    if (match[1] !== time) continue
    const idx = match.index
    const nextMarker = contents.indexOf('\n<!-- diary:', idx + 1)
    const nextHeading = contents.indexOf('\n### ', idx + 1)
    let limit = contents.length
    for (const pos of [nextMarker, nextHeading]) if (pos >= 0 && pos < limit) limit = pos
    const seg = contents.slice(idx, limit)
    const m = seg.match(/\n---[ \t]*\r?\n?$/)
    const end = m ? idx + m.index! + m[0].length : limit
    if (!first) first = [idx, end]
    if (snippet && contents.slice(idx, end).replace(/\s+/g, ' ').includes(snippet)) {
      return [idx, end]
    }
  }
  return first
}

/** Поиск блока записи: маркер → точный заголовок → время заголовка (старые заметки). */
function findBlock(contents: string, entry: DiaryEntry): [number, number] | null {
  return blockRange(contents, entry.id) ?? legacyBlockRange(contents, entry) ?? legacyTimeBlockRange(contents, entry)
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

/** Скачивает аудио из бакета в вольт (только легаси-записи до v0.1.62); имя или null. */
async function saveAudio(entry: DiaryEntry): Promise<string | null> {
  if (entry.source !== 'voice' || !entry.audio_path || isDriveAudioPath(entry.audio_path)) return null
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
  // Новые записи: аудио играет из Google Drive по прямой ссылке (без локальной
  // копии). Легаси: локальный файл в audio/YYYY/MM + ![[…]]-embed.
  const audioUrl =
    !audioName && entry.source === 'voice' && isDriveAudioPath(entry.audio_path)
      ? driveStreamUrl(entry.audio_path)
      : null
  const block = buildEntryBlock(entry, audioName, audioUrl)

  if (await exists(path)) {
    const current = await readTextFile(path)
    const range = findBlock(current, entry)
    if (range) {
      // Запись уже в вольте — заменяем блок целиком (редактирование/ре-выжимка).
      const next = touchUpdated(current.slice(0, range[0]) + block + current.slice(range[1]), entry.entry_date)
      await writeTextFile(path, next, { create: true, append: false })
      return
    }
    // Новый блок дозаписываем в конец: всё, что Нурбек дописал вручную,
    // остаётся нетронутым выше.
    const sep = current.endsWith('\n') ? '' : '\n'
    const next = touchUpdated(current + sep + '\n' + block, entry.entry_date)
    await writeTextFile(path, next, { create: true, append: false })
  } else {
    await writeTextFile(path, newDayNote(entry, block), { create: true, append: false })
  }
}

/**
 * Удаляет блок записи из заметки дня. Если блоков больше не осталось —
 * заметка удаляется целиком (пустой день не нужен). Аудиофайл вольта тоже
 * стираем. Возвращает true, если что-то было изменено.
 */
export async function removeEntryFromVault(entry: DiaryEntry): Promise<boolean> {
  if (!isVaultSyncAvailable()) return false
  const path = notePathFor(entry.entry_date)
  try {
    if (!(await exists(path))) {
      // Заметки нет — возможно, блок писался старой версией без маркера.
      // Просто чистим аудио (если найдём).
      await removeVaultAudio(entry)
      return false
    }
    const current = await readTextFile(path)
    const range = findBlock(current, entry)
    if (!range) {
      // Блока нет в заметке (запись не успела синхронизироваться или заметка
      // была отредактирована вручную). Чистим хотя бы аудио.
      await removeVaultAudio(entry)
      return false
    }
    const next = (current.slice(0, range[0]) + current.slice(range[1])).replace(/\n{3,}/g, '\n\n')
    await removeVaultAudio(entry)
    const hasAnyBlock = /<!-- diary:[0-9a-f-]+ -->/.test(next) || /^### /m.test(next)
    if (!hasAnyBlock && next.trim().length < 400) {
      // Записей не осталось — удаляем пустую заметку целиком.
      await remove(path)
      return true
    }
    await writeTextFile(path, touchUpdated(next, entry.entry_date), { create: true, append: false })
    return true
  } catch (e) {
    console.warn('[vaultSync] удаление блока не удалось:', e)
    return false
  }
}

/** Стирает аудиофайл записи из папки вольта (best-effort; только легаси — Drive-аудио локально не живёт). */
async function removeVaultAudio(entry: DiaryEntry): Promise<void> {
  if (entry.source !== 'voice' || isDriveAudioPath(entry.audio_path)) return
  const name = audioFileName(entry)
  const full = `${audioDirFor(entry.entry_date)}\\${name}`
  try {
    if (await exists(full)) await remove(full)
  } catch {
    // аудио могло не сохраниться — не критично
  }
}

export type VaultSyncResult = { synced: number; failed: number }

/**
 * Пишет в вольт все готовые (ready), ещё не записанные записи. Вызывается
 * на десктопе: при старте экрана дневника, после каждой новой записи,
 * по кнопке «Синхронизировать вольт». Идемпотентна: повторный вызов для
 * уже записанной записи обновляет её блок, а не дублирует.
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
