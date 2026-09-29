// Единый журнал событий приложения. Двойная запись:
//  1) таблица app_logs (Supabase) — пишется клиентом на ПК и на телефоне,
//     читается экраном «Логи» (/admin/logs);
//  2) на десктопе — дневной файл logs/YYYY-MM-DD.log в корне проекта
//     (один файл на каждый день, ничего не удаляется — полная локальная
//     история даже без сети).
//
// Ограничения: логи НЕ заменяют консоль разработчика — это пользовательский
// аудит «что происходило в приложении». Поэтому пишем короткие человекочитаемые
// сообщения и только то, что реально полезно видеть.

import { supabase } from './supabase'
import { Capacitor } from '@capacitor/core'
import { isDesktop } from './native'

export type LogLevel = 'info' | 'warn' | 'error'
export type LogScope = 'auth' | 'diary' | 'vault' | 'planner' | 'settings' | 'app'

function currentPlatform(): string {
  if (isDesktop()) return 'windows'
  if (Capacitor.isNativePlatform()) return 'android'
  return 'web'
}

// ===== Локальные дневные файлы (только десктоп) =====
// logs/YYYY-MM-DD.log в корне проекта: один файл на день, файлы НИКОГДА
// не чистятся и не ротируются — полная история остаётся на диске. Это дубль
// журнала app_logs (Supabase), независимый от сети и от ретеншена базы.
const LOGS_DIR = 'F:\\Apps\\Nucleus\\logs'

let fileDay = '' // день, для которого папка уже создана/проверена
let fileChain: Promise<void> = Promise.resolve() // сериализуем дозапись

function localDayStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function clockStr(d: Date): string {
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':')
}

/** Дописывает строку в дневной файл; ошибки глотаются (лог не роняет приложение). */
function appendToDailyFile(line: string): void {
  if (!isDesktop()) return
  fileChain = fileChain.then(async () => {
    try {
      const day = localDayStr(new Date())
      const fs = await import('@tauri-apps/plugin-fs')
      if (fileDay !== day) {
        await fs.mkdir(LOGS_DIR, { recursive: true }).catch(() => {})
        fileDay = day
      }
      await fs.writeTextFile(`${LOGS_DIR}\\${day}.log`, line, { append: true, create: true })
    } catch {
      // нет доступа к диску — остаётся только журналирование в Supabase
    }
  })
}

// Слегка ограничиваем «инфу», чтобы лог не тонул в шуме повтора одних и тех же
// событий (например, автосинк каждые пару секунд).
const recentMessages = new Map<string, number>()
const DEDUPE_MS = 3000

/**
 * Записывает событие в журнал. Никогда не бросает и не блокирует вызывающий
 * код: логирование — фоновая задача, ошибка записи не должна ломать функцию.
 */
export function logEvent(
  level: LogLevel,
  scope: LogScope,
  message: string,
  meta: Record<string, unknown> = {},
  userId?: string,
): void {
  if (!message) return
  try {
    // Дедупликация одинаковых сообщений в пределах 3 секунд.
    const key = `${scope}:${level}:${message}`
    const now = Date.now()
    const last = recentMessages.get(key)
    if (last !== undefined && now - last < DEDUPE_MS) return
    recentMessages.set(key, now)
    if (recentMessages.size > 200) recentMessages.clear()

    const row = {
      level,
      scope,
      message: message.slice(0, 500),
      meta,
      platform: currentPlatform(),
      ...(userId ? { user_id: userId } : {}),
    }
    // fire-and-forget: результат логирования никого не волнует
    void supabase.from('app_logs').insert(row).then(undefined, () => {})

    // И в дневной файл на диске: [ЧЧ:ММ:СС] [LEVEL] [scope] сообщение | {meta}
    const metaStr = Object.keys(meta).length > 0 ? ` | ${JSON.stringify(meta)}` : ''
    appendToDailyFile(
      `[${clockStr(new Date())}] [${level}] [${scope}] ${message.slice(0, 500)}${metaStr}\n`,
    )
  } catch {
    // даже сериализация упала — молча, логи не должны ронять приложение
  }
}

/** Удобные обёртки. uid передаём, когда он уже известен — иначе колонка будет
 * заполнена RLS-контекстом только при наличии user_id (он обязателен в схеме,
 * поэтому в местах без сессии лог пропустится безопасно). */
export const log = {
  info: (scope: LogScope, message: string, meta?: Record<string, unknown>, uid?: string) =>
    logEvent('info', scope, message, meta ?? {}, uid),
  warn: (scope: LogScope, message: string, meta?: Record<string, unknown>, uid?: string) =>
    logEvent('warn', scope, message, meta ?? {}, uid),
  error: (scope: LogScope, message: string, meta?: Record<string, unknown>, uid?: string) =>
    logEvent('error', scope, message, meta ?? {}, uid),
}
