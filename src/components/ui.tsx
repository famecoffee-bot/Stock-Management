import type { ReactNode } from 'react'
import { t, tMessage } from '../lib/i18n'

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-bean-900">{title}</h1>
        {subtitle && <p className="text-sm text-stone-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-lg sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-bean-900">{title}</h2>
          <button className="text-2xl leading-none text-stone-400 hover:text-stone-700" onClick={onClose} aria-label={t('Close')}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-stone-400">{hint}</span>}
    </label>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="card py-10 text-center text-sm text-stone-500">{children}</div>
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null
  return <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{message}</div>
}

export function Badge({ children, tone = 'stone' }: { children: ReactNode; tone?: 'stone' | 'green' | 'amber' | 'red' }) {
  const tones = {
    stone: 'bg-stone-100 text-stone-600',
    green: 'bg-green-100 text-green-700',
    amber: 'bg-amber-100 text-amber-700',
    red: 'bg-red-100 text-red-700',
  }
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>
}

/** Turns a Firebase error into a sentence a person can act on. */
export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (msg.includes('permission-denied') || msg.includes('insufficient permissions'))
    return t('You do not have permission to do this. Ask an owner to check your role.')
  if (msg.includes('auth/invalid-credential') || msg.includes('auth/wrong-password'))
    return t('Email or password is not correct.')
  if (msg.includes('auth/too-many-requests')) return t('Too many tries. Wait a few minutes and try again.')
  if (msg.includes('unavailable') || msg.includes('network')) return t('No internet connection. Try again.')
  return tMessage(msg)
}
