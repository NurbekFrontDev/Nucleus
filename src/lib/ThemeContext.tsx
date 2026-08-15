import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

type Theme = 'light' | 'dark' | 'system'
type ThemeCtx = { theme: Theme; toggle: () => void; setTheme: (theme: Theme) => void }

const ThemeContext = createContext<ThemeCtx | undefined>(undefined)

function getInitial(): Theme {
  try {
    const saved = localStorage.getItem('finlit-theme')
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // localStorage может быть недоступен — остаёмся на тёмной теме
  }
  return 'dark'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitial)

  useEffect(() => {
    const applyTheme = (t: Theme) => {
      if (t === 'system') {
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
        document.documentElement.classList.toggle('dark', isDark)
      } else {
        document.documentElement.classList.toggle('dark', t === 'dark')
      }
    }

    applyTheme(theme)
    
    // Add listener for system theme changes if system theme is selected
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => {
      if (theme === 'system') applyTheme('system')
    }
    mediaQuery.addEventListener('change', handleChange)

    try {
      localStorage.setItem('finlit-theme', theme)
    } catch {
      // игнорируем ошибки хранилища
    }
    
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [theme])

  const setTheme = (newTheme: Theme) => {
    if (newTheme === theme) return
    const root = document.documentElement
    root.classList.add('theme-transition')
    setThemeState(newTheme)
    window.setTimeout(() => root.classList.remove('theme-transition'), 360)
  }

  // Плавно переключаем тему: на момент смены навешиваем класс с transition,
  // затем снимаем его, чтобы не замедлять обычные hover-эффекты.
  const toggle = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }

  return (
    <ThemeContext.Provider value={ { theme, toggle, setTheme } }>
      {children}
    </ThemeContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
