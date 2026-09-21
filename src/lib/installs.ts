import { Capacitor } from '@capacitor/core'
import { isDesktop } from './native'
import { supabase } from './supabase'
import { APP_VERSION } from './version'

// Админ-панель: список установок приложения на устройствах.
// Единственный аккаунт с доступом к панели (проверяется и на клиенте,
// и в RLS-политике таблицы app_installs на сервере).
export const ADMIN_EMAIL = 'dlaprogrammirovanieidlaameriki@gmail.com'

export function isAdminEmail(email?: string | null): boolean {
  return !!email && email.trim().toLowerCase() === ADMIN_EMAIL
}

// install_id — уникальный идентификатор ЭТОЙ установки на ЭТОМ устройстве.
// Один аккаунт может быть залогинен и на ПК, и на телефоне — это две строки.
const INSTALL_ID_KEY = 'nucleus:installId'

function ensureInstallId(): string {
  try {
    let id = localStorage.getItem(INSTALL_ID_KEY)
    if (!id) {
      id = `inst_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
      localStorage.setItem(INSTALL_ID_KEY, id)
    }
    return id
  } catch {
    return 'inst_unknown'
  }
}

// Windows: userAgent вида "...Windows NT 10.0..." (WebView2/Tauri).
function windowsLabel(): string {
  const nt = /Windows NT ([\d.]+)/.exec(navigator.userAgent)
  return nt ? `Windows ${nt[1] === '10.0' ? '10/11' : nt[1]}` : 'Windows'
}

// Android: userAgent вида "...Android 14; SM-S918B Build/..." — вытаскиваем модель.
function androidModel(): string {
  const m = /Android [\d.]+; ([^;)]+?)(?: Build|\))/i.exec(navigator.userAgent)
  return m ? m[1].trim() : 'Android'
}

function androidVersion(): string {
  const m = /Android ([\d.]+)/.exec(navigator.userAgent)
  return m ? `Android ${m[1]}` : 'Android'
}

export type InstallPlatform = 'windows' | 'android' | 'web'

export function currentPlatform(): InstallPlatform {
  if (isDesktop()) return 'windows'
  if (Capacitor.getPlatform() === 'android') return 'android'
  return 'web'
}

// Отправляет «сердцебиение» установки: при каждом запуске приложения строка
// в app_installs обновляется (last_seen, версия приложения и т.д.).
// Ошибки молча игнорируются: таблица может ещё не существовать, офлайн и т.п.
export async function sendInstallHeartbeat(
  userId: string,
  email?: string | null,
  userName?: string | null,
): Promise<void> {
  try {
    const platform = currentPlatform()
    const deviceName =
      platform === 'windows' ? windowsLabel() : platform === 'android' ? androidModel() : 'Web'
    const osVersion =
      platform === 'windows'
        ? windowsLabel()
        : platform === 'android'
          ? androidVersion()
          : (navigator.userAgent.slice(0, 60) ?? '')

    await supabase.from('app_installs').upsert(
      {
        user_id: userId,
        install_id: ensureInstallId(),
        email: email ?? null,
        user_name: userName ?? null,
        platform,
        device_name: deviceName,
        os_version: osVersion,
        app_version: APP_VERSION,
        last_seen: new Date().toISOString(),
      },
      { onConflict: 'user_id,install_id' },
    )
  } catch {
    // не критично для работы приложения
  }
}
