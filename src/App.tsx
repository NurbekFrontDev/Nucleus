import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { lazy, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAuth } from './lib/AuthContext'
import { supabase } from './lib/supabase'
import { initNativeAuth } from './lib/native'
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

// Ключ локального кэша последней открытой вкладки. БД (app_settings.last_path)
// остаётся источником правды для синхронизации между устройствами, а этот кэш
// нужен, чтобы МГНОВЕННО (ещё до отрисовки) открыть нужную вкладку на старте и
// не мигать Дашбордом.
const LAST_PATH_KEY = 'nucleus:lastPath'

function NotFoundRedirect({ fallback }: { fallback: string }) {
  const to = fallback && fallback !== '/login' ? fallback : '/'
  return <Navigate to={to} replace />
}

function App() {
  const { session, loading } = useAuth()
  const { lang } = useLang()
  const location = useLocation()
  const navigate = useNavigate()
  // Зеркало языка в ref, чтобы читать актуальное значение внутри эффекта авто-бэкапа,
  // не добавляя lang в его зависимости (иначе эффект перезапускался бы).
  const langRef = useRef(lang)
  langRef.current = lang
  const [lastPath, setLastPath] = useState(() => {
    try {
      return localStorage.getItem(LAST_PATH_KEY) || '/'
    } catch {
      return '/'
    }
  })
  const [restored, setRestored] = useState(false)
  // Пока идёт первичное решение «куда открыть» — показываем экран загрузки,
  // а не Дашборд. Снимается в useLayoutEffect ниже (мгновенно, до отрисовки).
  const [booting, setBooting] = useState(true)
  // Восстановление последней вкладки должно срабатывать ТОЛЬКО один раз при
  // загрузке. Иначе эффект перезапускается на каждой навигации (navigate из
  // react-router меняет идентичность при смене маршрута), и любой переход на '/'
  // (например клик по вкладке FinLit) мгновенно отбрасывает обратно на
  // сохранённый путь — из-за этого "не переключается".
  const didRestore = useRef(false)
  // Редирект «на последнюю вкладку» должен произойти РОВНО ОДИН РАЗ при холодном
  // старте. Иначе эффект ниже повторяется на каждой навигации (navigate из
  // react-router может менять идентичность) и клик по вкладке FinLit (переход на
  // '/') мгновенно отбрасывает обратно на сохранённый '/planner' — вкладка
  // «не переключается».
  const didBoot = useRef(false)
  const userId = session?.user?.id

  // Мгновенное открытие последней вкладки (до первой отрисовки). Если на старте
  // мы на корне '/', а в локальном кэше есть другая последняя вкладка — сразу
  // уводим туда через replace, ещё до paint. Так пользователь не видит вспышку
  // Дашборда с последующим перескоком. БД (ниже) синхронизирует кэш и остаётся
  // источником правды между устройствами.
  useLayoutEffect(() => {
    // Уже загрузились один раз — больше НИКОГДА не трогаем маршрут
    // автоматически, иначе ломается ручное переключение вкладок (см. didBoot).
    if (didBoot.current) return
    if (!userId) {
      // Сессия ещё грузится — не финализируем boot, дождёмся userId.
      setBooting(false)
      return
    }
    // Есть пользователь — это и есть единственный холодный старт: помечаем сразу.
    didBoot.current = true
    try {
      const cached = localStorage.getItem(LAST_PATH_KEY)
      if (
        cached &&
        cached !== '/login' &&
        cached !== '/' &&
        window.location.pathname === '/'
      ) {
        navigate(cached, { replace: true })
      }
    } catch {
      // кэш недоступен — не критично, останемся на текущем маршруте
    }
    setBooting(false)
  }, [userId, navigate])

  // Восстановление последней открытой страницы — ИСТОЧНИК ПРАВДЫ ТОЛЬКО БАЗА
  // ДАННЫХ (app_settings.last_path). localStorage больше НЕ используется: это
  // даёт одинаковое поведение на телефоне и компьютере и убирает баг, когда
  // мобильный браузер очищает локальное хранилище и вкладка не восстанавливалась.
  useEffect(() => {
    if (!userId) return
    // Только один раз за загрузку (см. комментарий к didRestore выше).
    if (didRestore.current) return
    didRestore.current = true
    let active = true

    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('app_settings')
          .select('last_path')
          .eq('user_id', userId)
          .maybeSingle()
        if (error) {
          // Чаще всего это кеш схемы PostgREST: колонка last_path ещё не видна REST API.
          console.warn('[last_path] ошибка чтения из БД:', error.message)
        }
        const dbPath = (data as { last_path?: string } | null)?.last_path
        if (active && dbPath && dbPath !== '/login') {
          setLastPath(dbPath)
          // Обновляем ТОЛЬКО локальный кэш (для мгновенного редиректа при
          // следующем холодном старте) и fallback для 404. Автоматический
          // navigate здесь убран намеренно: единственный boot-редирект делает
          // useLayoutEffect выше (из локального кэша), а любые более поздние
          // переходы полностью в руках пользователя — иначе асинхронный ответ БД
          // мог «перебить» ручное переключение вкладки (баг с FinLit).
          try {
            localStorage.setItem(LAST_PATH_KEY, dbPath)
          } catch {
            // кэш недоступен — не критично
          }
        }
      } catch (e) {
        console.warn('[last_path] сбой восстановления:', e)
      } finally {
        if (active) setRestored(true)
      }
    })()

    return () => {
      active = false
    }
  }, [userId, navigate])

  // После восстановления сохраняем текущую страницу ТОЛЬКО в БД (синхрон между
  // устройствами). Локальное хранилище намеренно не трогаем.
  useEffect(() => {
    if (!restored || !userId) return
    const p = location.pathname
    if (p === '/login') return
    setLastPath(p)
    try {
      localStorage.setItem(LAST_PATH_KEY, p)
    } catch {
      // кэш недоступен — не критично
    }
    void (async () => {
      const { error } = await supabase.from('app_settings').upsert(
        { user_id: userId, last_path: p, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      )
      if (error) {
        console.warn('[last_path] ошибка сохранения в БД:', error.message)
      }
    })()
  }, [restored, userId, location.pathname])

  // Нативная авторизация: обновление токена при возврате в приложение и
  // обработка возврата из браузера после входа через Google (deep link).
  useEffect(() => {
    const cleanup = initNativeAuth()
    return cleanup
  }, [])

  // Обновления «по воздуху» (OTA, А-10): на телефоне подтверждаем рабочий запуск
  // и в фоне проверяем новую web-версию в Supabase Storage. Если она есть —
  // скачиваем и применяем при следующем открытии. В вебе initOta ничего не
  // делает.
  useEffect(() => {
    void initOta()
  }, [])

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

  if (loading || booting) {
    return (
      <div className="flex min-h-screen items-center justify-center text-neutral-400">
        Загрузка…
      </div>
    )
  }

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  return (
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
  )
}

export default App
