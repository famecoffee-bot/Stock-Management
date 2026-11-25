import type { SaleInputLine } from './api'
import type { Item, Product, ProductSize, RecipeLine } from './types'
import { costPerBase } from './units'
import { t } from './i18n'

// Recipes and sales helpers for the screens. The server (functions/lib/sales.js)
// checks everything again before any stock moves.

const round = (v: number, d = 4) => Math.round(v * 10 ** d) / 10 ** d

/** Cost of ONE cup in USD, from each ingredient's last purchase price. */
export function recipeCost(recipe: RecipeLine[] | undefined, items: Map<string, Item>): number {
  return round(
    (recipe ?? []).reduce((s, r) => {
      const it = items.get(r.itemId)
      return s + (it ? r.qty * costPerBase(it.lastCostUsd, it.unitsPerPurchase) : 0)
    }, 0),
  )
}

/** Ingredient cost as a share of the selling price (coffee shops aim for about 25 to 35%). */
export function costPercent(cost: number, price: number | null | undefined): number | null {
  return price && price > 0 ? Math.round((cost / price) * 100) : null
}

/** "Iced Latte (L)", or just "Iced Latte" when it has one size. */
export function sizeName(p: Pick<Product, 'name' | 'sizes'>, size: Pick<ProductSize, 'label'>): string {
  return p.sizes.length > 1 ? `${p.name} (${size.label})` : p.name
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

/** Split one CSV line, allowing "quoted, values". */
export function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"'
        i++
      } else q = !q
    } else if ((c === ',' || c === '\t' || c === ';') && !q) {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

export interface ImportProblem {
  row: number
  text: string
  reason: string
}

/**
 * Read sales from a CSV (exported from a till or typed in a spreadsheet).
 * Accepted rows, with or without a header line:
 *   Iced Latte, L, 12        (product, size, number sold)
 *   Iced Latte (L), 12       (size in brackets)
 *   Americano, 30            (single-size product)
 * Products match by their name or their grove-system-kh name; sizes by code or label.
 */
export function parseSalesCsv(text: string, products: Product[]): { lines: SaleInputLine[]; problems: ImportProblem[]; rows: number } {
  const active = products.filter((p) => p.active)
  const byName = new Map<string, Product>()
  for (const p of active) {
    byName.set(norm(p.name), p)
    if (p.groveName) byName.set(norm(p.groveName), p)
  }
  const merged = new Map<string, SaleInputLine>()
  const problems: ImportProblem[] = []
  let rows = 0
  const all = text.split(/\r?\n/)
  all.forEach((raw, i) => {
    if (!raw.trim()) return
    const cells = splitCsvLine(raw)
    while (cells.length && cells[cells.length - 1] === '') cells.pop()
    // header line: no number anywhere
    if (i === 0 && !cells.some((c) => /^\d+(\.\d+)?$/.test(c))) return
    rows++
    const problem = (reason: string) => problems.push({ row: i + 1, text: raw.trim(), reason })
    if (cells.length < 2) return problem(t('Needs a product and a number sold.'))
    const qty = Number(cells[cells.length - 1].replace(/,/g, ''))
    if (!Number.isFinite(qty) || qty <= 0) return problem(t('The last column must be the number sold.'))
    let name = cells[0]
    let sizeText = cells.length >= 3 ? cells[1] : ''
    const m = !sizeText && name.match(/^(.*)\(([^)]+)\)\s*$/)
    if (m) {
      name = m[1]
      sizeText = m[2]
    }
    let p = byName.get(norm(name))
    if (!p && !m) p = byName.get(norm(cells[0]))
    if (!p) return problem(t('No menu product called "{name}".', { name: name.trim() }))
    let size: ProductSize | undefined
    if (p.sizes.length === 1) size = p.sizes[0]
    else if (!sizeText) return problem(t('{name} has sizes: {sizes}. Which one?', { name: p.name, sizes: p.sizes.map((s) => s.key).join(', ') }))
    else size = p.sizes.find((s) => norm(s.key) === norm(sizeText) || norm(s.label) === norm(sizeText))
    if (!size) return problem(t('{name} has no size "{sizeText}".', { name: p.name, sizeText }))
    const k = `${p.id}|${size.key}`
    merged.set(k, { productId: p.id, sizeKey: size.key, qty: round((merged.get(k)?.qty ?? 0) + qty) })
  })
  return { lines: [...merged.values()], problems, rows }
}

/** A short fingerprint of a file, so importing the same file twice is refused by the server. */
export function importKey(date: string, text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0
  return `${date}-import-${h.toString(36)}`
}

/** Today in the shop's time (Cambodia, UTC+7) as YYYY-MM-DD. */
export function shopToday(now = new Date()): string {
  return new Date(now.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10)
}
