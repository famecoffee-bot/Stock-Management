import { useMemo, useState, type FormEvent } from 'react'
import { orderBy } from 'firebase/firestore'
import { COL } from '../lib/collections'
import { saveDoc, useCollection, useSettings } from '../lib/data'
import { useProfile } from '../lib/auth'
import { isAdmin } from '../lib/permissions'
import type { Item } from '../lib/types'
import { BASE_UNITS, costPerBase, formatKhr, formatQty, formatUsd, type BaseUnit } from '../lib/units'
import { Badge, Empty, ErrorNote, Field, Modal, PageHeader, friendlyError } from '../components/ui'
import { t } from '../lib/i18n'

export function Items() {
  const me = useProfile()
  const settings = useSettings()
  const { rows, loading, error } = useCollection<Item>(COL.items, [orderBy('name')])
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [editing, setEditing] = useState<Partial<Item> | null>(null)

  const list = useMemo(() => {
    const s = search.trim().toLowerCase()
    return rows.filter(
      (i) =>
        (showInactive || i.active) &&
        (!category || i.category === category) &&
        (!s || i.name.toLowerCase().includes(s) || (i.sku ?? '').toLowerCase().includes(s)),
    )
  }, [rows, search, category, showInactive])

  return (
    <>
      <PageHeader
        title={t('Items')}
        subtitle={t('Ingredients and supplies you keep in stock')}
        action={
          isAdmin(me) && (
            <button className="btn" onClick={() => setEditing({ active: true, baseUnit: 'g', unitsPerPurchase: 1000, category: settings.categories[0] })}>
              {t('+ Add item')}
            </button>
          )
        }
      />
      <ErrorNote message={error} />
      <div className="mb-3 flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder={t('Search name or SKU')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input max-w-[12rem]" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">{t('All categories')}</option>
          {settings.categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-stone-600">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          {t('Show stopped items')}
        </label>
      </div>

      {!loading && list.length === 0 ? (
        <Empty>{rows.length === 0 ? t('No items yet. Add coffee beans, milk, cups…') : t('Nothing matches your search.')}</Empty>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[640px]">
            <thead className="bg-stone-50">
              <tr>
                <th className="th">{t('Item')}</th>
                <th className="th">{t('Category')}</th>
                <th className="th">{t('Buy as')}</th>
                <th className="th text-right">{t('Last cost')}</th>
                <th className="th text-right">{t('Cost per unit')}</th>
                <th className="th text-right">{t('Reorder at')}</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {list.map((i) => {
                const per = costPerBase(i.lastCostUsd, i.unitsPerPurchase)
                return (
                  <tr key={i.id}>
                    <td className="td">
                      <div className="font-medium">{i.name}</div>
                      <div className="text-xs text-stone-400">
                        {i.sku && `${i.sku} · `}{t('stored in')}{' '}{i.baseUnit}
                        {i.perishable && ' · ' + t('perishable')}
                      </div>
                      {!i.active && <Badge tone="red">{t('Stopped')}</Badge>}
                    </td>
                    <td className="td">{i.category}</td>
                    <td className="td">
                      {i.purchaseUnit} <span className="text-xs text-stone-400">({formatQty(i.unitsPerPurchase, i.baseUnit)})</span>
                    </td>
                    <td className="td text-right">
                      {formatUsd(i.lastCostUsd)}
                      <div className="text-xs text-stone-400">{formatKhr(i.lastCostUsd, settings.usdToKhr)}</div>
                    </td>
                    <td className="td text-right text-xs text-stone-600">
                      ${per.toFixed(4)} / {i.baseUnit}
                    </td>
                    <td className="td text-right">{formatQty(i.defaultReorderPoint, i.baseUnit)}</td>
                    <td className="td text-right">
                      {isAdmin(me) && (
                        <button className="text-sm text-bean-700 hover:underline" onClick={() => setEditing(i)}>
                          {t('Edit')}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && <ItemForm initial={editing} categories={settings.categories} onClose={() => setEditing(null)} />}
    </>
  )
}

function ItemForm({ initial, categories, onClose }: { initial: Partial<Item>; categories: string[]; onClose: () => void }) {
  const [it, setIt] = useState<Partial<Item>>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof Item, v: unknown) => setIt((x) => ({ ...x, [k]: v }))
  const unit = (it.baseUnit ?? 'g') as BaseUnit

  async function submit(e: FormEvent) {
    e.preventDefault()
    const upp = Number(it.unitsPerPurchase)
    if (!(upp > 0)) {
      setError(t('"Units in one purchase" must be more than 0.'))
      return
    }
    setBusy(true)
    try {
      await saveDoc(COL.items, it.id, {
        name: (it.name ?? '').trim(),
        sku: (it.sku ?? '').trim(),
        category: it.category ?? categories[0],
        baseUnit: unit,
        purchaseUnit: (it.purchaseUnit ?? '').trim(),
        unitsPerPurchase: upp,
        lastCostUsd: Number(it.lastCostUsd) || 0,
        perishable: !!it.perishable,
        shelfLifeDays: it.perishable ? Number(it.shelfLifeDays) || 0 : 0,
        defaultReorderPoint: Number(it.defaultReorderPoint) || 0,
        active: it.active ?? true,
      })
      onClose()
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
    }
  }

  return (
    <Modal title={it.id ? t('Edit item') : t('New item')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <ErrorNote message={error} />
        <Field label={t('Name')}>
          <input className="input" value={it.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder={t('Arabica beans')} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('SKU (optional)')}>
            <input className="input" value={it.sku ?? ''} onChange={(e) => set('sku', e.target.value)} />
          </Field>
          <Field label={t('Category')}>
            <select className="input" value={it.category} onChange={(e) => set('category', e.target.value)}>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label={t('Count it in')} hint={t('Every quantity of this item is saved in this unit.')}>
          <select className="input" value={unit} onChange={(e) => set('baseUnit', e.target.value)}>
            {BASE_UNITS.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('Supplier sells it as')}>
            <input className="input" value={it.purchaseUnit ?? ''} onChange={(e) => set('purchaseUnit', e.target.value)} placeholder={t('bag 1 kg')} required />
          </Field>
          <Field label={t('{unit} in one of those', { unit })}>
            <input className="input" type="number" min="0" step="any" value={it.unitsPerPurchase ?? ''} onChange={(e) => set('unitsPerPurchase', e.target.value)} required />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('Last cost (USD, per purchase unit)')}>
            <input className="input" type="number" min="0" step="0.01" value={it.lastCostUsd ?? ''} onChange={(e) => set('lastCostUsd', e.target.value)} />
          </Field>
          <Field label={t('Reorder when below ({unit})', { unit })}>
            <input className="input" type="number" min="0" step="any" value={it.defaultReorderPoint ?? ''} onChange={(e) => set('defaultReorderPoint', e.target.value)} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!it.perishable} onChange={(e) => set('perishable', e.target.checked)} />
          {t('Perishable (has an expiry date)')}
        </label>
        {it.perishable && (
          <Field label={t('Usual shelf life (days)')}>
            <input className="input" type="number" min="0" value={it.shelfLifeDays ?? ''} onChange={(e) => set('shelfLifeDays', e.target.value)} />
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={it.active ?? true} onChange={(e) => set('active', e.target.checked)} />
          {t('In use (untick to stop using; history is kept)')}
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>{t('Cancel')}</button>
          <button className="btn" disabled={busy}>{t('Save')}</button>
        </div>
      </form>
    </Modal>
  )
}
