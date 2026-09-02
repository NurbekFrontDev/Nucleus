import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'
import { supabase, syncOfflineChanges } from './supabase'
import { setOfflineUser, startOfflineSync } from './offlineSync'

type AuthContextType = {
  session: Session | null
  user: User | { id: string; email: string } | null
  isOffline: boolean
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (email: string, password: string, name?: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [offlineUser, setOfflineUserFallback] = useState<{ id: string; email: string } | null>(null)
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
            if (active) {
              setSession(data.session)
              if (data.session?.user) {
                localStorage.setItem('nucleus:offlineUserId', data.session.user.id)
                if (data.session.user.email) {
                  localStorage.setItem('nucleus:offlineEmail', data.session.user.email)
                }
              }
            }
          })
          .catch(() => {
            // На старте без сети остаёмся в безопасном состоянии без сессии.
          })
        const result = await Promise.race([
          sessionRequest,
          new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 3_000)),
        ])
        if (active && result) {
          setSession(result.data.session)
          if (result.data.session?.user) {
            localStorage.setItem('nucleus:offlineUserId', result.data.session.user.id)
            if (result.data.session.user.email) {
              localStorage.setItem('nucleus:offlineEmail', result.data.session.user.email)
            }
          }
        } else if (active && !result) {
          const cachedUserId = localStorage.getItem('nucleus:offlineUserId')
          const cachedEmail = localStorage.getItem('nucleus:offlineEmail')
          if (cachedUserId) {
            setOfflineUserFallback({ id: cachedUserId, email: cachedEmail || '' })
          }
        }
      } catch {
        if (active) {
          setSession(null)
          const cachedUserId = localStorage.getItem('nucleus:offlineUserId')
          const cachedEmail = localStorage.getItem('nucleus:offlineEmail')
          if (cachedUserId) {
            setOfflineUserFallback({ id: cachedUserId, email: cachedEmail || '' })
          }
        }
      } finally {
        if (active) setLoading(false)
      }
    })()

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        if (!active) return
        setSession(newSession)
        if (newSession?.user) {
          localStorage.setItem('nucleus:offlineUserId', newSession.user.id)
          if (newSession.user.email) {
            localStorage.setItem('nucleus:offlineEmail', newSession.user.email)
          }
          setOfflineUserFallback(null)
          
          const pendingName = localStorage.getItem('nucleus:pendingName')
          const metaName =
            (newSession.user.user_metadata?.user_name as string | undefined) ||
            (newSession.user.user_metadata?.full_name as string | undefined) ||
            (newSession.user.user_metadata?.name as string | undefined)
          const resolvedName =
            (pendingName && pendingName.trim()) || (metaName && metaName.trim()) || null

          if (resolvedName) {
            localStorage.setItem('nucleus:userName:' + newSession.user.id, resolvedName)
            void (async () => {
              try {
                await supabase.from('app_settings').upsert(
                  { user_id: newSession.user.id, user_name: resolvedName, updated_at: new Date().toISOString() },
                  { onConflict: 'user_id' },
                )
                if (pendingName) localStorage.removeItem('nucleus:pendingName')
              } catch {
                // не критично
              }
            })()
          }
        }
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
    const userId = session?.user.id ?? offlineUser?.id ?? null
    setOfflineUser(userId)
    if (!userId) return
    return startOfflineSync(syncOfflineChanges)
  }, [session?.user.id, offlineUser?.id])

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

  const signUp = async (email: string, password: string, name?: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: name ? { user_name: name, full_name: name, name } : undefined,
      },
    })
    if (!error && data.user && name) {
      try {
        await supabase.from('app_settings').upsert(
          { user_id: data.user.id, user_name: name, updated_at: new Date().toISOString() },
          { onConflict: 'user_id' },
        )
      } catch {
        // не критично
      }
    }
    return { error: error?.message ?? null }
  }

  const signOut = async () => {
    localStorage.removeItem('nucleus:offlineUserId')
    localStorage.removeItem('nucleus:offlineEmail')
    setOfflineUserFallback(null)
    await supabase.auth.signOut()
  }

  const value: AuthContextType = {
    session,
    user: session?.user ?? offlineUser,
    isOffline: !session && !!offlineUser,
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
