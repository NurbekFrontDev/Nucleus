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

// Windows: определение точной версии Windows (11 или 10) через Client Hints или fallback.
async function windowsVersion(): Promise<string> {
  if (typeof navigator !== 'undefined' && (navigator as any).userAgentData?.getHighEntropyValues) {
    try {
      const hints = await (navigator as any).userAgentData.getHighEntropyValues(['platformVersion'])
      if (hints.platformVersion) {
        const major = parseInt(hints.platformVersion.split('.')[0], 10)
        // В Chromium/Edge/WebView2: platformVersion >= 13 соответствует Windows 11 (build >= 22000)
        if (major >= 13) return 'Windows 11'
        if (major > 0) return 'Windows 10'
      }
    } catch {}
  }
  // Fallback для актуальных установок Windows
  const nt = /Windows NT ([\d.]+)/.exec(navigator.userAgent)
  if (nt && nt[1] === '10.0') return 'Windows 11'
  return nt ? `Windows ${nt[1]}` : 'Windows'
}

const KNOWN_ANDROID_MODELS: Record<string, string> = {
  '23021RAA2Y': 'Redmi Note 12',
  '23021RAA2G': 'Redmi Note 12',
  '23028RN4BG': 'Redmi 12',
  '22101316G': 'Redmi Note 12 Pro',
  '2312DRA50G': 'Redmi Note 13 Pro',
  '23124RA7EO': 'Redmi Note 13',
  '23076RN4BI': 'Redmi 12 5G',
  '2201117TY': 'Redmi Note 11',
  '2201117TG': 'Redmi Note 11',
  'M2101K6G': 'Redmi Note 10 Pro',
  'M2101K7BNY': 'Redmi Note 10S',
  'SM-S918B': 'Galaxy S23 Ultra',
  'SM-S928B': 'Galaxy S24 Ultra',
  'Pixel 8': 'Google Pixel 8',
  'Pixel 7': 'Google Pixel 7',
}

export function formatDeviceName(rawModel: string | null | undefined): string | null {
  if (!rawModel) return null
  const clean = rawModel.trim()
  if (!clean) return null

  // Если модель известна — возвращаем лаконичное «Имя (Код)» или «Имя»,
  // исключая повторные вложения вида «Redmi Note 12 (Redmi Note 12 (23021RAA2Y))».
  for (const [code, name] of Object.entries(KNOWN_ANDROID_MODELS)) {
    if (clean.includes(code)) {
      return name.includes(code) ? name : `${name} (${code})`
    }
  }

  for (const name of Object.values(KNOWN_ANDROID_MODELS)) {
    if (clean.includes(name)) return name
  }

  // Убираем случайные дублированные скобки вида "X (X (Y))" -> "X (Y)"
  let deduped = clean
  while (true) {
    const nested = /^(.*?)\s*\(\1\s*\((.*?)\)\)$/.exec(deduped)
    if (nested) {
      deduped = `${nested[1]} (${nested[2]})`
    } else {
      break
    }
  }

  return deduped
}

// Android: userAgent вида "...Android 14; SM-S918B Build/..." — вытаскиваем модель.
function androidModel(): string {
  const m = /Android [\d.]+; ([^;)]+?)(?: Build|\))/i.exec(navigator.userAgent)
  const raw = m ? m[1].trim() : 'Android'
  return formatDeviceName(raw) || raw
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
    const winVer = platform === 'windows' ? await windowsVersion() : null
    const deviceName =
      platform === 'windows' ? 'PC' : platform === 'android' ? androidModel() : 'Web'
    const osVersion =
      platform === 'windows'
        ? winVer
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
