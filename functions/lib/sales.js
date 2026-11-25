// Recipes and sales maths, kept free of Firebase so it can be tested on its own
// (functions/test/sales.test.js).
//
// A product (Iced Latte) has sizes (S, M, L). Each size has a recipe: the
// ingredients ONE cup uses, in base units (g, ml, pcs). Selling 10 Iced Latte L
// takes 10 x that recipe out of the branch's stock.

const ID = /^[A-Za-z0-9_-]{1,64}$/
const KEY = /^[A-Za-z0-9_-]{1,120}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d

export const SALE_SOURCES = ['manual', 'import', 'grove']

/**
 * Check a batch of sales someone sent (end-of-day numbers, or a CSV import).
 * The same product and size on two lines are added together.
 * @returns {{error:string} | {value:{branchId:string, date:string, source:string, key:string|null, note:string, lines:Array<{productId:string, sizeKey:string, qty:number}>}}}
 */
export function checkSaleInput(raw) {
  const d = raw ?? {}
  if (typeof d.branchId !== 'string' || !ID.test(d.branchId)) return { error: 'Choose a branch.' }
  if (typeof d.date !== 'string' || !DATE.test(d.date)) return { error: 'Choose the day these sales are for.' }
  const source = d.source ?? 'manual'
  if (!SALE_SOURCES.includes(source)) return { error: 'Unknown source.' }
  let key = null
  if (d.key !== undefined && d.key !== null && d.key !== '') {
    if (typeof d.key !== 'string' || !KEY.test(d.key)) return { error: 'Bad import key.' }
    key = d.key
  }
  const note = typeof d.note === 'string' ? d.note.trim().slice(0, 300) : ''
  if (!Array.isArray(d.lines) || d.lines.length === 0) return { error: 'Enter at least one sale.' }
  if (d.lines.length > 300) return { error: 'Too many lines (max 300).' }
  const merged = new Map()
  for (const l of d.lines) {
    const productId = typeof l?.productId === 'string' ? l.productId : ''
    const sizeKey = typeof l?.sizeKey === 'string' ? l.sizeKey : ''
    if (!ID.test(productId) || !ID.test(sizeKey)) return { error: 'Unknown product or size.' }
    const qty = Number(l.qty)
    if (!Number.isFinite(qty) || qty <= 0) return { error: 'Every line needs a number sold, more than 0.' }
    if (qty > 100000) return { error: 'That number sold looks too big. Check it.' }
    const k = `${productId}|${sizeKey}`
    merged.set(k, { productId, sizeKey, qty: round((merged.get(k)?.qty ?? 0) + qty) })
  }
  return { value: { branchId: d.branchId, date: d.date, source, key, note, lines: [...merged.values()] } }
}

/**
 * Turn sold cups into ingredients used.
 * @param lines [{productId, sizeKey, qty}]
 * @param products {productId: product}
 * @returns {{error:string} | {lines:Array, usage:Map<string, number>}}
 *   lines: each sale line with names and its recipe; usage: itemId -> total base units used
 */
export function explodeSale(lines, products) {
  const usage = new Map()
  const out = []
  const missing = []
  for (const l of lines) {
    const p = products[l.productId]
    if (!p) return { error: 'A product on the list does not exist.' }
    const size = (p.sizes ?? []).find((s) => s.key === l.sizeKey)
    if (!size) return { error: `${p.name}: unknown size.` }
    const recipe = (p.recipes ?? {})[l.sizeKey] ?? []
    const label = sizeName(p, size)
    if (recipe.length === 0) {
      missing.push(label)
      continue
    }
    // recipes are typed by people; never trust them blindly (a negative amount would ADD stock)
    const bad = checkRecipe(recipe)
    if (bad) return { error: `${label}: ${bad}` }
    for (const r of recipe) usage.set(r.itemId, round((usage.get(r.itemId) ?? 0) + r.qty * l.qty))
    out.push({ ...l, productName: p.name, sizeLabel: size.label, priceUsd: size.priceUsd ?? null, recipe })
  }
  if (missing.length) return { error: `No recipe yet for: ${missing.join(', ')}. Add it on the Menu page first.` }
  return { lines: out, usage }
}

/** "Iced Latte (L)", or just "Iced Latte" when it has one size. */
export function sizeName(p, size) {
  return (p.sizes ?? []).length > 1 ? `${p.name} (${size.label})` : p.name
}

/** Check one size's recipe: known ingredients, each once, each with an amount more than 0. */
export function checkRecipe(recipe) {
  if (!Array.isArray(recipe)) return 'Recipe must be a list.'
  const seen = new Set()
  for (const r of recipe) {
    if (!ID.test(r?.itemId ?? '')) return 'Unknown ingredient.'
    if (seen.has(r.itemId)) return 'An ingredient is listed twice.'
    seen.add(r.itemId)
    if (!(typeof r.qty === 'number' && r.qty > 0)) return 'Every ingredient needs an amount more than 0.'
  }
  return null
}
