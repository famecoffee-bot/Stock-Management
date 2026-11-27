import { useState, type FormEvent } from 'react'
import { orderBy } from 'firebase/firestore'
import { COL } from '../lib/collections'
import { saveDoc, useCollection } from '../lib/data'
import { useProfile } from '../lib/auth'
import { isAdmin, visibleBranchIds } from '../lib/permissions'
import { isWarehouse, type Branch } from '../lib/types'
import { countDue } from '../lib/counts'
import { Badge, Empty, ErrorNote, Field, Modal, PageHeader, friendlyError } from '../components/ui'
import { dateLocale, t } from '../lib/i18n'

const DUE_TONE = { ok: 'green', due: 'amber', overdue: 'red', never: 'stone' } as const

/** "Weekly count: 3 days ago" with a colour for ok / due / overdue. */
export function CountDueBadge({ b, period }: { b: Branch; period: 'weekly' | 'monthly' }) {
  const last = b.lastCounts?.[period]?.toDate()
  const d = countDue(period, last)
  const label = period === 'weekly' ? t('Weekly') : t('Monthly')
  const text = d.state === 'never' ? t('never') : d.state === 'ok' ? last!.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' }) : d.state === 'due' ? t('due') : t('overdue')
  return <Badge tone={DUE_TONE[d.state]}>{label}: {text}</Badge>
}

export function Branches() {
  const me = useProfile()
  const { rows, loading, error } = useCollection<Branch>(COL.branches, [orderBy('code')])
  const [editing, setEditing] = useState<Partial<Branch> | null>(null)
  const visible = new Set(visibleBranchIds(me, rows.map((b) => b.id)))
  const list = rows.filter((b) => visible.has(b.id)).sort((a, b) => Number(isWarehouse(b)) - Number(isWarehouse(a)))
  const byId = new Map(rows.map((b) => [b.id, b]))

  return (
    <>
      <PageHeader
        title={t('Branches')}
        subtitle={list.length === 1 ? t('1 branch') : t('{n} branches', { n: list.length })}
        action={isAdmin(me) && <button className="btn" onClick={() => setEditing({ active: true })}>{t('+ Add branch')}</button>}
      />
      <ErrorNote message={error} />
      {!loading && list.length === 0 ? (
        <Empty>{t('No branches yet.')}{isAdmin(me) && ' ' + t('Add your first branch to start.')}</Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((b) => (
            <div key={b.id} className="card">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold text-bean-500">{b.code}</div>
                  <div className="font-medium">{b.name}</div>
                  {b.address && <div className="text-sm text-stone-500">{b.address}</div>}
                  {!isWarehouse(b) && b.supplyFromId && byId.get(b.supplyFromId) && (
                    <div className="mt-1 text-xs text-stone-500">{t('Orders from: {name}', { name: byId.get(b.supplyFromId)!.name })}</div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1">
                    <CountDueBadge b={b} period="weekly" />
                    <CountDueBadge b={b} period="monthly" />
                  </div>
                  {b.groveBranch && <div className="mt-1 text-xs text-stone-400">{t('POS name:')}{' '}{b.groveBranch}</div>}
                </div>
                <div className="flex flex-col items-end gap-1">
                  {isWarehouse(b) && <Badge tone="amber">{t('Main warehouse')}</Badge>}
                  {!b.active && <Badge tone="red">{t('Closed')}</Badge>}
                </div>
              </div>
              {isAdmin(me) && (
                <button className="btn-ghost mt-3 w-full" onClick={() => setEditing(b)}>
                  {t('Edit')}
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
  const warehouses = existing.filter((x) => isWarehouse(x) && x.active && x.id !== b.id)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const code = (b.code ?? '').trim().toUpperCase()
    if (existing.some((x) => x.code === code && x.id !== b.id)) {
      setError(t('Code {code} is already used by another branch.', { code }))
      return
    }
    setBusy(true)
    try {
      await saveDoc(COL.branches, b.id, {
        name: (b.name ?? '').trim(),
        code,
        address: (b.address ?? '').trim(),
        groveBranch: (b.groveBranch ?? '').trim(),
        kind: b.kind ?? 'branch',
        supplyFromId: b.kind === 'warehouse' ? '' : (b.supplyFromId ?? ''),
        active: b.active ?? true,
      })
      onClose()
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
    }
  }

  return (
    <Modal title={b.id ? t('Edit branch') : t('New branch')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <ErrorNote message={error} />
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('Code')}>
            <input className="input uppercase" value={b.code ?? ''} onChange={(e) => set('code', e.target.value)} placeholder={t('BKK1')} maxLength={8} required />
          </Field>
          <div className="col-span-2">
            <Field label={t('Name')}>
              <input className="input" value={b.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder={t('Grove BKK1')} required />
            </Field>
          </div>
        </div>
        <Field label={t('Type')} hint={t('The main warehouse (big stock) keeps stock for all branches. Branches send it a daily order.')}>
          <select className="input" value={b.kind ?? 'branch'} onChange={(e) => set('kind', e.target.value)}>
            <option value="branch">{t('Branch (shop)')}</option>
            <option value="warehouse">{t('Main warehouse')}</option>
          </select>
        </Field>
        {(b.kind ?? 'branch') === 'branch' && warehouses.length > 0 && (
          <Field label={t('Daily orders go to')}>
            <select className="input" value={b.supplyFromId ?? ''} onChange={(e) => set('supplyFromId', e.target.value)}>
              <option value="">{t('Choose…')}</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label={t('Address')}>
          <input className="input" value={b.address ?? ''} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <Field label={t('Name in grove-system-kh')} hint={t('Write it exactly as the POS shows it, so sales can be linked later.')}>
          <input className="input" value={b.groveBranch ?? ''} onChange={(e) => set('groveBranch', e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={b.active ?? true} onChange={(e) => set('active', e.target.checked)} />
          {t('Open (untick to close a branch; its history is kept)')}
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>{t('Cancel')}</button>
          <button className="btn" disabled={busy}>{t('Save')}</button>
        </div>
      </form>
    </Modal>
  )
}
