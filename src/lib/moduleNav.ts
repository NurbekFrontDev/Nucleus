// Память последней подвкладки для каждого модуля (FinLit и Планировщик).
// При переключении между модулями возвращаемся туда, где пользователь был в этом
// модуле в последний раз. Хранится локально в браузере/WebView.

import type { ModuleId } from './modules'

const KEY = (id: ModuleId) => `nucleus:moduleLastPath:${id}`

/** Запомнить текущий путь как последнюю подвкладку модуля. */
export function saveModulePath(id: ModuleId, path: string): void {
  try {
    localStorage.setItem(KEY(id), path)
  } catch {
    // localStorage недоступен — не критично
  }
}

/** Последняя подвкладка модуля; если её нет — возвращаем fallback (домашнюю). */
export function loadModulePath(id: ModuleId, fallback: string): string {
  try {
    const v = localStorage.getItem(KEY(id))
    return v || fallback
  } catch {
    return fallback
  }
}
