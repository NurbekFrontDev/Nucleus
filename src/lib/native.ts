import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import { App as CapacitorApp } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { supabase } from './supabase'

/**
 * Настраивает нативный статус-бар под нашу тёмную тему (чёрный фон,
 * светлые иконки времени/батареи). Ничего не делает в обычном браузере —
 * только внутри нативного Android/iOS приложения (Capacitor).
 */
export async function initStatusBar() {
  if (!Capacitor.isNativePlatform()) return
  try {
    await StatusBar.setStyle({ style: Style.Dark })
    await StatusBar.setBackgroundColor({ color: '#0a0a0a' })
  } catch {
    // Плагин недоступен (старый Android или другое ограничение) — не критично, просто игнорируем.
  }
}

/** Короткий тактильный отклик (вибрация) на важных действиях (отметка дела, стрик и т.п.).
 * Безопасно вызывать и в браузере — там просто ничего не произойдёт.
 */
export async function hapticTap() {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics')
    await Haptics.impact({ style: ImpactStyle.Light })
  } catch {
    // нет плагина или устройство не поддерживает вибрацию — молча игнорируем.
  }
}

// Deep link, на который Supabase возвращает пользователя после входа через Google
// в нативном приложении (должен совпадать с intent-filter в AndroidManifest.xml).
const OAUTH_REDIRECT = 'com.nucleus.app://login-callback'

/**
 * Вход через Google. В браузере — обычный редирект Supabase. В нативном
 * приложении открываем системный браузер и ловим возврат по deep link
 * (см. initNativeAuth ниже), после чего меняем код на полноценную сессию.
 */
export async function signInWithGoogle(): Promise<{ error: string | null }> {
  try {
    if (!Capacitor.isNativePlatform()) {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      })
      return { error: error?.message ?? null }
    }
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: OAUTH_REDIRECT, skipBrowserRedirect: true },
    })
    if (error) return { error: error.message }
    if (data?.url) await Browser.open({ url: data.url })
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Нативные слушатели авторизации (только Android/iOS):
 *  - обновляем токен, пока приложение активно (resume/pause);
 *  - ловим возврат из браузера после входа через Google (deep link) и
 *    меняем полученный код на сессию.
 * Возвращает функцию очистки слушателей.
 */
export function initNativeAuth(): () => void {
  if (!Capacitor.isNativePlatform()) return () => {}
  const handles: Array<{ remove: () => void }> = []

  // Токен обновляем, только пока приложение на переднем плане.
  void supabase.auth.startAutoRefresh()
  void CapacitorApp.addListener('resume', () => {
    void supabase.auth.startAutoRefresh()
  }).then((h) => handles.push(h))
  void CapacitorApp.addListener('pause', () => {
    void supabase.auth.stopAutoRefresh()
  }).then((h) => handles.push(h))

  // Возврат из системного браузера после входа через Google.
  void CapacitorApp.addListener('appUrlOpen', async ({ url }) => {
    // Тап по уведомлению о завершении Помодоро — открываем вкладку Фокус.
    if (url.includes('://focus')) {
      window.dispatchEvent(new CustomEvent('nucleus-open-focus'))
      return
    }
    if (!url.includes('login-callback')) return
    try {
      const parsed = new URL(url)
      const code = parsed.searchParams.get('code')
      if (code) await supabase.auth.exchangeCodeForSession(code)
    } catch {
      // не удалось разобрать ссылку — молча игнорируем
    } finally {
      try {
        await Browser.close()
      } catch {
        // на некоторых устройствах Browser.close бросает — не критично
      }
    }
  }).then((h) => handles.push(h))

  return () => handles.forEach((h) => h.remove())
}

// ===== Десктоп (Tauri) =====
// В Tauri это НЕ Capacitor: окружение определяем по внутреннему объекту Tauri v2.
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

// Системное уведомление на ПК (Tauri). Вне десктопа/при ошибке — тихо игнорируем.
export async function notifyDesktop(title: string, body: string): Promise<void> {
  if (!isDesktop()) return
  try {
    const n = await import('@tauri-apps/plugin-notification')
    let granted = await n.isPermissionGranted()
    if (!granted) granted = (await n.requestPermission()) === 'granted'
    if (granted) n.sendNotification({ title, body })
  } catch {
    // плагин недоступен — не критично
  }
}

// ===== Автозапуск при старте Windows (только десктоп) =====
// Показываем переключатель в настройках только внутри Tauri-приложения.
export async function isAutostartEnabled(): Promise<boolean> {
  if (!isDesktop()) return false
  try {
    const a = await import('@tauri-apps/plugin-autostart')
    return await a.isEnabled()
  } catch {
    return false
  }
}

export async function setAutostart(enabled: boolean): Promise<boolean> {
  if (!isDesktop()) return false
  try {
    const a = await import('@tauri-apps/plugin-autostart')
    if (enabled) await a.enable()
    else await a.disable()
    return true
  } catch {
    return false
  }
}
