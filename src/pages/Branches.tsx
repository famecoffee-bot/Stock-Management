import { useState, type FormEvent } from 'react'
import { orderBy } from 'firebase/firestore'
import { COL } from '../lib/collections'
import { saveDoc, useCollection } from '../lib/data'
import { useProfile } from '../lib/auth'
import { isAdmin, visibleBranchIds } from '../lib/permissions'
import type { Branch } from '../lib/types'
import { Badge, Empty, ErrorNote, Field, Modal, PageHeader, friendlyError } from '../components/ui'

export function Branches() {
  const me = useProfile()
  const { rows, loading, error } = useCollection<Branch>(COL.branches, orderBy('code'))
  const [editing, setEditing] = useState<Partial<Branch> | null>(null)
  const visible = new Set(visibleBranchIds(me, rows.map((b) => b.id)))
  const list = rows.filter((b) => visible.has(b.id))

  return (
    <>
      <PageHeader
        title="Branches"
        subtitle={`${list.length} branch${list.length === 1 ? '' : 'es'}`}
        action={isAdmin(me) && <button className="btn" onClick={() => setEditing({ active: true })}>+ Add branch</button>}
      />
      <ErrorNote message={error} />
      {!loading && list.length === 0 ? (
        <Empty>No branches yet.{isAdmin(me) && ' Add your first branch to start.'}</Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((b) => (
            <div key={b.id} className="card">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold text-bean-500">{b.code}</div>
                  <div className="font-medium">{b.name}</div>
                  {b.address && <div className="text-sm text-stone-500">{b.address}</div>}
                  {b.groveBranch && <div className="mt-1 text-xs text-stone-400">POS name: {b.groveBranch}</div>}
                </div>
                {!b.active && <Badge tone="red">Closed</Badge>}
              </div>
              {isAdmin(me) && (
                <button className="btn-ghost mt-3 w-full" onClick={() => setEditing(b)}>
                  Edit
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {editing && <BranchForm initial={editing} onClose={() => setEditing(null)} existing={rows} />}
    </>
  )
}

function BranchForm({ initial, onClose, existing }: { initial: Partial<Branch>; onClose: () => void; existing: Branch[] }) {
  const [b, setB] = useState<Partial<Branch>>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof Branch, v: unknown) => setB((x) => ({ ...x, [k]: v }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    const code = (b.code ?? '').trim().toUpperCase()
    if (existing.some((x) => x.code === code && x.id !== b.id)) {
      setError(`Code ${code} is already used by another branch.`)
      return
    }
    setBusy(true)
    try {
      await saveDoc(COL.branches, b.id, {
        name: (b.name ?? '').trim(),
        code,
        address: (b.address ?? '').trim(),
        groveBranch: (b.groveBranch ?? '').trim(),
        active: b.active ?? true,
      })
      onClose()
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
    }
  }

  return (
    <Modal title={b.id ? 'Edit branch' : 'New branch'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <ErrorNote message={error} />
        <div className="grid grid-cols-3 gap-3">
          <Field label="Code">
            <input className="input uppercase" value={b.code ?? ''} onChange={(e) => set('code', e.target.value)} placeholder="BKK1" maxLength={8} required />
          </Field>
          <div className="col-span-2">
            <Field label="Name">
              <input className="input" value={b.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder="Grove BKK1" required />
            </Field>
          </div>
        </div>
        <Field label="Address">
          <input className="input" value={b.address ?? ''} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <Field label="Name in grove-system-kh" hint="Write it exactly as the POS shows it, so sales can be linked later.">
          <input className="input" value={b.groveBranch ?? ''} onChange={(e) => set('groveBranch', e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={b.active ?? true} onChange={(e) => set('active', e.target.checked)} />
          Open (untick to close a branch; its history is kept)
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy}>Save</button>
        </div>
      </form>
    </Modal>
  )
}
