import { useState, type FormEvent } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useLang } from '../lib/i18n'

const inputCls =
  'rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950'

export default function Login() {
  const { signIn, signUp } = useAuth()
  const { t } = useLang()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setBusy(true)
    const fn = mode === 'signin' ? signIn : signUp
    const { error } = await fn(email, password)
    setBusy(false)
    if (error) {
      setError(error)
      return
    }
    if (mode === 'signup') {
      setInfo(t('login.created'))
      setMode('signin')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500 text-3xl shadow-lg shadow-emerald-500/30">
            💰
          </span>
          <h1 className="text-2xl font-semibold">FinLit</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('login.tagline')}</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900/50"
        >
          <div className="flex flex-col gap-1">
            <label className="text-sm text-neutral-500 dark:text-neutral-400">{t('login.email')}</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputCls}
              placeholder="you@example.com"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm text-neutral-500 dark:text-neutral-400">{t('login.password')}</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputCls}
              placeholder="••••••"
            />
          </div>

          {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}
          {info && <p className="text-sm text-emerald-600 dark:text-emerald-400">{info}</p>}

          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-emerald-500 px-4 py-2.5 font-medium text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-60"
          >
            {busy ? t('login.wait') : mode === 'signin' ? t('login.signin') : t('login.signup')}
          </button>

          <button
            type="button"
            onClick={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin')
              setError(null)
              setInfo(null)
            }}
            className="text-sm text-neutral-500 transition hover:text-emerald-600 dark:text-neutral-400 dark:hover:text-emerald-400"
          >
            {mode === 'signin' ? t('login.toSignup') : t('login.toSignin')}
          </button>
        </form>
      </div>
    </div>
  )
}
