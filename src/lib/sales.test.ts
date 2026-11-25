import { expect, test } from 'vitest'
import { costPercent, importKey, parseSalesCsv, recipeCost, shopToday, splitCsvLine } from './sales'
import type { Item, Product } from './types'

const latte: Product = {
  id: 'latte',
  name: 'Iced Latte',
  category: 'Coffee',
  groveName: 'Latte Ice',
  sizes: [
    { key: 'M', label: 'Medium', priceUsd: 2 },
    { key: 'L', label: 'Large', priceUsd: 2.5 },
  ],
  recipes: { M: [{ itemId: 'beans', qty: 18 }], L: [{ itemId: 'beans', qty: 18 }, { itemId: 'milk', qty: 220 }] },
  active: true,
}
const americano: Product = { ...latte, id: 'ame', name: 'Americano', groveName: '', sizes: [{ key: 'one', label: 'One size', priceUsd: 1.5 }], recipes: {} }
const menu = [latte, americano]

test('reads "product, size, qty", "product (size), qty" and single-size "product, qty"', () => {
  const r = parseSalesCsv('Product,Size,Qty\nIced Latte, L, 12\niced latte (medium), 8\nAmericano,30\nLatte Ice,L,3', menu)
  expect(r.problems).toEqual([])
  expect(r.rows).toBe(4)
  expect(r.lines).toEqual([
    { productId: 'latte', sizeKey: 'L', qty: 15 },
    { productId: 'latte', sizeKey: 'M', qty: 8 },
    { productId: 'ame', sizeKey: 'one', qty: 30 },
  ])
})

test('unknown products, missing sizes and bad numbers are listed, not guessed', () => {
  const r = parseSalesCsv('Mocha, M, 3\nIced Latte, 4\nIced Latte, XL, 2\nAmericano, lots', menu)
  expect(r.lines).toEqual([])
  expect(r.problems.map((p) => p.row)).toEqual([1, 2, 3, 4])
  expect(r.problems[0].reason).toContain('No menu product')
  expect(r.problems[1].reason).toContain('Which one?')
  expect(r.problems[2].reason).toContain('no size')
  expect(r.problems[3].reason).toContain('number sold')
})

test('stopped products do not match', () => {
  expect(parseSalesCsv('Americano,3', [{ ...americano, active: false }]).problems).toHaveLength(1)
})

test('CSV cells: quotes, tabs and semicolons', () => {
  expect(splitCsvLine('"Latte, oat", L, "1,200"')).toEqual(['Latte, oat', 'L', '1,200'])
  expect(splitCsvLine('Americano\t30')).toEqual(['Americano', '30'])
  expect(splitCsvLine('Americano;30')).toEqual(['Americano', '30'])
})

test('the same file on the same day gives the same import key', () => {
  expect(importKey('2026-11-24', 'a,1')).toBe(importKey('2026-11-24', 'a,1'))
  expect(importKey('2026-11-24', 'a,1')).not.toBe(importKey('2026-11-25', 'a,1'))
  expect(importKey('2026-11-24', 'a,1')).toMatch(/^[A-Za-z0-9_-]+$/)
})

test('cost of one cup and cost %', () => {
  const items = new Map<string, Item>([
    ['beans', { id: 'beans', unitsPerPurchase: 1000, lastCostUsd: 14 } as Item],
    ['milk', { id: 'milk', unitsPerPurchase: 1000, lastCostUsd: 1.6 } as Item],
  ])
  expect(recipeCost(latte.recipes.L, items)).toBe(0.604) // 18 g * 0.014 + 220 ml * 0.0016
  expect(costPercent(0.604, 2.5)).toBe(24)
  expect(costPercent(0.6, null)).toBe(null)
})

test('shop day is Cambodia time', () => {
  expect(shopToday(new Date('2026-11-24T18:30:00Z'))).toBe('2026-11-25')
  expect(shopToday(new Date('2026-11-24T10:00:00Z'))).toBe('2026-11-24')
})
