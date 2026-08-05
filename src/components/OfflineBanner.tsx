import { useEffect, useState } from 'react'
import {
  getOfflineStatus,
  subscribeOfflineStatus,
  type OfflineStatus,
} from '../lib/offlineSync'
import { useLang } from '../lib/i18n'

const initialStatus: OfflineStatus = { online: true, pending: 0 }

// Небольшой неблокирующий индикатор: пользователь понимает, что данные сохранены
// локально и будут синхронизированы, а не думает, что приложение «сломалось».
export default function OfflineBanner() {
  const { lang } = useLang()
  const [status, setStatus] = useState<OfflineStatus>(initialStatus)

  useEffect(() => {
    const refresh = () => {
      void getOfflineStatus().then(setStatus)
    }
    return subscribeOfflineStatus(refresh)
  }, [])

  if (status.online && status.pending === 0) return null

  const message = !status.online
    ? lang === 'en'
      ? 'Offline: data is saved on this device'
      : 'Нет сети: данные сохраняются на этом устройстве'
    : lang === 'en'
      ? 'Synchronizing saved changes…'
      : 'Синхронизация сохранённых изменений…'

  const count = status.pending > 0 ? ` · ${status.pending}` : ''

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-3 top-3 z-50 rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-800 shadow-lg backdrop-blur dark:text-amber-300"
    >
      {status.online ? '↻' : '◌'} {message}{count}
    </div>
  )
}
