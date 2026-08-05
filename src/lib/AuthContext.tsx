import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'
import { supabase, syncOfflineChanges } from './supabase'
import { setOfflineUser, startOfflineSync } from './offlineSync'

type AuthContextType = {
  session: Session | null
  user: User | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    // Без сети getSession в некоторых WebView мог зависнуть или упасть, оставляя
    // приложение навсегда на экране загрузки. Локальная сессия остаётся best effort,
    // но загрузка интерфейса всегда заканчивается.
    ;(async () => {
      try {
        // У Auth нет гарантированного сетевого таймаута. Через 3 секунды всё равно
        // открываем приложение: сохранённая сессия подхватится при следующем событии Auth.
        const sessionRequest = supabase.auth.getSession()
        // Даже если стартовый таймаут сработал, поздний ответ всё равно применяем.
        // Так медленное нативное хранилище не разлогинивает пользователя.
        void sessionRequest
          .then(({ data }) => {
            if (active) setSession(data.session)
          })
          .catch(() => {
            // На старте без сети остаёмся в безопасном состоянии без сессии.
          })
        const result = await Promise.race([
          sessionRequest,
          new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 3_000)),
        ])
        if (active && result) setSession(result.data.session)
      } catch {
        if (active) setSession(null)
      } finally {
        if (active) setLoading(false)
      }
    })()

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        if (!active) return
        setSession(newSession)
        setLoading(false)
      },
    )

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  // Привязываем кэш и очередь к текущему пользователю. Когда сеть появляется,
  // очередь отправляется с новым токеном и не может уйти в чужой аккаунт.
  useEffect(() => {
    const userId = session?.user.id ?? null
    setOfflineUser(userId)
    if (!userId) return
    return startOfflineSync(syncOfflineChanges)
  }, [session?.user.id])

  // Фикс бага: после возврата в приложение (на телефоне было свёрнуто несколько
  // минут) принудительно перечитываем сессию из хранилища. WebView иногда теряет
  // состояние в памяти, и без этого показывался экран входа, хотя токен ещё валиден.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let handle: { remove: () => void } | undefined
    ;(async () => {
      try {
        const { App } = await import('@capacitor/app')
        const h = await App.addListener('resume', async () => {
          try {
            const { data } = await supabase.auth.getSession()
            if (data.session) setSession(data.session)
          } catch {
            // не критично
          }
        })
        handle = h
      } catch {
        // не критично
      }
    })()
    return () => handle?.remove()
  }, [])

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  }

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password })
    return { error: error?.message ?? null }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  const value: AuthContextType = {
    session,
    user: session?.user ?? null,
    loading,
    signIn,
    signUp,
    signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth должен использоваться внутри AuthProvider')
  return ctx
}
