import { t } from './i18n'
// Quantities are always stored in a small "base unit" (g, ml or pcs) so the
// maths never mixes kilograms with grams. These helpers convert for display.

export type BaseUnit = 'g' | 'ml' | 'pcs'

export const BASE_UNITS: { value: BaseUnit; label: string }[] = [
  { value: 'g', label: t('grams (g)') },
  { value: 'ml', label: t('millilitres (ml)') },
  { value: 'pcs', label: t('pieces (pcs)') },
]

/** Show a base-unit quantity in a friendly way: 2500 g -> "2.5 kg". */
export function formatQty(qty: number, unit: BaseUnit): string {
  const sign = qty < 0 ? '-' : ''
  const abs = Math.abs(qty)
  if (unit === 'g' && abs >= 1000) return `${sign}${round(abs / 1000)} kg`
  if (unit === 'ml' && abs >= 1000) return `${sign}${round(abs / 1000)} L`
  return `${sign}${round(abs)} ${unit}`
}

/** Purchase units to base units: 3 bags of 1000 g = 3000 g. */
export function toBase(purchaseQty: number, unitsPerPurchase: number): number {
  return round(purchaseQty * unitsPerPurchase, 4)
}

/** Cost of one base unit in USD: a 1000 g bag at $12 is $0.012 per g. */
export function costPerBase(lastCostUsd: number, unitsPerPurchase: number): number {
  if (!(unitsPerPurchase > 0)) return 0
  return lastCostUsd / unitsPerPurchase
}

export function formatUsd(v: number): string {
  // 1208.5 -> "$1,208.50"
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Riel, rounded to the nearest 100 like cash in Cambodia. */
export function formatKhr(usd: number, rate: number): string {
  const khr = Math.round((usd * rate) / 100) * 100
  return `${khr.toLocaleString('en-US')} ៛`
}

function round(v: number, digits = 2): number {
  const f = 10 ** digits
  return Math.round(v * f) / f
}
