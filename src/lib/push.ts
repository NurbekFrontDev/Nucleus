import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { supabase } from './supabase'
// import { showToast } from './toast' // временно отключено: всплывающие подсказки пуша убраны по просьбе пользователя

let inited = false

/**
 * Push-уведомления (FCM) — этап А-7. Работает только в нативном приложении.
 * Запрашивает разрешение, регистрирует устройство в FCM и сохраняет токен в Supabase
 * (таблица push_tokens), чтобы сервер мог присылать пуши этому пользователю.
 * Безопасно вызывать в браузере и до установки пакета — просто ничего не делает.
 */
export async function initPush(userId: string): Promise<void> {
  if (!Capacitor.isNativePlatform() || inited) return
  inited = true
  try {
    const perm = await PushNotifications.requestPermissions()
    if (perm.receive !== 'granted') {
      console.warn('[push] нет разрешения на уведомления:', perm.receive)
      return
    }

    await PushNotifications.addListener('registration', (token: { value: string }) => {
      void supabase
        .from('push_tokens')
        .upsert(
          {
            user_id: userId,
            token: token.value,
            platform: Capacitor.getPlatform(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'token' },
        )
        .then(({ error }: { error: { message: string } | null }) => {
          if (error) {
            console.warn('[push] не удалось сохранить токен:', error.message)
          } else {
            console.log('[push] токен зарегистрирован')
          }
        })
    })

    await PushNotifications.addListener('registrationError', (err: unknown) => {
      console.warn('[push] ошибка регистрации:', err)
    })

    await PushNotifications.register()

    // Уведомление пришло, пока приложение открыто.
    await PushNotifications.addListener('pushNotificationReceived', (notif: unknown) => {
      console.log('[push] получено уведомление:', notif)
    })

    // Пользователь нажал на пуш — если в data есть route, переходим на экран
    // (App.tsx слушает событие nucleus-push-open и вызывает navigate).
    await PushNotifications.addListener(
      'pushNotificationActionPerformed',
      (action: { notification?: { data?: Record<string, string> } }) => {
        const route = action?.notification?.data?.route
        if (route) {
          window.dispatchEvent(new CustomEvent('nucleus-push-open', { detail: { route } }))
        }
      },
    )
  } catch (e) {
    console.warn('[push] инициализация не удалась (возможно, пакет ещё не установлен):', e)
  }
}
