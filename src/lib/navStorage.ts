import { Capacitor } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import { Preferences } from '@capacitor/preferences'

export const LAST_PATH_KEY = 'nucleus:lastPath'
export const LAST_PATH_TIME_KEY = 'nucleus:lastPathTime'

// Список известных путей приложения для строгой валидации
const VALID_EXACT_ROUTES = new Set([
  '/',
  '/incomes',
  '/expenses',
  '/budget',
  '/goals',
  '/investments',
  '/charity',
  '/history',
  '/settings',
  '/planner',
  '/planner/items',
  '/planner/matrix',
  '/planner/water',
  '/planner/focus',
  '/planner/stats',
  '/planner/settings',
])

// Перенаправления-алиасы: приводим к каноническому адресу
const ROUTE_ALIASES: Record<string, string> = {
  '/debts': '/expenses',
  '/planner/habits': '/planner/items',
  '/planner/calendar': '/planner',
}

/**
 * Проверяет, является ли путь допустимым маршрутом внутри приложения.
 * Запрещает: пустые строки, /login, /index.html, ссылки авторизации OAuth.
 */
export function isValidNavPath(path: unknown): path is string {
  if (typeof path !== 'string') return false
  const clean = path.trim()
  if (!clean || !clean.startsWith('/')) return false
  if (clean === '/login' || clean === '/index.html') return false
  if (clean.includes('login-callback') || clean.includes('code=')) return false
  return VALID_EXACT_ROUTES.has(clean) || Object.prototype.hasOwnProperty.call(ROUTE_ALIASES, clean)
}

/**
 * Нормализует маршрут: убирает алиасы и query-мусор.
 */
export function canonicalizeNavPath(path: string): string {
  const clean = path.split('?')[0].split('#')[0].trim()
  if (ROUTE_ALIASES[clean]) {
    return ROUTE_ALIASES[clean]
  }
  return clean
}

// Быстрый синхронный in-memory кэш
let inMemoryPath: string | null = null

try {
  const initial = localStorage.getItem(LAST_PATH_KEY)
  if (isValidNavPath(initial)) {
    inMemoryPath = canonicalizeNavPath(initial)
  }
} catch {
  // localStorage недоступен на этапе загрузки модуля
}

/**
 * Синхронно возвращает сохранённый последний путь устройства.
 * Используется при старте ДО первой отрисовки (useLayoutEffect / useState),
 * чтобы мгновенно и без мигания Дашбордом открыть нужную вкладку.
 */
export function getLastNavPath(defaultPath = '/planner'): string {
  if (inMemoryPath && isValidNavPath(inMemoryPath)) {
    return inMemoryPath
  }
  try {
    const raw = localStorage.getItem(LAST_PATH_KEY)
    if (isValidNavPath(raw)) {
      const canonical = canonicalizeNavPath(raw)
      inMemoryPath = canonical
      return canonical
    }
  } catch {
    // игнорируем ошибки доступа к localStorage
  }
  return defaultPath
}

/**
 * Асинхронно считывает последний путь из нативного хранилища Android (SharedPreferences).
 * На Android это защищает от потери пути при агрессивной выгрузке WebView системой.
 */
export async function loadLastNavPathAsync(defaultPath = '/planner'): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { value } = await Preferences.get({ key: LAST_PATH_KEY })
      if (isValidNavPath(value)) {
        const canonical = canonicalizeNavPath(value)
        inMemoryPath = canonical
        try {
          localStorage.setItem(LAST_PATH_KEY, canonical)
        } catch {}
        return canonical
      }
    } catch (e) {
      console.warn('[navStorage] ошибка чтения Preferences:', e)
    }
  }
  return getLastNavPath(defaultPath)
}

/**
 * Мгновенно сохраняет текущий маршрут локально на текущем устройстве:
 * 1. В in-memory переменную.
 * 2. Синхронно в localStorage.
 * 3. Асинхронно в нативный Android SharedPreferences (@capacitor/preferences).
 *
 * ВАЖНО: Маршрут сохраняется СТРОГО ЛОКАЛЬНО на конкретном устройстве.
 * Он не синхронизируется через облако Supabase, чтобы телефон и ПК
 * никогда не сбивали открытые вкладки друг друга!
 */
export function saveLastNavPath(path: string): void {
  if (!isValidNavPath(path)) return
  const canonical = canonicalizeNavPath(path)

  inMemoryPath = canonical

  try {
    localStorage.setItem(LAST_PATH_KEY, canonical)
    localStorage.setItem(LAST_PATH_TIME_KEY, Date.now().toString())
  } catch {
    // localStorage переполнен или заблокирован
  }

  if (Capacitor.isNativePlatform()) {
    void Preferences.set({ key: LAST_PATH_KEY, value: canonical }).catch((e) => {
      console.warn('[navStorage] ошибка записи Preferences:', e)
    })
    void Preferences.set({ key: LAST_PATH_TIME_KEY, value: Date.now().toString() }).catch(() => {})
  }
}

/**
 * Инициализирует глобальные слушатели жизненного цикла устройства,
 * гарантирующие сохранение пути при любых сценариях выхода/сворачивания:
 *  - Свайп приложения (жест Home / Recents)
 *  - Сворачивание приложения (кнопка Домой)
 *  - Блокировка экрана
 *  - Переключение на другое приложение
 *  - Закрытие/выгрузка страницы (beforeunload / pagehide)
 *  - Аппаратная кнопка "Назад" на Android
 */
export function initNavLifecycle(getCurrentPath: () => string): () => void {
  const saveCurrent = () => {
    try {
      const p = getCurrentPath()
      if (isValidNavPath(p)) {
        saveLastNavPath(p)
      }
    } catch {}
  }

  // 1. Смена видимости (сворачивание, переключение, выключение экрана)
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      saveCurrent()
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange)

  // 2. Закрытие / выгрузка документа (десктоп, веб, WebView unload)
  window.addEventListener('pagehide', saveCurrent)
  window.addEventListener('beforeunload', saveCurrent)

  // 3. Нативные события Capacitor (Android / iOS)
  const nativeHandles: Array<{ remove: () => void }> = []
  if (Capacitor.isNativePlatform()) {
    CapacitorApp.addListener('pause', () => {
      saveCurrent()
    }).then((h) => nativeHandles.push(h)).catch(() => {})
  }

  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pagehide', saveCurrent)
    window.removeEventListener('beforeunload', saveCurrent)
    nativeHandles.forEach((h) => h.remove())
  }
}
