import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { orderBy } from 'firebase/firestore'
import { COL } from '../lib/collections'
import { saveDoc, useCollection } from '../lib/data'
import { useProfile } from '../lib/auth'
import { isAdmin } from '../lib/permissions'
import type { Item, Supplier } from '../lib/types'
import { Badge, Empty, ErrorNote, Field, Modal, PageHeader, friendlyError } from '../components/ui'
import { t } from '../lib/i18n'

// Suppliers: who you buy from, how to reach them, and which items they sell.
// Admins add and edit them; everyone can look them up.

export function Suppliers() {
  const me = useProfile()
  const admin = isAdmin(me)
  const { rows, loading, error } = useCollection<Supplier>(COL.suppliers, [orderBy('name')])
  const items = useCollection<Item>(COL.items, [orderBy('name')])
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [editing, setEditing] = useState<Partial<Supplier> | null>(null)
  const itemName = useMemo(() => new Map(items.rows.map((i) => [i.id, i.name])), [items.rows])

  const list = useMemo(() => {
    const s = search.trim().toLowerCase()
    return rows.filter(
      (r) =>
        (showInactive || r.active) &&
        (!s ||
          r.name.toLowerCase().includes(s) ||
          (r.contactName ?? '').toLowerCase().includes(s) ||
          (r.itemIds ?? []).some((id) => (itemName.get(id) ?? '').toLowerCase().includes(s))),
    )
  }, [rows, search, showInactive, itemName])

  return (
    <>
      <PageHeader
        title={t('Suppliers')}
        subtitle={t('Who you buy from, how to reach them, and what they sell')}
        action={admin && <button className="btn" onClick={() => setEditing({ active: true, itemIds: [], leadTimeDays: 1 })}>{t('+ Add supplier')}</button>}
      />
      <ErrorNote message={error} />
      <div className="mb-3 flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder={t('Search name, contact or item')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="flex items-center gap-2 text-sm text-stone-600">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          {t('Show stopped suppliers')}
        </label>
      </div>
      {!loading && list.length === 0 ? (
        <Empty>{rows.length === 0 ? t('No suppliers yet. Add the companies and market sellers you buy from.') : t('Nothing matches your search.')}</Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {list.map((s) => (
            <div key={s.id} className="card space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-bean-900">{s.name}</div>
                  <div className="text-xs text-stone-500">
                    {[s.contactName, s.paymentTerms, s.leadTimeDays ? `usually ${s.leadTimeDays} day${s.leadTimeDays === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')}
                  </div>
                </div>
                {!s.active && <Badge tone="red">{t('Stopped')}</Badge>}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {s.phone && <a className="text-bean-700 hover:underline" href={`tel:${s.phone.replace(/\s/g, '')}`}>📞 {s.phone}</a>}
                {s.telegram && (
                  <a className="text-bean-700 hover:underline" href={telegramLink(s.telegram)} target="_blank" rel="noreferrer">
                    ✈️ {s.telegram}
                  </a>
                )}
                {s.email && <a className="text-bean-700 hover:underline" href={`mailto:${s.email}`}>✉️ {s.email}</a>}
              </div>
              {s.itemIds?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {s.itemIds.map((id) => (
                    <Badge key={id}>{itemName.get(id) ?? '…'}</Badge>
                  ))}
                </div>
              )}
              {s.note && <p className="text-xs text-stone-500">{s.note}</p>}
              <div className="flex gap-3 pt-1 text-sm">
                {s.active && (
                  <Link className="text-bean-700 hover:underline" to={`/purchase-orders/new?supplier=${s.id}`}>
                    {t('New order')}
                  </Link>
                )}
                <Link className="text-bean-700 hover:underline" to={`/purchase-orders?supplier=${s.id}`}>
                  {t('Orders')}
                </Link>
                {admin && (
                  <button className="text-bean-700 hover:underline" onClick={() => setEditing(s)}>
                    {t('Edit')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && <SupplierForm initial={editing} items={items.rows} onClose={() => setEditing(null)} />}
    </>
  )
}

/** "@grovebeans" or "012 345 678" -> a link that opens Telegram. */
export function telegramLink(raw: string): string {
  const v = raw.trim()
  if (/^\+?[\d\s-]+$/.test(v)) {
    const digits = v.replace(/[^\d]/g, '')
    // Cambodian numbers written locally (012...) become +855 12...
    return `https://t.me/+${digits.startsWith('0') ? '855' + digits.slice(1) : digits}`
  }
  return `https://t.me/${v.replace(/^@/, '')}`
}

function SupplierForm({ initial, items, onClose }: { initial: Partial<Supplier>; items: Item[]; onClose: () => void }) {
  const [s, setS] = useState<Partial<Supplier>>(initial)
  const [find, setFind] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof Supplier, v: unknown) => setS((x) => ({ ...x, [k]: v }))
  const chosen = new Set(s.itemIds ?? [])
  const toggle = (id: string) => set('itemIds', chosen.has(id) ? [...chosen].filter((x) => x !== id) : [...chosen, id])
  const shown = items.filter((i) => (i.active || chosen.has(i.id)) && i.name.toLowerCase().includes(find.trim().toLowerCase()))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await saveDoc(COL.suppliers, s.id, {
        name: (s.name ?? '').trim(),
        contactName: (s.contactName ?? '').trim(),
        phone: (s.phone ?? '').trim(),
        telegram: (s.telegram ?? '').trim(),
        email: (s.email ?? '').trim(),
        address: (s.address ?? '').trim(),
        paymentTerms: (s.paymentTerms ?? '').trim(),
        leadTimeDays: Math.max(0, Number(s.leadTimeDays) || 0),
        itemIds: s.itemIds ?? [],
        note: (s.note ?? '').trim(),
        active: s.active ?? true,
      })
      onClose()
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
    }
  }

  return (
    <Modal title={s.id ? t('Edit supplier') : t('New supplier')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <ErrorNote message={error} />
        <Field label={t('Name')}>
          <input className="input" value={s.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder={t('Mondulkiri Coffee Co.')} maxLength={80} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('Contact person')}>
            <input className="input" value={s.contactName ?? ''} onChange={(e) => set('contactName', e.target.value)} />
          </Field>
          <Field label={t('Phone')}>
            <input className="input" type="tel" value={s.phone ?? ''} onChange={(e) => set('phone', e.target.value)} placeholder="012 345 678" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('Telegram')} hint={t('@username or phone')}>
            <input className="input" value={s.telegram ?? ''} onChange={(e) => set('telegram', e.target.value)} />
          </Field>
          <Field label={t('Email')}>
            <input className="input" type="email" value={s.email ?? ''} onChange={(e) => set('email', e.target.value)} />
          </Field>
        </div>
        <Field label={t('Address')}>
          <input className="input" value={s.address ?? ''} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('Payment terms')}>
            <input className="input" value={s.paymentTerms ?? ''} onChange={(e) => set('paymentTerms', e.target.value)} placeholder={t('Cash on delivery')} />
          </Field>
          <Field label={t('Days to deliver')}>
            <input className="input" type="number" min="0" value={s.leadTimeDays ?? ''} onChange={(e) => set('leadTimeDays', e.target.value)} />
          </Field>
        </div>
        <div>
          <span className="label">{t('Items they sell ({n})', { n: chosen.size })}</span>
          <input className="input mb-2" placeholder={t('Find item')} value={find} onChange={(e) => setFind(e.target.value)} />
          <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-stone-200 p-2">
            {shown.length === 0 && <div className="text-xs text-stone-400">{t('No items. Add items first on the Items page.')}</div>}
            {shown.map((i) => (
              <label key={i.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={chosen.has(i.id)} onChange={() => toggle(i.id)} />
                {i.name}
                <span className="text-xs text-stone-400">{i.purchaseUnit}</span>
              </label>
            ))}
          </div>
        </div>
        <Field label={t('Note')}>
          <input className="input" value={s.note ?? ''} onChange={(e) => set('note', e.target.value)} placeholder={t('Order before 10 am for next-day delivery')} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={s.active ?? true} onChange={(e) => set('active', e.target.checked)} />
          {t('In use (untick to stop; old orders are kept)')}
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>{t('Cancel')}</button>
          <button className="btn" disabled={busy}>{t('Save')}</button>
        </div>
      </form>
    </Modal>
  )
}
