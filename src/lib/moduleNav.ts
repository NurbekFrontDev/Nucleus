// Память последней подвкладки для каждого модуля (FinLit, Планировщик, Админка).
// При переключении между модулями возвращаемся туда, где пользователь был в этом
// модуле в последний раз. Хранится локально на устройстве (localStorage + Preferences на Android).

import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { type ModuleId, moduleForPath } from './modules'
import { isValidNavPath, canonicalizeNavPath } from './navStorage'

const KEY = (id: ModuleId) => `nucleus:moduleLastPath:${id}`

// In-memory кэш для мгновенного синхронного возврата
const memoryModulePaths: Record<ModuleId, string | null> = {
  finlit: null,
  planner: null,
  admin: null,
}

/** Проверяет, что путь валиден и действительно принадлежит именно данному модулю */
export function isValidPathForModule(id: ModuleId, path: unknown): path is string {
  if (!isValidNavPath(path)) return false
  const canonical = canonicalizeNavPath(path)
  return moduleForPath(canonical).id === id
}

// Предварительная инициализация из localStorage с фильтрацией путей чужих модулей
try {
  for (const id of ['finlit', 'planner', 'admin'] as ModuleId[]) {
    const raw = localStorage.getItem(KEY(id))
    if (isValidPathForModule(id, raw)) {
      memoryModulePaths[id] = canonicalizeNavPath(raw)
    } else if (raw) {
      // Очищаем некорректно сохранившийся путь (например, /admin в ключе planner)
      localStorage.removeItem(KEY(id))
    }
  }
} catch {}

// Если запущено на Android — подтягиваем из нативного Preferences
if (Capacitor.isNativePlatform()) {
  for (const id of ['finlit', 'planner', 'admin'] as ModuleId[]) {
    void Preferences.get({ key: KEY(id) }).then(({ value }) => {
      if (isValidPathForModule(id, value)) {
        memoryModulePaths[id] = canonicalizeNavPath(value)
      } else if (value) {
        void Preferences.remove({ key: KEY(id) }).catch(() => {})
      }
    }).catch(() => {})
  }
}

/** Запомнить текущий путь как последнюю подвкладку модуля. */
export function saveModulePath(id: ModuleId, path: string): void {
  if (!isValidPathForModule(id, path)) return
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

/** Последняя подвкладка модуля; если её нет или она не от этого модуля — возвращаем fallback (домашнюю). */
export function loadModulePath(id: ModuleId, fallback: string): string {
  const inMem = memoryModulePaths[id]
  if (isValidPathForModule(id, inMem)) return inMem

  try {
    const v = localStorage.getItem(KEY(id))
    if (isValidPathForModule(id, v)) {
      const canonical = canonicalizeNavPath(v)
      memoryModulePaths[id] = canonical
      return canonical
    } else if (v) {
      localStorage.removeItem(KEY(id))
    }
  } catch {
    // игнорируем
  }
  return fallback
}

