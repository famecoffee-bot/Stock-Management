import { useState, type FormEvent } from 'react'
import { orderBy } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { COL } from '../lib/collections'
import { functions } from '../lib/firebase'
import { saveDoc, useCollection } from '../lib/data'
import { useProfile } from '../lib/auth'
import { canAssignRole, isOwner } from '../lib/permissions'
import type { Branch, BranchRole, InvUser, Role } from '../lib/types'
import { Badge, ErrorNote, Field, Modal, PageHeader, friendlyError } from '../components/ui'
import { t } from '../lib/i18n'

const ROLE_TEXT: Record<Role, string> = {
  owner: t('Owner: everything, all branches'),
  admin: t('Admin: everything except managing owners'),
  member: t('Member: only the branches ticked below'),
}
const BRANCH_ROLE_TEXT: Record<BranchRole, string> = {
  manager: t('Manager'),
  staff: t('Staff'),
  viewer: t('Viewer'),
}

export function Users() {
  const me = useProfile()
  const users = useCollection<InvUser>(COL.users, [orderBy('name')])
  const branches = useCollection<Branch>(COL.branches, [orderBy('code')])
  const [editing, setEditing] = useState<Partial<InvUser> | null>(null)
  const branchName = (id: string) => branches.rows.find((b) => b.id === id)?.code ?? '?'

  return (
    <>
      <PageHeader
        title={t('Users')}
        subtitle={t('Who can use the stock app, and what they can do')}
        action={<button className="btn" onClick={() => setEditing({ role: 'member', branchRoles: {}, active: true })}>{t('+ Add user')}</button>}
      />
      <ErrorNote message={users.error} />
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[560px]">
          <thead className="bg-stone-50">
            <tr>
              <th className="th">{t('Name')}</th>
              <th className="th">{t('Role')}</th>
              <th className="th">{t('Branches')}</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody>
            {users.rows.map((u) => (
              <tr key={u.id}>
                <td className="td">
                  <div className="font-medium">{u.name}</div>
                  <div className="text-xs text-stone-400">{u.email}</div>
                </td>
                <td className="td">
                  <Badge tone={u.role === 'member' ? 'stone' : 'amber'}>{u.role}</Badge> {!u.active && <Badge tone="red">{t('Blocked')}</Badge>}
                </td>
                <td className="td text-xs">
                  {u.role === 'member'
                    ? Object.entries(u.branchRoles ?? {})
                        .map(([b, r]) => `${branchName(b)} (${r})`)
                        .join(', ') || t('none')
                    : t('all')}
                </td>
                <td className="td text-right">
                  {canAssignRole(me, u.role) && u.id !== me.id && (
                    <button className="text-sm text-bean-700 hover:underline" onClick={() => setEditing(u)}>
                      {t('Edit')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <UserForm initial={editing} branches={branches.rows} canMakeOwner={isOwner(me)} onClose={() => setEditing(null)} />}
    </>
  )
}

function UserForm({
  initial,
  branches,
  canMakeOwner,
  onClose,
}: {
  initial: Partial<InvUser>
  branches: Branch[]
  canMakeOwner: boolean
  onClose: () => void
}) {
  const isNew = !initial.id
  const [u, setU] = useState<Partial<InvUser>>(initial)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const roles: Role[] = canMakeOwner ? ['owner', 'admin', 'member'] : ['admin', 'member']

  function setBranchRole(branchId: string, role: BranchRole | '') {
    setU((x) => {
      const next = { ...(x.branchRoles ?? {}) }
      if (role) next[branchId] = role
      else delete next[branchId]
      return { ...x, branchRoles: next }
    })
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const data = {
      name: (u.name ?? '').trim(),
      role: u.role ?? 'member',
      branchRoles: u.role === 'member' ? (u.branchRoles ?? {}) : {},
      active: u.active ?? true,
    }
    try {
      if (isNew) {
        // Creating a login needs the server (Cloud Function), so the owner stays signed in.
        await httpsCallable(functions, 'invCreateUser')({ ...data, email: (u.email ?? '').trim(), password })
      } else {
        await saveDoc(COL.users, u.id, data)
        if (password) await httpsCallable(functions, 'invSetPassword')({ uid: u.id, password })
      }
      setDone(isNew ? t('Done. Give {name} their email and password.', { name: data.name }) : t('Saved.'))
      setTimeout(onClose, 1200)
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
    }
  }

  return (
    <Modal title={isNew ? t('New user') : t('Edit {name}', { name: initial.name })} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <ErrorNote message={error} />
        {done && <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{done}</div>}
        <Field label={t('Name')}>
          <input className="input" value={u.name ?? ''} onChange={(e) => setU({ ...u, name: e.target.value })} required />
        </Field>
        {isNew && (
          <Field label={t('Email (used to sign in)')}>
            <input className="input" type="email" value={u.email ?? ''} onChange={(e) => setU({ ...u, email: e.target.value })} required />
          </Field>
        )}
        <Field label={isNew ? t('Password') : t('New password (leave empty to keep)')} hint={t('At least 8 characters.')}>
          <input className="input" type="text" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required={isNew} />
        </Field>
        <Field label={t('Role')}>
          <select className="input" value={u.role} onChange={(e) => setU({ ...u, role: e.target.value as Role })}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_TEXT[r]}
              </option>
            ))}
          </select>
        </Field>
        {u.role === 'member' && (
          <div>
            <span className="label">{t('Branches')}</span>
            <div className="space-y-1">
              {branches.map((b) => (
                <div key={b.id} className="flex items-center justify-between gap-2 rounded-lg border border-stone-200 px-3 py-1.5">
                  <span className="text-sm">
                    <b>{b.code}</b> {b.name}
                  </span>
                  <select
                    className="rounded border border-stone-300 px-2 py-1 text-sm"
                    value={u.branchRoles?.[b.id] ?? ''}
                    onChange={(e) => setBranchRole(b.id, e.target.value as BranchRole | '')}
                  >
                    <option value="">{t('No access')}</option>
                    {(Object.keys(BRANCH_ROLE_TEXT) as BranchRole[]).map((r) => (
                      <option key={r} value={r}>
                        {BRANCH_ROLE_TEXT[r]}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              {branches.length === 0 && <p className="text-sm text-stone-500">{t('Add branches first.')}</p>}
            </div>
          </div>
        )}
        {!isNew && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={u.active ?? true} onChange={(e) => setU({ ...u, active: e.target.checked })} />
            {t('Can sign in (untick to block)')}
          </label>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>{t('Cancel')}</button>
          <button className="btn" disabled={busy}>{t('Save')}</button>
        </div>
      </form>
    </Modal>
  )
}
