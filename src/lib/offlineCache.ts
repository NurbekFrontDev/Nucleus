// Простой кэш «показать мгновенно, обновить в фоне» (stale-while-revalidate)
// на localStorage. Экраны сохраняют сюда загруженные данные и при следующем
// открытии показывают их сразу — без спиннера и без интернета, а сеть
// догружает свежие в фоне. Ключи обычно включают id пользователя
// и параметры экрана (месяц/дата и т. п.).

const PREFIX = 'nucleus:cache:'

// Читает значение из кэша (или null, если нет/битый JSON).
export function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

// Сохраняет значение в кэш (тихо игнорирует ошибки хранилища).
export function writeCache<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // localStorage недоступен/переполнен — не критично
  }
}
