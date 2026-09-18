import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { lazy, useEffect, useRef, useState } from 'react'
import { useAuth } from './lib/AuthContext'
import { initNativeAuth, initDesktopAuth, setDesktopDnd } from './lib/native'
import { initNotifications } from './lib/notifications'
import { initPush } from './lib/push'
import { maybeAutoBackup, backupTargetLabel } from './lib/backup'
import { showToast } from './lib/toast'
import { useLang } from './lib/i18n'
import { Capacitor } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import Layout from './components/Layout'
import Login from './pages/Login'
import { initOta } from './lib/ota'
import { initDesktopUpdates } from './lib/desktopUpdate'
import UpdateDialog from './components/UpdateDialog'
import { initPomoSync, type PomoSyncMessage } from './lib/pomoSync'
import { startRealtimeSync, stopRealtimeSync, onSyncEvent } from './lib/realtimeSync'
import { enableFocusDnd, disableFocusDnd } from './lib/dnd'
import { syncUserNameFromCloud } from './lib/db'
import {
  getLastNavPath,
  saveLastNavPath,
  initNavLifecycle,
  isValidNavPath,
} from './lib/navStorage'

// Код-сплиттинг (А-9, шаг 3): страницы грузятся отдельными чанками по мере
// перехода на них, а не одним большим бандлом при старте — это ускоряет первый
// запуск. Оболочка (Layout: шапка и нижняя навигация) остаётся мгновенной, а
// тело страницы подгружается под Suspense (обычно из локального кэша чанков —
// незаметно быстро).
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Incomes = lazy(() => import('./pages/Incomes'))
const Expenses = lazy(() => import('./pages/Expenses'))
const Budget = lazy(() => import('./pages/Budget'))
const Goals = lazy(() => import('./pages/Goals'))
const Investments = lazy(() => import('./pages/Investments'))
const Charity = lazy(() => import('./pages/Charity'))
const History = lazy(() => import('./pages/History'))
const Settings = lazy(() => import('./pages/Settings'))
const PlannerToday = lazy(() => import('./pages/PlannerToday'))
const PlannerItems = lazy(() => import('./pages/PlannerItems'))
const PlannerMatrix = lazy(() => import('./pages/PlannerMatrix'))
const PlannerFocus = lazy(() => import('./pages/PlannerFocus'))
const PlannerStats = lazy(() => import('./pages/PlannerStats'))
const PlannerSettings = lazy(() => import('./pages/PlannerSettings'))
const WaterTracker = lazy(() => import('./pages/WaterTracker'))

function NotFoundRedirect({ fallback }: { fallback: string }) {
  const to = isValidNavPath(fallback) ? fallback : '/'
  return <Navigate to={to} replace />
}

function App() {
  const { session, user, loading } = useAuth()
  const { lang } = useLang()
  const location = useLocation()
  const navigate = useNavigate()
  // Зеркало языка в ref, чтобы читать актуальное значение внутри эффекта авто-бэкапа,
  // не добавляя lang в его зависимости (иначе эффект перезапускался бы).
  const langRef = useRef(lang)
  langRef.current = lang
  const [lastPath, setLastPath] = useState(() => getLastNavPath('/planner'))
  const userId = user?.id

  // 1. Сохранение последнего маршрута при ЛЮБОМ переходе внутри приложения
  // Сохраняется локально на устройстве (localStorage + Preferences на Android)
  useEffect(() => {
    const p = location.pathname
    if (isValidNavPath(p)) {
      saveLastNavPath(p)
      setLastPath(p)
    }
  }, [location.pathname])

  // 2. Глобальные слушатели жизненного цикла устройства (сворачивание, свайп, блокировка экрана, pagehide)
  useEffect(() => {
    return initNavLifecycle(() => window.location.pathname)
  }, [])

  // Фоновая синхронизация имени пользователя при старте приложения
  useEffect(() => {
    if (!userId) return
    void syncUserNameFromCloud(userId).catch(() => {})
  }, [userId])

  // Синхронизация имени пользователя в реальном времени при изменении на другом устройстве.
  // Маршруты намеренно НЕ синхронизируются через Realtime, чтобы телефон и ПК сохраняли
  // своё независимое состояние.
  useEffect(() => {
    return onSyncEvent(['app_settings'], (evt) => {
      if (evt.table === 'app_settings' && evt.new) {
        const d = evt.new as { user_name?: string }
        if (d.user_name && typeof d.user_name === 'string' && d.user_name.trim() && userId) {
          const clean = d.user_name.trim()
          try {
            localStorage.setItem('nucleus:userName:' + userId, clean)
          } catch {}
          window.dispatchEvent(new CustomEvent('nucleus:userNameChanged', { detail: clean }))
        }
      }
    })
  }, [userId])

  // Нативная авторизация: обновление токена при возврате в приложение и
  // обработка возврата из браузера после входа через Google (deep link).
  useEffect(() => {
    const cleanup = initNativeAuth()
    return cleanup
  }, [])

  // То же самое для десктопа (Tauri): возврат из системного браузера после входа
  // через Google по Tauri deep link. В вебе/на телефоне — no-op.
  useEffect(() => {
    const cleanup = initDesktopAuth()
    return cleanup
  }, [])

  // Обновления «по воздуху» (OTA, А-10): на телефоне подтверждаем рабочий запуск
  // и в фоне проверяем новую web-версию в Supabase Storage. Если она есть —
  // скачиваем и применяем при следующем открытии. В вебе initOta ничего не
  // делает.
  useEffect(() => {
    void initOta()
  }, [])

  // Автообновление десктопа (Tauri, Windows): при запуске проверяем новую версию
  // в Supabase Storage. Молча НЕ ставим: если версия новее, показываем окно
  // UpdateDialog с текущей и новой версией. Пользователь сам решает — обновить
  // сейчас или позже (тогда напомним при следующем запуске). В вебе/на телефоне
  // — no-op.
  useEffect(() => {
    const cleanup = initDesktopUpdates()
    return cleanup
  }, [])

  // Глобальная синхронизация Помодоро (для включения режима «Не беспокоить»
  // синхронно на всех устройствах, даже если вкладка Фокуса не открыта).
  useEffect(() => {
    if (!userId) return
    const cleanup = initPomoSync(userId)
    
    const handler = (e: Event) => {
       const msg = (e as CustomEvent<PomoSyncMessage>).detail
       if (msg.kind === 'update') {
          const rt = msg.runtime
          if (rt.running && rt.mode === 'focus') {
             void setDesktopDnd(true)
             void enableFocusDnd()
          } else {
             void setDesktopDnd(false)
             void disableFocusDnd()
          }
       } else if (msg.kind === 'clear') {
          void setDesktopDnd(false)
          void disableFocusDnd()
       }
    }
    window.addEventListener('nucleus-pomo-sync', handler)
    
    return () => {
      cleanup()
      window.removeEventListener('nucleus-pomo-sync', handler)
    }
  }, [userId])

  // Мгновенная синхронизация базы данных (Realtime postgres_changes) между всеми устройствами
  useEffect(() => {
    if (!userId) return
    startRealtimeSync(userId)
    return () => {
      stopRealtimeSync()
    }
  }, [userId])

  // Локальные уведомления и авто-бэкап (А-6): при запуске планируем уведомления
  // на устройстве, запускаем авто-бэкап (не чаще раза в N дней) и обрабатываем
  // тап по уведомлению — переходим на нужный экран.
  useEffect(() => {
    if (!userId) return
    let active = true
    let handle: { remove: () => void } | undefined

    ;(async () => {
      // Авто-бэкап работает и в вебе, и на телефоне (только в облако). Если бэкап
      // действительно сделан — показываем всплывающее уведомление.
      void maybeAutoBackup(userId).then((r) => {
        if (!r) return
        const l = langRef.current === 'en' ? 'en' : 'ru'
        const place = backupTargetLabel(r.target, l)
        showToast(
          l === 'en'
            ? `Auto-backup saved to ${place} (${r.rowCount} records)`
            : `Авто-бэкап сохранён: ${place} (${r.rowCount} записей)`,
        )
      })

      if (!Capacitor.isNativePlatform()) return
      await initNotifications(userId)
      void initPush(userId)
      try {
        const { LocalNotifications } = await import('@capacitor/local-notifications')
        const h = await LocalNotifications.addListener(
          'localNotificationActionPerformed',
          (action) => {
            const path = (action?.notification?.extra as { path?: string } | undefined)?.path
            if (path) navigate(path)
          },
        )
        if (active) handle = h
        else h.remove()
      } catch {
        // уведомления не критичны для работы приложения
      }
    })()

    return () => {
      active = false
      handle?.remove()
    }
  }, [userId, navigate])

  // Тап по push-уведомлению (А-7): push.ts шлёт событие nucleus-push-open с маршрутом,
  // здесь переходим на нужный экран внутри приложения (переиспользуем navigate).
  useEffect(() => {
    const onOpen = (e: Event) => {
      const route = (e as CustomEvent<{ route?: string }>).detail?.route
      if (route) navigate(route)
    }
    window.addEventListener('nucleus-push-open', onOpen)
    return () => window.removeEventListener('nucleus-push-open', onOpen)
  }, [navigate])

  // Тап по уведомлению о завершении Помодоро (нативный deep link com.nucleus.app://focus)
  // — открываем вкладку Фокус.
  useEffect(() => {
    const onFocus = () => navigate('/planner/focus')
    window.addEventListener('nucleus-open-focus', onFocus)
    return () => window.removeEventListener('nucleus-open-focus', onFocus)
  }, [navigate])

  // Аппаратная кнопка «назад» на Android: сначала уходим на предыдущий
  // экран внутри приложения, и только с «корневых» экранов модулей (FinLit/Планировщик)
  // сворачиваем приложение, а не закрываем его совсем.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let handle: { remove: () => void } | undefined
    CapacitorApp.addListener('backButton', () => {
      const path = window.location.pathname
      if (path === '/' || path === '/planner') {
        saveLastNavPath(path)
        CapacitorApp.minimizeApp()
      } else {
        navigate(-1)
      }
    }).then((h) => {
      handle = h
    })
    return () => {
      handle?.remove()
    }
  }, [navigate])

  if (loading) {
    return (
      <>
        <UpdateDialog />
        <div className="flex min-h-screen items-center justify-center text-neutral-400">
          Загрузка…
        </div>
      </>
    )
  }

  if (!session && !user) {
    return (
      <>
        {/* Окно обновления показываем и до входа: проверка версии идёт сразу
            при запуске, а сессия может ещё не восстановиться. Раньше в этот момент
            компонента просто не было в дереве, и событие об обновлении терялось. */}
        <UpdateDialog />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </>
    )
  }

  return (
    <>
      {/* Окно «Доступно обновление» живёт над всеми экранами (только десктоп). */}
      <UpdateDialog />
      <Routes>
        <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/incomes" element={<Incomes />} />
        <Route path="/expenses" element={<Expenses />} />
        <Route path="/budget" element={<Budget />} />
        <Route path="/goals" element={<Goals />} />
        <Route path="/investments" element={<Investments />} />
        <Route path="/charity" element={<Charity />} />
        <Route path="/debts" element={<Navigate to="/expenses" replace />} />
        <Route path="/history" element={<History />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/planner" element={<PlannerToday />} />
        <Route path="/planner/items" element={<PlannerItems />} />
        <Route path="/planner/matrix" element={<PlannerMatrix />} />
        <Route path="/planner/habits" element={<Navigate to="/planner/items" replace />} />
        <Route path="/planner/calendar" element={<Navigate to="/planner" replace />} />
        <Route path="/planner/focus" element={<PlannerFocus />} />
        <Route path="/planner/stats" element={<PlannerStats />} />
        <Route path="/planner/settings" element={<PlannerSettings />} />
        <Route path="/planner/water" element={<WaterTracker />} />
          <Route path="*" element={<NotFoundRedirect fallback={lastPath} />} />
        </Route>
      </Routes>
    </>
  )
}

export default App
