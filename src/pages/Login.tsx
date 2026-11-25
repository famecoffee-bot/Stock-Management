import { useState, type FormEvent } from 'react'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { auth, isTrial } from '../lib/firebase'
import { claimOwner, logout, useAuth } from '../lib/auth'
import { ErrorNote, Field, friendlyError } from '../components/ui'
import { LanguageSwitch, t } from '../lib/i18n'

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Centered>
      <form onSubmit={submit} className="space-y-4">
        <ErrorNote message={error} />
        <Field label={t('Email')}>
          <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label={t('Password')}>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <button className="btn w-full" disabled={busy}>
          {busy ? t('Signing in…') : t('Sign in')}
        </button>
        {isTrial && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {t('Test version. Practice logins (password')}{' '}<b>{t('practice123')}</b>{t('): owner@grove.kh (owner), vanna@grove.kh (manager, Riverside), dara@grove.kh (staff, Riverside).')}
          </p>
        )}
      </form>
    </Centered>
  )
}

/** Signed in, but no stock profile yet. */
export function NoProfile() {
  const s = useAuth()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (s.status !== 'noProfile') return null

  async function claim(e: FormEvent) {
    e.preventDefault()
    if (s.status !== 'noProfile') return
    setBusy(true)
    try {
      await claimOwner(name.trim())
    } catch (err) {
      const m = friendlyError(err)
      setError(m.startsWith('You do not have permission') ? t('Only emails on the grove-system-kh owner list can do this.') : m)
      setBusy(false)
    }
  }

  return (
    <Centered>
      <p className="mb-4 text-sm text-stone-600">
        {t('You are signed in as')}{' '}<b>{s.user.email}</b>{t(', but you do not have access to the stock app yet. Staff: ask an owner to add you.')}
      </p>
      <form onSubmit={claim} className="space-y-3 rounded-lg bg-bean-50 p-3">
        <p className="text-sm text-stone-600">{t('Owner of grove-system-kh? Set up your owner profile:')}</p>
        <ErrorNote message={error} />
        <Field label={t('Your name')}>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <button className="btn w-full" disabled={busy}>
          {t('Create owner profile')}
        </button>
      </form>
      <button className="btn-ghost mt-4 w-full" onClick={logout}>
        {t('Sign out')}
      </button>
    </Centered>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm">
        <div className="mb-3 flex justify-end">
          <LanguageSwitch />
        </div>
        <h1 className="mb-1 text-xl font-semibold text-bean-900">{t('Grove Stock')}</h1>
        <p className="mb-5 text-sm text-stone-500">{t('Stock management for Grove Coffee')}</p>
        {children}
      </div>
    </div>
  )
}
