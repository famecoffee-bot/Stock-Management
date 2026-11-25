import { expect, test } from 'vitest'
import { linesTotal, orderText, remainingPacks, suggestOrder } from './purchasing'
import type { Item, PurchaseOrder, StockLevel } from './types'

const item = (id: string, extra: Partial<Item> = {}): Item => ({
  id,
  name: id,
  category: 'Other',
  baseUnit: 'ml',
  purchaseUnit: 'carton 1 L',
  unitsPerPurchase: 1000,
  lastCostUsd: 1.5,
  perishable: false,
  defaultReorderPoint: 2000,
  active: true,
  ...extra,
})
const level = (itemId: string, qty: number, reorderPoint: number, parLevel = 0): StockLevel => ({
  id: `A_${itemId}`,
  branchId: 'A',
  itemId,
  itemName: itemId,
  baseUnit: 'ml',
  qty,
  avgCostUsd: 0,
  reorderPoint,
  parLevel,
})

test('suggests refilling to the par level, in whole packs', () => {
  const s = suggestOrder([item('milk')], [level('milk', 1500, 2000, 10000)])
  expect(s).toHaveLength(1)
  expect(s[0].packs).toBe(9) // need 8500 ml -> 9 cartons
})

test('without a par level, refills to twice the reorder point', () => {
  expect(suggestOrder([item('milk')], [level('milk', 0, 2000)])[0].packs).toBe(4)
})

test('never-stocked items use the item default reorder point', () => {
  expect(suggestOrder([item('milk')], [])[0].packs).toBe(4)
})

test('items above the reorder point, stopped, or with no reorder point are skipped', () => {
  expect(suggestOrder([item('milk')], [level('milk', 5000, 2000)])).toHaveLength(0)
  expect(suggestOrder([item('milk', { active: false })], [])).toHaveLength(0)
  expect(suggestOrder([item('milk', { defaultReorderPoint: 0 })], [])).toHaveLength(0)
})

test('negative stock still orders enough', () => {
  expect(suggestOrder([item('milk')], [level('milk', -500, 2000)])[0].packs).toBe(4)
})

test('totals and remaining', () => {
  expect(linesTotal([{ packs: 12, packCostUsd: 1.5 }, { packs: 2, packCostUsd: 12 }])).toBe(42)
  expect(remainingPacks({ packs: 5, receivedPacks: 3 } as never)).toBe(2)
  expect(remainingPacks({ packs: 5, receivedPacks: 6 } as never)).toBe(0)
})

test('order text for Telegram lists lines, total in USD and riel', () => {
  const po = {
    number: 'PO-0001',
    branchName: 'Riverside',
    expectedDate: '2026-12-01',
    totalUsd: 18,
    note: 'Before 9 am',
    lines: [{ itemName: 'Milk', packs: 12, purchaseUnit: 'carton 1 L', packCostUsd: 1.5 }],
  } as unknown as PurchaseOrder
  const t = orderText(po, 4100)
  expect(t).toContain('Order PO-0001')
  expect(t).toContain('1. Milk: 12 × carton 1 L @ $1.50 = $18.00')
  expect(t).toContain('Total: $18.00 (73,800 ៛)')
  expect(t).toContain('Note: Before 9 am')
})
