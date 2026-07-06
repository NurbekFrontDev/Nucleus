import { isDesktop } from './native'

// Автообновление десктопа (Tauri). Проверяет новую версию на GitHub Releases,
// скачивает и устанавливает, затем перезапускает приложение. В вебе/на телефоне
// (не Tauri) ничего не делает.
export async function checkDesktopUpdate(): Promise<void> {
  if (!isDesktop()) return
  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check()
    if (!update) return
    await update.downloadAndInstall()
    const { relaunch } = await import('@tauri-apps/plugin-process')
    await relaunch()
  } catch {
    // нет обновления, нет сети или dev-режим — не критично
  }
}
