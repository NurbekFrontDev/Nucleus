import { Capacitor } from '@capacitor/core'

// Бесплатные обновления «по воздуху» (OTA) через Supabase Storage.
//
// Плагин @capgo/capacitor-updater используется в SELF-HOSTED режиме: мы сами
// раздаём архив web-сборки (папка dist) из публичного бакета Supabase, без
// платного облака Capgo. Так обновления бесплатны и живут на нашей же
// инфраструктуре.
//
// ВАЖНО, что можно катить по воздуху, а что нет:
//  - OTA (без пересборки APK): любой web-код — React, логика, стили, тексты,
//    новые экраны и фичи, фиксы багов в интерфейсе.
//  - Требует новой сборки APK: новые нативные плагины Capacitor, изменения в
//    android/, permissions, иконка/сплэш, версия SDK, google-services.json.
//
// Как выкатывать обновление (кратко, делается вручную на компьютере):
//  1) npm run build  — собирает свежий dist
//  2) заархивировать содержимое dist в zip (например nucleus-1.0.1.zip)
//  3) загрузить zip в публичный бакет Supabase Storage "ota"
//  4) обновить ota/latest.json: { "version": "1.0.1", "url": "<публичный URL zip>" }
// При следующем запуске приложение само подтянет новую версию.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string

// Публичный манифест последней версии.
// Формат: { "version": "1.0.1", "url": "https://<ref>.supabase.co/storage/v1/object/public/ota/nucleus-1.0.1.zip" }
const LATEST_URL = `${SUPABASE_URL}/storage/v1/object/public/ota/latest.json`

type LatestManifest = { version?: string; url?: string }

// Точка входа: вызывается один раз при старте приложения (только на телефоне).
// 1) сообщает плагину, что запуск успешен (иначе он откатит обновление —
//    защита от нерабочей версии);
// 2) в фоне проверяет наличие новой версии и готовит её к следующему запуску.
export async function initOta(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { CapacitorUpdater } = await import('@capgo/capacitor-updater')
    // Обязательный вызов: подтверждаем, что текущая сборка рабочая.
    await CapacitorUpdater.notifyAppReady()
    await checkForUpdate(CapacitorUpdater)
  } catch (e) {
    // OTA не критичен для работы приложения — тихо игнорируем сбои (например,
    // офлайн или манифест ещё не залит).
    console.warn('[ota] инициализация пропущена:', e)
  }
}

async function checkForUpdate(
  updater: typeof import('@capgo/capacitor-updater')['CapacitorUpdater'],
): Promise<void> {
  try {
    const res = await fetch(LATEST_URL, { cache: 'no-store' })
    if (!res.ok) return
    const latest = (await res.json()) as LatestManifest
    if (!latest.version || !latest.url) return

    const current = await updater.current()
    // Уже на актуальной версии — ничего не делаем.
    if (latest.version === current.bundle.version) return

    // Скачиваем новый бандл в фоне и назначаем его на СЛЕДУЮЩИЙ запуск, чтобы не
    // прерывать текущую сессию пользователя. При следующем открытии приложение
    // стартует уже на новой версии.
    const bundle = await updater.download({
      url: latest.url,
      version: latest.version,
    })
    await updater.next({ id: bundle.id })
  } catch (e) {
    console.warn('[ota] проверка обновления пропущена:', e)
  }
}
