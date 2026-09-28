// Единый журнал событий приложения (таблица app_logs). Пишется клиентом на
// ПК и на телефоне; читается подвкладкой «Логи» в админ-панели. Любое
// значимое действие — отправка записи, шаги AI-пайплайна, вольт-синк,
// правки, удаления, смена настроек, ошибки — должно логироваться сюда.
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
