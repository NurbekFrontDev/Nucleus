import { createClient } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { flushOfflineQueue, offlineFetch } from './offlineSync'

// Ключи берутся из файла .env (он не попадает в GitHub)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Не заданы переменные окружения VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Проверь файл .env в корне проекта.',
  )
}

const isNative = Capacitor.isNativePlatform()

// На телефоне (Capacitor) сессию входа храним в нативном хранилище Preferences,
// а не в localStorage WebView: система Android иногда очищает localStorage, и
// из-за этого пользователь неожиданно разлогинивается. В обычном браузере
// оставляем стандартный localStorage (поле storage не задаём).
const nativeStorage = {
  getItem: async (key: string) => {
    const { value } = await Preferences.get({ key })
    return value ?? null
  },
  setItem: async (key: string, value: string) => {
    await Preferences.set({ key, value })
  },
  removeItem: async (key: string) => {
    await Preferences.remove({ key })
  },
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  // Не даём сетевому запросу держать экран загрузки бесконечно при плохой сети.
  db: { timeout: 15_000 },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // В нативном приложении нет URL с токеном, поэтому распознаём сессию из URL
    // только в браузере. PKCE — более безопасный поток для входа через Google.
    detectSessionInUrl: !isNative,
    flowType: 'pkce',
    ...(isNative ? { storage: nativeStorage } : {}),
  },
  // Все REST-запросы получают IndexedDB-кэш и очередь изменений без сети.
  global: { fetch: offlineFetch },
})

// Отправляет накопленные изменения после возврата сети. Токен никогда не лежит
// в IndexedDB: перед каждой синхронизацией берётся свежая сессия Supabase.
export async function syncOfflineChanges(): Promise<number> {
  const { data } = await supabase.auth.getSession()
  const session = data.session
  if (!session) return 0
  return flushOfflineQueue(session.user.id, async () => ({
    apikey: supabaseAnonKey,
    authorization: `Bearer ${session.access_token}`,
  }))
}
