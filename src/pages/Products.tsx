import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { orderBy } from 'firebase/firestore'
import { COL } from '../lib/collections'
import { saveDoc, useCollection, useSettings } from '../lib/data'
import { useProfile } from '../lib/auth'
import { isAdmin } from '../lib/permissions'
import { costPercent, recipeCost } from '../lib/sales'
import { PRODUCT_CATEGORIES, type Item, type Product, type ProductSize, type RecipeLine } from '../lib/types'
import { formatKhr, formatQty, formatUsd } from '../lib/units'
import { Badge, Empty, ErrorNote, Field, Modal, PageHeader, friendlyError } from '../components/ui'
import { t } from '../lib/i18n'

// The menu: what you sell, in which sizes, and the recipe for one cup of each size.
// A recipe is what makes "sold 10 Iced Latte L" take beans, milk and cups out of stock.

export function Products() {
  const me = useProfile()
  const admin = isAdmin(me)
  const settings = useSettings()
  const { rows, loading, error } = useCollection<Product>(COL.products, [orderBy('name')])
  const items = useCollection<Item>(COL.items, [orderBy('name')])
  const itemById = useMemo(() => new Map(items.rows.map((i) => [i.id, i])), [items.rows])
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [editing, setEditing] = useState<Partial<Product> | null>(null)

  const list = rows.filter(
    (p) => (showInactive || p.active) && (!search.trim() || p.name.toLowerCase().includes(search.trim().toLowerCase())),
  )
  const missing = rows.filter((p) => p.active && p.sizes.some((s) => !(p.recipes?.[s.key]?.length))).length

  return (
    <>
      <PageHeader
        title={t('Menu and recipes')}
        subtitle={t('What you sell, and what one cup of each size uses')}
        action={
          admin && (
            <button className="btn" onClick={() => setEditing({ active: true, category: PRODUCT_CATEGORIES[0], sizes: SIZE_PRESETS.sml(), recipes: {} })}>
              {t('+ Add product')}
            </button>
          )
        }
      />
      <ErrorNote message={error} />
      {missing > 0 && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t('{missing} product(s) have a size without a recipe. Sales of those can\'t take stock out until the recipe is added.', { missing })}
        </p>
      )}
      <div className="mb-3 flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder={t('Search menu')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="flex items-center gap-2 text-sm text-stone-600">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          {t('Show stopped products')}
        </label>
      </div>
      {!loading && list.length === 0 ? (
        <Empty>
          {rows.length === 0 ? t('No menu yet. Add your drinks and food, then their recipes.') : t('Nothing matches your search.')}
          {items.rows.length === 0 && (
            <>
              {' '}{t('First add your ingredients on the')}{' '}<Link className="underline" to="/items">{t('Items')}</Link>{' '}{t('page.')}
            </>
          )}
        </Empty>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[640px]">
            <thead className="bg-stone-50">
              <tr>
                <th className="th">{t('Product')}</th>
                <th className="th">{t('Size')}</th>
                <th className="th">{t('Recipe (one cup)')}</th>
                <th className="th text-right">{t('Cost')}</th>
                <th className="th text-right">{t('Price')}</th>
                <th className="th text-right">{t('Cost %')}</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) =>
                p.sizes.map((s, i) => {
                  const recipe = p.recipes?.[s.key] ?? []
                  const cost = recipeCost(recipe, itemById)
                  const pct = costPercent(cost, s.priceUsd)
                  return (
                    <tr key={`${p.id}-${s.key}`}>
                      <td className={`td ${i > 0 ? 'border-t-0' : ''}`}>
                        {i === 0 && (
                          <>
                            <div className="font-medium">{p.name}</div>
                            <div className="text-xs text-stone-400">{p.category}{p.groveName && p.groveName !== p.name ? t(' · POS name: {groveName}', { groveName: p.groveName }) : ''}</div>
                            {!p.active && <Badge tone="red">{t('Stopped')}</Badge>}
                          </>
                        )}
                      </td>
                      <td className="td">{p.sizes.length > 1 ? s.label : '—'}</td>
                      <td className="td text-xs text-stone-600">
                        {recipe.length === 0 ? (
                          <Badge tone="amber">{t('No recipe')}</Badge>
                        ) : (
                          recipe.map((r) => {
                            const it = itemById.get(r.itemId)
                            return it ? `${it.name} ${formatQty(r.qty, it.baseUnit)}` : '…'
                          }).join(' · ')
                        )}
                      </td>
                      <td className="td text-right">{recipe.length ? `$${cost.toFixed(3)}` : ''}</td>
                      <td className="td text-right">
                        {s.priceUsd ? formatUsd(s.priceUsd) : '—'}
                        {s.priceUsd ? <div className="text-xs text-stone-400">{formatKhr(s.priceUsd, settings.usdToKhr)}</div> : null}
                      </td>
                      <td className="td text-right">
                        {pct !== null && recipe.length > 0 && <Badge tone={pct > 40 ? 'red' : pct > 33 ? 'amber' : 'green'}>{pct}%</Badge>}
                      </td>
                      <td className="td text-right">
                        {i === 0 && admin && (
                          <button className="text-sm text-bean-700 hover:underline" onClick={() => setEditing(p)}>
                            {t('Edit')}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                }),
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-stone-400">
        {t('Cost uses each ingredient\'s last purchase price. Most coffee shops aim for a cost of 25 to 35% of the selling price.')}
      </p>
      {editing && <ProductForm initial={editing} items={items.rows} onClose={() => setEditing(null)} />}
    </>
  )
}

const SIZE_PRESETS = {
  one: (): ProductSize[] => [{ key: 'one', label: t('One size'), priceUsd: null }],
  sml: (): ProductSize[] => [
    { key: 'S', label: t('Small'), priceUsd: null },
    { key: 'M', label: t('Medium'), priceUsd: null },
    { key: 'L', label: t('Large'), priceUsd: null },
  ],
}

interface DraftLine {
  key: string
  itemId: string
  qty: string
}
let n = 0
const toDraft = (r: RecipeLine): DraftLine => ({ key: `r${++n}`, itemId: r.itemId, qty: String(r.qty) })

function ProductForm({ initial, items, onClose }: { initial: Partial<Product>; items: Item[]; onClose: () => void }) {
  const [p, setP] = useState<Partial<Product>>(initial)
  const [sizes, setSizes] = useState<{ key: string; label: string; price: string }[]>(
    (initial.sizes ?? SIZE_PRESETS.one()).map((s) => ({ key: s.key, label: s.label, price: s.priceUsd == null ? '' : String(s.priceUsd) })),
  )
  const [recipes, setRecipes] = useState<Record<string, DraftLine[]>>(() =>
    Object.fromEntries(Object.entries(initial.recipes ?? {}).map(([k, v]) => [k, v.map(toDraft)])),
  )
  const [tab, setTab] = useState(sizes[0]?.key ?? 'one')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof Product, v: unknown) => setP((x) => ({ ...x, [k]: v }))
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const active = items.filter((i) => i.active)
  const lines = recipes[tab] ?? []
  const setLines = (f: (ls: DraftLine[]) => DraftLine[]) => setRecipes((r) => ({ ...r, [tab]: f(r[tab] ?? []) }))

  function preset(kind: 'one' | 'sml') {
    const next = SIZE_PRESETS[kind]()
    setSizes(next.map((s) => ({ key: s.key, label: s.label, price: '' })))
    setTab(next[0].key)
  }

  function copyFrom(from: string) {
    const src = recipes[from] ?? []
    setRecipes((r) => ({ ...r, [tab]: src.map((l) => ({ ...l, key: `r${++n}` })) }))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const cleanSizes: ProductSize[] = []
    for (const s of sizes) {
      if (!s.label.trim()) return setError(t('Every size needs a name.'))
      const price = s.price.trim() === '' ? null : Number(s.price)
      if (price !== null && !(price >= 0)) return setError(t('{label}: the price must be a number.', { label: s.label }))
      cleanSizes.push({ key: s.key, label: s.label.trim(), priceUsd: price })
    }
    const cleanRecipes: Record<string, RecipeLine[]> = {}
    for (const s of cleanSizes) {
      const out: RecipeLine[] = []
      for (const l of recipes[s.key] ?? []) {
        if (!l.itemId && !l.qty) continue
        const it = itemById.get(l.itemId)
        if (!it) return setError(t('{label}: choose an ingredient on every line, or remove the empty line.', { label: s.label }))
        const q = Number(l.qty)
        if (!(q > 0)) return setError(t('{label}: {name} needs an amount more than 0.', { label: s.label, name: it.name }))
        if (out.some((o) => o.itemId === it.id)) return setError(t('{label}: {name} is listed twice.', { label: s.label, name: it.name }))
        out.push({ itemId: it.id, qty: q })
      }
      if (out.length) cleanRecipes[s.key] = out
    }
    setBusy(true)
    try {
      await saveDoc(COL.products, p.id, {
        name: (p.name ?? '').trim(),
        category: p.category ?? PRODUCT_CATEGORIES[0],
        groveName: (p.groveName ?? '').trim(),
        sizes: cleanSizes,
        recipes: cleanRecipes,
        active: p.active ?? true,
      })
      onClose()
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
    }
  }

  const draftCost = recipeCost(
    lines.filter((l) => itemById.has(l.itemId) && Number(l.qty) > 0).map((l) => ({ itemId: l.itemId, qty: Number(l.qty) })),
    itemById,
  )
  const tabPrice = Number(sizes.find((s) => s.key === tab)?.price) || null
  const pct = costPercent(draftCost, tabPrice)

  return (
    <Modal title={p.id ? t('Edit {name}', { name: p.name }) : t('New product')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <ErrorNote message={error} />
        <Field label={t('Name')}>
          <input className="input" value={p.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder={t('Iced Latte')} maxLength={80} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('Category')}>
            <select className="input" value={p.category} onChange={(e) => set('category', e.target.value)}>
              {PRODUCT_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label={t('Name on the POS (optional)')} hint={t('If grove-system-kh writes it differently')}>
            <input className="input" value={p.groveName ?? ''} onChange={(e) => set('groveName', e.target.value)} />
          </Field>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="label">{t('Sizes and prices (USD)')}</span>
            <span className="flex gap-2 text-xs">
              <button type="button" className="text-bean-700 underline" onClick={() => preset('one')}>{t('One size')}</button>
              <button type="button" className="text-bean-700 underline" onClick={() => preset('sml')}>S / M / L</button>
            </span>
          </div>
          <div className="space-y-2">
            {sizes.map((s, i) => (
              <div key={s.key} className="grid grid-cols-[3rem_1fr_7rem] items-center gap-2">
                <span className="text-center text-xs font-semibold text-stone-400">{s.key}</span>
                <input className="input" value={s.label} onChange={(e) => setSizes((ss) => ss.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} aria-label={t('Size name')} />
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.05"
                  placeholder={t('Price')}
                  value={s.price}
                  onChange={(e) => setSizes((ss) => ss.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))}
                  aria-label={t('{label} price', { label: s.label })}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-stone-200 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-1">
            <span className="label mr-2 mb-0">{t('Recipe for one')}</span>
            {sizes.map((s) => (
              <button key={s.key} type="button" className={s.key === tab ? 'btn px-2 py-1' : 'btn-ghost px-2 py-1'} onClick={() => setTab(s.key)}>
                {s.label}
                {!(recipes[s.key] ?? []).some((l) => l.itemId) && ' ⚠'}
              </button>
            ))}
          </div>
          {lines.length === 0 && sizes.length > 1 && sizes.some((s) => s.key !== tab && (recipes[s.key] ?? []).length) && (
            <div className="mb-2 text-xs text-stone-500">
              {t('Start from:')}{' '}
              {sizes
                .filter((s) => s.key !== tab && (recipes[s.key] ?? []).length)
                .map((s) => (
                  <button key={s.key} type="button" className="mr-2 text-bean-700 underline" onClick={() => copyFrom(s.key)}>
                    {s.label}
                  </button>
                ))}
            </div>
          )}
          <div className="space-y-2">
            {lines.map((l) => {
              const it = itemById.get(l.itemId)
              return (
                <div key={l.key} className="grid grid-cols-[1fr_6rem_2.5rem_1.5rem] items-center gap-2">
                  <select
                    className="input"
                    value={l.itemId}
                    onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, itemId: e.target.value } : x)))}
                    aria-label={t('Ingredient')}
                  >
                    <option value="">{t('Ingredient…')}</option>
                    {active.map((i) => (
                      <option key={i.id} value={i.id} disabled={lines.some((x) => x.key !== l.key && x.itemId === i.id)}>
                        {i.name}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="any"
                    value={l.qty}
                    onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: e.target.value } : x)))}
                    aria-label={t('Amount')}
                  />
                  <span className="text-xs text-stone-500">{it?.baseUnit ?? ''}</span>
                  <button type="button" className="text-lg text-stone-400 hover:text-red-600" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={t('Remove ingredient')}>
                    ×
                  </button>
                </div>
              )
            })}
          </div>
          <div className="mt-2 flex items-center justify-between">
            <button type="button" className="text-sm text-bean-700 hover:underline" onClick={() => setLines((ls) => [...ls, { key: `r${++n}`, itemId: '', qty: '' }])}>
              {t('+ Add ingredient')}
            </button>
            <span className="text-xs text-stone-500">
              {t('Cost of one:')}{' '}<b>${draftCost.toFixed(3)}</b>
              {pct !== null && draftCost > 0 && t(' · {pct}% of price', { pct })}
            </span>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={p.active ?? true} onChange={(e) => set('active', e.target.checked)} />
          {t('On the menu (untick to stop; past sales are kept)')}
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>{t('Cancel')}</button>
          <button className="btn" disabled={busy}>{t('Save')}</button>
        </div>
      </form>
    </Modal>
  )
}

