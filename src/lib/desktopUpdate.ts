import { isDesktop } from './native'
import type { Update } from '@tauri-apps/plugin-updater'

// ===== Автообновление десктопа (Tauri, Windows) =====
// Раньше обновление ставилось молча и сразу. Теперь схема такая:
//   1. при запуске проверяем latest.json в Supabase Storage;
//   2. если версия новее — НЕ ставим сразу, а показываем окно UpdateDialog
//      с текущей и новой версией;
//   3. пользователь жмёт «Обновить» — качаем, ставим и перезапускаем;
//   4. пользователь жмёт «Напомнить позже» или крестик — окно закрывается,
//      но обновление остаётся в памяти и напомнит при следующем запуске
//      (а также через RECHECK_MS, если приложение не закрывают сутками).
// В вебе и на телефоне всё это — no-op (там свои механизмы: OTA/APK).

export type UpdateInfo = {
  /** Установленная сейчас версия, например 0.1.14 */
  current: string
  /** Версия, доступная к установке, например 0.1.15 */
  version: string
  /** Описание обновления из поля notes в latest.json */
  notes: string
}

/** Событие, по которому UpdateDialog показывает себя. */
export const UPDATE_EVENT = 'nucleus-update-available'

/** Как часто перепроверять обновление, если приложение не закрывают (3 часа). */
const RECHECK_MS = 3 * 60 * 60 * 1000

// Найденное обновление держим в памяти модуля: окно закрывается и открывается,
// а объект обновления должен пережить это, иначе пришлось бы качать заново.
let pending: { info: UpdateInfo; update: Update } | null = null
let timer: ReturnType<typeof setInterval> | undefined

/** Уже найденное обновление (нужно, чтобы окно могло восстановиться после перерисовки). */
export function getPendingUpdate(): UpdateInfo | null {
  return pending?.info ?? null
}

/**
 * Проверяет наличие обновления. Ничего не устанавливает: только запоминает
 * обновление и шлёт событие UPDATE_EVENT, на которое реагирует UpdateDialog.
 */
export async function checkDesktopUpdate(): Promise<UpdateInfo | null> {
  if (!isDesktop()) return null
  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check()
    if (!update) return null
    const info: UpdateInfo = {
      current: update.currentVersion,
      version: update.version,
      notes: (update.body ?? '').trim(),
    }
    pending = { info, update }
    window.dispatchEvent(new CustomEvent<UpdateInfo>(UPDATE_EVENT, { detail: info }))
    return info
  } catch {
    // нет сети, нет обновления или dev-режим — не критично
    return null
  }
}

/**
 * Запускает периодическую проверку обновлений (первая — сразу при старте).
 * Возвращает функцию очистки для useEffect.
 */
export function initDesktopUpdates(): () => void {
  if (!isDesktop()) return () => {}
  void checkDesktopUpdate()
  timer = setInterval(() => {
    // Если обновление уже найдено и пользователь его отложил — повторно не ищем.
    if (pending) return
    void checkDesktopUpdate()
  }, RECHECK_MS)
  return () => {
    if (timer) clearInterval(timer)
    timer = undefined
  }
}

/**
 * Скачивает и устанавливает найденное обновление, затем перезапускает приложение.
 * onProgress получает процент загрузки (0..100), чтобы окно показывало прогресс.
 * Возвращает текст ошибки или null при успехе (при успехе приложение
 * перезапустится и код дальше не выполнится).
 */
export async function installDesktopUpdate(
  onProgress?: (percent: number) => void,
): Promise<string | null> {
  if (!pending) return 'no-update'
  try {
    let total = 0
    let loaded = 0
    await pending.update.downloadAndInstall((event) => {
      if (event.event === 'Started') {
        total = event.data.contentLength ?? 0
        onProgress?.(0)
      } else if (event.event === 'Progress') {
        loaded += event.data.chunkLength
        // Если сервер не отдал размер файла — показываем неопределённый прогресс.
        if (total > 0) onProgress?.(Math.min(100, Math.round((loaded / total) * 100)))
      } else if (event.event === 'Finished') {
        onProgress?.(100)
      }
    })
    const { relaunch } = await import('@tauri-apps/plugin-process')
    await relaunch()
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}
