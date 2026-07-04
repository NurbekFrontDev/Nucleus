import { Capacitor } from '@capacitor/core'
import { supabase } from './supabase'
import { loadDay, todayStr } from './planner'

// ===== Локальные уведомления (А-6) =====
// Планируем уведомления на устройстве через @capacitor/local-notifications:
//  - дела/привычки на сегодня, у которых задано время начала (at_time_start);
//    напоминаем в это время или за N минут до (пользователь выбирает N);
//  - вода: каждые N часов в выбранном окне (с какого по какое время).
// На вебе (Capacitor.isNativePlatform() === false) всё превращается в no-op.
// Пересобираем расписание при запуске и после изменения настроек (rescheduleAll).

export type NotifSettings = {
  tasksEnabled: boolean
  tasksOffsetMin: number
  waterEnabled: boolean
  waterEveryHours: number
  waterFrom: string // 'HH:MM' (24ч)
  waterTo: string // 'HH:MM' (24ч)
}

export const NOTIF_DEFAULTS: NotifSettings = {
  tasksEnabled: false,
  tasksOffsetMin: 0,
  waterEnabled: false,
  waterEveryHours: 2,
  waterFrom: '09:00',
  waterTo: '21:00',
}

// Варианты «за сколько напомнить» до времени дела (минуты). 0 = точно в срок.
export const OFFSET_OPTIONS = [0, 5, 10, 15, 30]

// Варианты периодичности воды (часы). 1.5 = каждые полтора часа.
export const WATER_EVERY_OPTIONS = [1, 1.5, 2, 3, 4]

export async function loadNotifSettings(userId: string): Promise<NotifSettings> {
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select(
        'notif_tasks_enabled, notif_tasks_offset_min, notif_water_enabled, notif_water_every_hours, notif_water_from, notif_water_to',
      )
      .eq('user_id', userId)
      .maybeSingle()
    if (error || !data) return { ...NOTIF_DEFAULTS }
    const r = data as Record<string, unknown>
    return {
      tasksEnabled: !!r.notif_tasks_enabled,
      tasksOffsetMin: Number(r.notif_tasks_offset_min) || 0,
      waterEnabled: !!r.notif_water_enabled,
      waterEveryHours:
        Number(r.notif_water_every_hours) > 0 ? Number(r.notif_water_every_hours) : 2,
      waterFrom: typeof r.notif_water_from === 'string' ? r.notif_water_from : '09:00',
      waterTo: typeof r.notif_water_to === 'string' ? r.notif_water_to : '21:00',
    }
  } catch {
    return { ...NOTIF_DEFAULTS }
  }
}

export async function saveNotifSettings(userId: string, s: NotifSettings): Promise<void> {
  await supabase.from('app_settings').upsert(
    {
      user_id: userId,
      notif_tasks_enabled: s.tasksEnabled,
      notif_tasks_offset_min: s.tasksOffsetMin,
      notif_water_enabled: s.waterEnabled,
      notif_water_every_hours: s.waterEveryHours,
      notif_water_from: s.waterFrom,
      notif_water_to: s.waterTo,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )
}

// Диапазоны id: дела 100000+, вода 200000+. Так мы отличаем «наши» уведомления
// от чужих и снимаем только их при пересборке расписания.
const TASK_ID_BASE = 100000
const WATER_ID_BASE = 200000

// Канал напоминаний с нашим звуком (без вибрации — вибрация только у Помодоро).
// Звук — файл res/raw/notify_sound.wav (генерируется scripts/gen-notify-sound.mjs).
const REMINDER_CHANNEL_ID = 'reminders'
const REMINDER_SOUND = 'notify_sound.wav'

async function ensureReminderChannel(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await LocalNotifications.createChannel({
      id: REMINDER_CHANNEL_ID,
      name: 'Напоминания',
      description: 'Напоминания о делах и воде',
      importance: 5,
      sound: REMINDER_SOUND,
      vibration: false,
      visibility: 1,
    })
  } catch {
    // канал не создан — не критично, уведомления придут на канале по умолчанию
  }
}

// 'HH:MM' -> Date на сегодня. null при неверном формате.
function timeToday(hhmm: string): Date | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? '').trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  const d = new Date()
  d.setHours(h, min, 0, 0)
  return d
}

// Спрашивает разрешение на уведомления (Android 13+ требует POST_NOTIFICATIONS).
export async function ensurePermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const perm = await LocalNotifications.checkPermissions()
    if (perm.display === 'granted') return true
    const req = await LocalNotifications.requestPermissions()
    return req.display === 'granted'
  } catch {
    return false
  }
}

// Инициализация при запуске приложения: разрешение + расписание на сегодня.
export async function initNotifications(userId: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  const ok = await ensurePermission()
  if (!ok) return
  await rescheduleAll(userId)
}

// Пересобирает все локальные уведомления (дела + вода) на сегодня.
// Вызывать при старте и после сохранения настроек уведомлений.
export async function rescheduleAll(userId: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const perm = await LocalNotifications.checkPermissions()
    if (perm.display !== 'granted') return

    await ensureReminderChannel()

    // Снимаем ранее запланированные наши уведомления (id из наших диапазонов).
    const pending = await LocalNotifications.getPending()
    const toCancel = pending.notifications.filter((n) => n.id >= TASK_ID_BASE)
    if (toCancel.length) {
      await LocalNotifications.cancel({ notifications: toCancel.map((n) => ({ id: n.id })) })
    }

    const settings = await loadNotifSettings(userId)
    const now = Date.now()
    const notifications: Array<Record<string, unknown>> = []

    // Дела и привычки на сегодня со временем начала.
    if (settings.tasksEnabled) {
      try {
        const day = await loadDay(userId, todayStr())
        let i = 0
        for (const it of day.items) {
          if (!it.at_time_start) continue
          const base = timeToday(it.at_time_start)
          if (!base) continue
          const at = new Date(base.getTime() - settings.tasksOffsetMin * 60000)
          if (at.getTime() <= now) continue
          notifications.push({
            id: TASK_ID_BASE + i,
            title: it.icon ? `${it.icon} ${it.title}` : it.title,
            body:
              settings.tasksOffsetMin > 0
                ? `Через ${settings.tasksOffsetMin} мин`
                : 'Пора начинать',
            schedule: { at, allowWhileIdle: true },
            channelId: REMINDER_CHANNEL_ID,
            sound: REMINDER_SOUND,
            extra: { kind: 'task', path: '/planner' },
          })
          i++
          if (i >= 60) break
        }
      } catch {
        // список дел не критичен для остальных уведомлений
      }
    }

    // Вода: каждые N часов в окне from..to.
    if (settings.waterEnabled) {
      const from = timeToday(settings.waterFrom)
      const to = timeToday(settings.waterTo)
      if (from && to && settings.waterEveryHours > 0 && to.getTime() >= from.getTime()) {
        const stepMs = settings.waterEveryHours * 3600000
        let i = 0
        for (let t = from.getTime(); t <= to.getTime(); t += stepMs) {
          if (t > now) {
            notifications.push({
              id: WATER_ID_BASE + i,
              title: '💧 Время попить воды',
              body: 'Выпей воды и занеси в приложение',
              schedule: { at: new Date(t), allowWhileIdle: true },
              channelId: REMINDER_CHANNEL_ID,
              sound: REMINDER_SOUND,
              extra: { kind: 'water', path: '/planner/water' },
            })
          }
          i++
          if (i >= 40) break
        }
      }
    }

    if (notifications.length) {
      await LocalNotifications.schedule({ notifications: notifications as never })
    }
  } catch {
    // уведомления не критичны для работы приложения — тихо игнорируем
  }
}
