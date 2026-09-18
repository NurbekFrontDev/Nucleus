// Память последней подвкладки для каждого модуля (FinLit и Планировщик).
// При переключении между модулями возвращаемся туда, где пользователь был в этом
// модуле в последний раз. Хранится локально на устройстве (localStorage + Preferences на Android).

import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import type { ModuleId } from './modules'
import { isValidNavPath, canonicalizeNavPath } from './navStorage'

const KEY = (id: ModuleId) => `nucleus:moduleLastPath:${id}`

// In-memory кэш для мгновенного синхронного возврата
const memoryModulePaths: Record<ModuleId, string | null> = {
  finlit: null,
  planner: null,
}

// Предварительная инициализация из localStorage
try {
  const f = localStorage.getItem(KEY('finlit'))
  if (isValidNavPath(f)) memoryModulePaths.finlit = canonicalizeNavPath(f)
  const p = localStorage.getItem(KEY('planner'))
  if (isValidNavPath(p)) memoryModulePaths.planner = canonicalizeNavPath(p)
} catch {}

// Если запущено на Android — подтягиваем из нативного Preferences
if (Capacitor.isNativePlatform()) {
  void Preferences.get({ key: KEY('finlit') }).then(({ value }) => {
    if (isValidNavPath(value)) memoryModulePaths.finlit = canonicalizeNavPath(value)
  })
  void Preferences.get({ key: KEY('planner') }).then(({ value }) => {
    if (isValidNavPath(value)) memoryModulePaths.planner = canonicalizeNavPath(value)
  })
}

/** Запомнить текущий путь как последнюю подвкладку модуля. */
export function saveModulePath(id: ModuleId, path: string): void {
  if (!isValidNavPath(path)) return
  const canonical = canonicalizeNavPath(path)
  memoryModulePaths[id] = canonical

  try {
    localStorage.setItem(KEY(id), canonical)
  } catch {
    // localStorage недоступен — не критично
  }

  if (Capacitor.isNativePlatform()) {
    void Preferences.set({ key: KEY(id), value: canonical }).catch(() => {})
  }
}

/** Последняя подвкладка модуля; если её нет — возвращаем fallback (домашнюю). */
export function loadModulePath(id: ModuleId, fallback: string): string {
  const inMem = memoryModulePaths[id]
  if (inMem && isValidNavPath(inMem)) return inMem

  try {
    const v = localStorage.getItem(KEY(id))
    if (isValidNavPath(v)) {
      const canonical = canonicalizeNavPath(v)
      memoryModulePaths[id] = canonical
      return canonical
    }
  } catch {
    // игнорируем
  }
  return fallback
}
