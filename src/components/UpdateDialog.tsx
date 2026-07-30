import { useEffect, useState } from 'react'
import { useLang } from '../lib/i18n'
import { useAnimatedMount } from '../lib/useAnimatedMount'
import {
  UPDATE_EVENT,
  getPendingUpdate,
  installDesktopUpdate,
  type UpdateInfo,
} from '../lib/desktopUpdate'

// Окно «Доступно обновление» (только десктоп, Tauri).
// Показывает текущую и новую версию, описание из latest.json и две кнопки.
// «Напомнить позже» и крестик просто закрывают окно: обновление никуда не девается
// и окно появится снова при следующем запуске приложения.
export default function UpdateDialog() {
  const { lang } = useLang()
  const en = lang === 'en'
  const [info, setInfo] = useState<UpdateInfo | null>(() => getPendingUpdate())
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [percent, setPercent] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const show = useAnimatedMount(open, 220)

  // Обновление могло быть найдено ещё до монтирования компонента — тогда берём его
  // из памяти модуля, иначе ждём событие от checkDesktopUpdate.
  useEffect(() => {
    const pendingNow = getPendingUpdate()
    if (pendingNow) {
      setInfo(pendingNow)
      setOpen(true)
    }
    const onFound = (e: Event) => {
      const detail = (e as CustomEvent<UpdateInfo>).detail
      if (!detail) return
      setInfo(detail)
      setError(null)
      setPercent(0)
      setOpen(true)
    }
    window.addEventListener(UPDATE_EVENT, onFound)
    return () => window.removeEventListener(UPDATE_EVENT, onFound)
  }, [])

  if (!show || !info) return null

  const close = () => {
    // Во время установки закрывать нельзя: приложение вот-вот перезапустится.
    if (busy) return
    setOpen(false)
  }

  const onUpdate = async () => {
    setBusy(true)
    setError(null)
    const err = await installDesktopUpdate((p) => setPercent(p))
    if (err) {
      // При успехе сюда не попадаем: приложение уже перезапустилось.
      setBusy(false)
      setError(err)
    }
  }

  return (
    <div
      className={`${open ? 'animate-fade' : 'animate-fade-out'} fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4`}
      onClick={close}
    >
      <div
        className={`${open ? 'animate-dialog' : 'animate-dialog-out'} relative w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-800 dark:bg-neutral-900`}
        onClick={(e) => e.stopPropagation()}
      >
        {!busy && (
          <button
            type="button"
            onClick={close}
            aria-label={en ? 'Close' : 'Закрыть'}
            className="absolute right-3 top-3 rounded-lg px-2 py-1 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            ✕
          </button>
        )}

        <div className="text-2xl">⬆️</div>
        <h2 className="mt-2 text-lg font-semibold">
          {en ? 'Update available' : 'Доступно обновление'}
        </h2>

        <div className="mt-3 flex items-center gap-2 text-sm">
          <span className="rounded-lg bg-neutral-100 px-2 py-1 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
            {info.current}
          </span>
          <span className="text-neutral-400">→</span>
          <span className="rounded-lg bg-emerald-500/15 px-2 py-1 font-medium text-emerald-600 dark:text-emerald-400">
            {info.version}
          </span>
        </div>

        <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
          {info.notes ||
            (en
              ? 'A new version of Nucleus is ready to install.'
              : 'Готова к установке новая версия Nucleus.')}
        </p>

        {busy && (
          <div className="mt-4">
            <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${percent || 5}%` }}
              />
            </div>
            <div className="mt-2 text-xs text-neutral-500">
              {percent >= 100
                ? en
                  ? 'Installing and restarting…'
                  : 'Установка и перезапуск…'
                : en
                  ? `Downloading… ${percent}%`
                  : `Загрузка… ${percent}%`}
            </div>
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-500">
            {error}
          </div>
        )}

        {!busy && (
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={close}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              {en ? 'Remind me later' : 'Напомнить позже'}
            </button>
            <button
              type="button"
              onClick={() => void onUpdate()}
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950 transition hover:bg-emerald-400"
            >
              {en ? 'Update' : 'Обновить'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
