import { useEffect, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useLang } from '../lib/i18n'
import { loadDaySections, saveDaySections } from '../lib/planner'
import Select from '../components/Select'
import {
  loadNotifSettings,
  saveNotifSettings,
  rescheduleAll,
  NOTIF_DEFAULTS,
  OFFSET_OPTIONS,
  type NotifSettings,
} from '../lib/notifications'
import {
  batteryAvailable,
  batteryIsIgnoring,
  batteryRequestIgnore,
  openAutoStartSettings,
  openAppDetailsSettings,
} from '../lib/battery'

// Экран «Настройки» планировщика (П-10): настройки, относящиеся
//   именно к планировщику. Пока здесь переключатель деления дня на
//   Утро/День/Вечер (перенесён сюда из общих настроек FinLit).

const cardCls =
  'rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/50'

export default function PlannerSettings() {
  const { user } = useAuth()
  const { t, lang } = useLang()

  const [daySections, setDaySections] = useState(false)
  const [ready, setReady] = useState(false)

  const [notif, setNotif] = useState<NotifSettings>(NOTIF_DEFAULTS)
  const [notifReady, setNotifReady] = useState(false)

  // Энергосбережение (А-8): статус исключения из оптимизации батареи.
  const [batteryReady, setBatteryReady] = useState(false)
  const [batteryIgnoring, setBatteryIgnoring] = useState(false)

  useEffect(() => {
    if (!user) return
    let active = true
    ;(async () => {
      try {
        const sections = await loadDaySections(user.id)
        if (active) setDaySections(sections)
      } catch {
        // оставляем выключенным
      } finally {
        if (active) setReady(true)
      }
    })()
    return () => {
      active = false
    }
  }, [user])

  useEffect(() => {
    if (!user) return
    let active = true
    ;(async () => {
      try {
        const s = await loadNotifSettings(user.id)
        if (active) setNotif(s)
      } catch {
        // оставляем значения по умолчанию
      } finally {
        if (active) setNotifReady(true)
      }
    })()
    return () => {
      active = false
    }
  }, [user])

  // Проверяем статус исключения из энергосбережения.
  const refreshBattery = async () => {
    if (!batteryAvailable()) return
    try {
      const ok = await batteryIsIgnoring()
      setBatteryIgnoring(ok)
    } finally {
      setBatteryReady(true)
    }
  }

  const handleBatteryRequest = async () => {
    await batteryRequestIgnore()
    // Пользователь вернётся из системного диалога — обновим статус чуть позже.
    setTimeout(() => void refreshBattery(), 800)
  }

  useEffect(() => {
    void refreshBattery()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Сохраняем настройки уведомлений и сразу пересобираем расписание на устройстве.
  const updateNotif = async (patch: Partial<NotifSettings>) => {
    if (!user) return
    const next = { ...notif, ...patch }
    setNotif(next)
    try {
      await saveNotifSettings(user.id, next)
      await rescheduleAll(user.id)
    } catch {
      // на вебе расписание не создаётся — это нормально
    }
  }

  const toggleDaySections = async () => {
    if (!user) return
    const next = !daySections
    setDaySections(next)
    try {
      await saveDaySections(user.id, next)
    } catch {
      setDaySections(!next)
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div className="sticky top-0 z-20 -mx-4 border-b border-neutral-200/70 bg-white/85 px-4 py-3 backdrop-blur dark:border-neutral-800/70 dark:bg-neutral-950/85">
        <h1 className="text-xl font-semibold">⚙️ {t('pnav.settings')}</h1>
      </div>

      <div className={`flex items-center justify-between gap-3 ${cardCls}`}>
        <div className="min-w-0">
          <p className="font-medium">✅ {t('set.daySections')}</p>
        </div>
        <button
          onClick={toggleDaySections}
          disabled={!user || !ready}
          className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition active:scale-[.97] disabled:opacity-50 ${
            daySections
              ? 'bg-emerald-500 text-neutral-950 hover:bg-emerald-400'
              : 'border border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
          }`}
        >
          {daySections ? t('set.on') : t('set.off')}
        </button>
      </div>

      {/* 🔔 Уведомления */}
      <div className={`flex flex-col gap-4 ${cardCls}`}>
        <p className="font-semibold">🔔 {t('notif.title')}</p>

        {/* Дела и привычки */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">✅ {t('notif.tasks')}</p>
          </div>
          <button
            onClick={() => updateNotif({ tasksEnabled: !notif.tasksEnabled })}
            disabled={!user || !notifReady}
            className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition active:scale-[.97] disabled:opacity-50 ${
              notif.tasksEnabled
                ? 'bg-emerald-500 text-neutral-950 hover:bg-emerald-400'
                : 'border border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
            }`}
          >
            {notif.tasksEnabled ? t('set.on') : t('set.off')}
          </button>
        </div>
        {notif.tasksEnabled && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-neutral-600 dark:text-neutral-300">{t('notif.offset')}</p>
            <Select
              className="w-fit"
              value={String(notif.tasksOffsetMin)}
              onChange={(v) => updateNotif({ tasksOffsetMin: Number(v) })}
              options={OFFSET_OPTIONS.map((m) => ({
                value: String(m),
                label: m === 0 ? t('notif.offset0') : t('notif.offsetMin', { n: String(m) }),
              }))}
            />
          </div>
        )}
      </div>

      {/* 🔋 Работа в фоне (энергосбережение MIUI/Android) */}
      {batteryAvailable() && (
        <div className={`flex flex-col gap-3 ${cardCls}`}>
          <div className="flex items-center justify-between gap-3">
            <p className="font-semibold">🔋 {lang === 'ru' ? 'Работа в фоне' : 'Background work'}</p>
            {batteryReady && (
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                  batteryIgnoring
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                }`}
              >
                {batteryIgnoring
                  ? lang === 'ru'
                    ? 'Настроено'
                    : 'Configured'
                  : lang === 'ru'
                    ? 'Требует настройки'
                    : 'Needs setup'}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <button
              onClick={handleBatteryRequest}
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950 transition hover:bg-emerald-400 active:scale-[.99]"
            >
              {lang === 'ru' ? 'Отключить оптимизацию батареи' : 'Disable battery optimization'}
            </button>
            <button
              onClick={() => void openAutoStartSettings()}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium transition hover:bg-neutral-100 active:scale-[.99] dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              {lang === 'ru' ? 'Автозапуск (Xiaomi/MIUI)' : 'Autostart (Xiaomi/MIUI)'}
            </button>
            <button
              onClick={() => void openAppDetailsSettings()}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium transition hover:bg-neutral-100 active:scale-[.99] dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              {lang === 'ru' ? 'Настройки приложения' : 'App settings'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
