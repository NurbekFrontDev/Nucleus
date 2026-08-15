import { useEffect, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useTheme } from '../lib/ThemeContext'
import Select from './Select'
import UsageCard from './UsageCard'
import { useLang } from '../lib/i18n'
import {
  DISPLAY_CURRENCIES,
  getDisplayCurrency,
  setDisplayCurrency,
  saveDisplayCurrencyToCloud,
  loadDisplayCurrencyFromCloud,
} from '../lib/db'
import { supabase } from '../lib/supabase'
import {
  runBackup,
  backupTargetLabel,
  supportsFsAccess,
  pickBackupDir,
  getSavedDirName,
} from '../lib/backup'
import { showToast } from '../lib/toast'
import { isDesktop, isAutostartEnabled, setAutostart } from '../lib/native'
import { APP_VERSION } from '../lib/version'
import { useAnimatedMount } from '../lib/useAnimatedMount'

// Глобальное модальное окно настроек (~80% экрана).
// Открывается из popup-меню профиля (шестерёнка). Содержит все общие настройки,
// которые раньше были на странице Settings (FinLit): язык, тему, валюту,
// бэкап, хранилище, автозапуск, версию.

type Props = {
  onClose: () => void
}

const cardCls =
  'rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900/50'

export default function SettingsModal({ onClose }: Props) {
  const { user } = useAuth()
  const { theme, setTheme } = useTheme()
  const { t, lang, setLang } = useLang()
  const [open, setOpen] = useState(true)
  const visible = useAnimatedMount(open, 220)

  const onDesktop = isDesktop()
  const canPickDir = supportsFsAccess()

  const [dispCurrency, setDispCurrencyState] = useState(getDisplayCurrency().code)
  const [autostart, setAutostartState] = useState(false)
  const [backupAuto, setBackupAuto] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null)
  const [lastBackupTarget, setLastBackupTarget] = useState<string | null>(null)
  const [dirName, setDirName] = useState<string | null>(null)

  useEffect(() => {
    if (!visible) onClose()
  }, [visible, onClose])

  // Блокируем прокрутку фона.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  // Загрузка валюты из облака.
  useEffect(() => {
    if (!user) return
    let active = true
    ;(async () => {
      try {
        const cloud = await loadDisplayCurrencyFromCloud(user.id)
        if (active && cloud) {
          setDisplayCurrency(cloud)
          setDispCurrencyState(cloud)
        }
      } catch { /* не критично */ }
    })()
    return () => { active = false }
  }, [user])

  // Загрузка настроек бэкапа.
  useEffect(() => {
    if (!user) return
    let active = true
    ;(async () => {
      try {
        const { data } = await supabase
          .from('app_settings')
          .select('backup_auto, last_backup_at, last_backup_target')
          .eq('user_id', user.id)
          .maybeSingle()
        if (active) {
          const d = data as {
            backup_auto?: boolean
            last_backup_at?: string | null
            last_backup_target?: string | null
          } | null
          setBackupAuto(!!d?.backup_auto)
          setLastBackupAt(d?.last_backup_at ?? null)
          setLastBackupTarget(d?.last_backup_target ?? null)
        }
      } catch { /* не критично */ }
    })()
    return () => { active = false }
  }, [user])

  useEffect(() => {
    if (!canPickDir) return
    void getSavedDirName().then((n) => setDirName(n))
  }, [canPickDir])

  useEffect(() => {
    if (!onDesktop) return
    void isAutostartEnabled().then((v) => setAutostartState(v))
  }, [onDesktop])

  const toggleBackupAuto = async () => {
    if (!user) return
    const next = !backupAuto
    setBackupAuto(next)
    try {
      await supabase.from('app_settings').upsert(
        { user_id: user.id, backup_auto: next, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      )
    } catch {
      setBackupAuto(!next)
    }
  }

  const doBackup = async () => {
    if (!user || backupBusy) return
    setBackupBusy(true)
    try {
      const res = await runBackup(user.id)
      if (res.cloud || res.file) {
        setLastBackupAt(new Date().toISOString())
        setLastBackupTarget(res.target)
        const place = backupTargetLabel(res.target, lang === 'en' ? 'en' : 'ru')
        showToast(
          lang === 'en'
            ? `Backup saved: ${place} (${res.rowCount} records)`
            : `Бэкап сохранён: ${place} (${res.rowCount} записей)`,
        )
      } else {
        showToast(lang === 'en' ? 'Backup failed' : 'Не удалось сделать бэкап')
      }
    } catch {
      showToast(lang === 'en' ? 'Backup failed' : 'Не удалось сделать бэкап')
    } finally {
      setBackupBusy(false)
    }
  }

  const choosePcDir = async () => {
    const name = await pickBackupDir()
    if (name) setDirName(name)
  }

  const toggleAutostart = async () => {
    const next = !autostart
    setAutostartState(next)
    const ok = await setAutostart(next)
    if (!ok) setAutostartState(!next)
  }

  const close = () => setOpen(false)

  return (
    <div
      className={`${open ? 'animate-fade' : 'animate-fade-out'} fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4`}
      onClick={close}
    >
      <div
        className={`${open ? 'animate-dialog' : 'animate-dialog-out'} flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-900`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Шапка */}
        <div className="flex items-center justify-between gap-3 border-b border-neutral-200/70 px-6 py-4 dark:border-neutral-800/70">
          <h2 className="text-xl font-semibold">⚙️ {t('set.title')}</h2>
          <button
            type="button"
            onClick={close}
            className="rounded-full px-2 py-1 text-lg leading-none text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800"
          >
            ✕
          </button>
        </div>

        {/* Содержимое с прокруткой */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="flex flex-col gap-4">
            {/* Аккаунт */}
            <div className={cardCls}>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('set.signedInAs')}</p>
              <p className="mt-1 font-medium break-all">{user?.email}</p>
            </div>

            {/* Язык */}
            <div className={`flex items-center justify-between gap-3 ${cardCls}`}>
              <div className="min-w-0">
                <p className="font-medium">🌐 {t('set.language')}</p>
              </div>
              <div className="shrink-0">
                <Select
                  className="w-fit"
                  value={lang}
                  onChange={(v) => setLang(v as 'ru' | 'en')}
                  options={[
                    { value: 'ru', label: 'Русский' },
                    { value: 'en', label: 'English' },
                  ]}
                />
              </div>
            </div>

            {/* Валюта отображения */}
            <div className={`flex items-center justify-between gap-3 ${cardCls}`}>
              <div className="min-w-0">
                <p className="font-medium">💱 {lang === 'en' ? 'Display currency' : 'Валюта отображения'}</p>
                <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                  {lang === 'en' ? 'Symbol shown next to amounts' : 'Символ, отображаемый рядом с суммами'}
                </p>
              </div>
              <div className="shrink-0">
                <Select
                  className="w-fit"
                  value={dispCurrency}
                  onChange={(v) => {
                    setDispCurrencyState(v)
                    setDisplayCurrency(v)
                    if (user) void saveDisplayCurrencyToCloud(user.id, v)
                  }}
                  options={DISPLAY_CURRENCIES.map((c) => ({
                    value: c.code,
                    label: `${c.symbol} ${c.code}`,
                  }))}
                />
              </div>
            </div>

            {/* Тема */}
            <div className={`flex items-center justify-between gap-3 ${cardCls}`}>
              <p className="font-medium">{t('set.theme')}</p>
              <div className="flex items-center gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800">
                <button
                  onClick={() => setTheme('system')}
                  className={`rounded-lg px-3 py-1.5 text-sm transition ${theme === 'system' ? 'bg-white shadow-sm dark:bg-neutral-700 text-emerald-500 font-medium' : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400'}`}
                >
                  💻
                </button>
                <button
                  onClick={() => setTheme('light')}
                  className={`rounded-lg px-3 py-1.5 text-sm transition ${theme === 'light' ? 'bg-white shadow-sm dark:bg-neutral-700 text-emerald-500 font-medium' : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400'}`}
                >
                  ☀️
                </button>
                <button
                  onClick={() => setTheme('dark')}
                  className={`rounded-lg px-3 py-1.5 text-sm transition ${theme === 'dark' ? 'bg-white shadow-sm dark:bg-neutral-700 text-emerald-500 font-medium' : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400'}`}
                >
                  🌙
                </button>
              </div>
            </div>

            {/* Автозапуск (десктоп) */}
            {onDesktop && (
              <div className={`flex items-center justify-between gap-3 ${cardCls}`}>
                <div className="min-w-0">
                  <p className="font-medium">
                    🚀 {lang === 'en' ? 'Launch on Windows startup' : 'Запускать при старте Windows'}
                  </p>
                </div>
                <button
                  onClick={toggleAutostart}
                  className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition ${
                    autostart
                      ? 'bg-emerald-500 text-neutral-950 hover:bg-emerald-400'
                      : 'border border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
                  }`}
                >
                  {autostart ? t('set.on') : t('set.off')}
                </button>
              </div>
            )}

            {/* Бэкап */}
            <div className={`flex flex-col gap-3 ${cardCls}`}>
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium">🛡️ {t('set.backup')}</p>
                <button
                  onClick={doBackup}
                  disabled={!user || backupBusy}
                  className="shrink-0 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-50"
                >
                  {backupBusy ? t('backup.doing') : t('set.backupNow')}
                </button>
              </div>

              <div className="text-sm text-neutral-500 dark:text-neutral-400">
                {lastBackupAt ? (
                  <>
                    {lang === 'en' ? 'Last backup: ' : 'Последний бэкап: '}
                    {new Date(lastBackupAt).toLocaleString(lang === 'en' ? 'en-US' : 'ru-RU')}
                    {', '}
                    {backupTargetLabel(lastBackupTarget, lang === 'en' ? 'en' : 'ru')}
                  </>
                ) : lang === 'en' ? (
                  'No backups yet'
                ) : (
                  'Бэкапов ещё не было'
                )}
              </div>

              {canPickDir && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 text-sm text-neutral-500 dark:text-neutral-400">
                    {lang === 'en' ? 'PC backup folder: ' : 'Папка для бэкапов на ПК: '}
                    <span className="font-medium text-neutral-700 dark:text-neutral-200">
                      {dirName || (lang === 'en' ? 'not selected' : 'не выбрана')}
                    </span>
                  </div>
                  <button
                    onClick={choosePcDir}
                    className="shrink-0 rounded-lg border border-neutral-300 px-4 py-2 text-sm transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                  >
                    {dirName
                      ? lang === 'en'
                        ? 'Change folder'
                        : 'Сменить папку'
                      : lang === 'en'
                        ? 'Choose folder'
                        : 'Выбрать папку'}
                  </button>
                </div>
              )}

              <div className="mt-1 flex items-center justify-between gap-3">
                <p className="font-medium">🔁 {t('set.backupAuto')}</p>
                <button
                  onClick={toggleBackupAuto}
                  disabled={!user}
                  className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${
                    backupAuto
                      ? 'bg-emerald-500 text-neutral-950 hover:bg-emerald-400'
                      : 'border border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
                  }`}
                >
                  {backupAuto ? t('set.on') : t('set.off')}
                </button>
              </div>
            </div>

            {/* Хранилище и лимиты */}
            <UsageCard />

            {/* Версия */}
            <p className="pt-2 text-xs text-neutral-400 dark:text-neutral-600">
              Nucleus v{APP_VERSION}
              {' · '}
              {isDesktop()
                ? 'Windows'
                : /android/i.test(navigator.userAgent)
                  ? 'Android'
                  : lang === 'en'
                    ? 'Web'
                    : 'Браузер'}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
