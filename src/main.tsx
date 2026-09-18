import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './lib/AuthContext.tsx'
import { ThemeProvider } from './lib/ThemeContext.tsx'
import { LanguageProvider } from './lib/i18n.tsx'
import { initStatusBar } from './lib/native.ts'
import { getLastNavPath, isValidNavPath, LAST_PATH_KEY } from './lib/navStorage.ts'

initStatusBar()

// Восстановление последнего открытого экрана ДО монтирования React Router:
// Если приложение стартует с базового URL ('/' или '/index.html' или ''),
// подменяем pathname в history на сохранённый маршрут ДО инициализации BrowserRouter.
// Благодаря этому BrowserRouter сразу стартует на нужной вкладке без гонок рендера,
// промежуточных редиректов и сбоев.
const APP_VERSION = '0.1.47'
try {
  const lastVer = localStorage.getItem('nucleus:appVersion')
  if (lastVer !== APP_VERSION) {
    localStorage.setItem('nucleus:appVersion', APP_VERSION)
    // Однократный сброс застрявшего из-за бага маршрута '/' на актуальный Планировщик:
    const stale = localStorage.getItem(LAST_PATH_KEY)
    if (!stale || stale === '/' || stale === '/index.html') {
      localStorage.setItem(LAST_PATH_KEY, '/planner')
    }
  }

  const current = window.location.pathname
  const isInitial = current === '/' || current === '/index.html' || current === ''
  if (isInitial) {
    const target = getLastNavPath('/planner')
    if (isValidNavPath(target) && target !== current) {
      window.history.replaceState(null, '', target)
    }
  }
} catch (e) {
  console.warn('[main] navigation pre-init error:', e)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageProvider>
      <ThemeProvider>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    </LanguageProvider>
  </StrictMode>,
)
