import { expect, test } from 'vitest'
import { daysUntil, expiryLevel, lotsOnShelf } from './expiry'
import type { Batch } from './types'

const b = (id: string, qtyReceived: number, expiryDate: string) => ({ id, branchId: 'A', itemId: 'milk', itemName: 'Milk', qtyReceived, expiryDate }) as Batch

test('days until expiry', () => {
  expect(daysUntil('2026-11-25', '2026-11-25')).toBe(0)
  expect(daysUntil('2026-11-24', '2026-11-25')).toBe(-1)
  expect(daysUntil('2026-12-01', '2026-11-25')).toBe(6)
})

test('stock on hand is the newest lots (we use the oldest first)', () => {
  // received 6 L expiring 26th, then 6 L expiring 30th; 8 L left now
  const r = lotsOnShelf(8000, [b('old', 6000, '2026-11-26'), b('new', 6000, '2026-11-30')], '2026-11-25')
  expect(r.lots.map((l) => [l.batch.id, l.qtyLeft, l.daysLeft])).toEqual([
    ['old', 2000, 1],
    ['new', 6000, 5],
  ])
  expect(r.unknownQty).toBe(0)
})

test('old lots already used up are not shown; extra stock has unknown expiry', () => {
  expect(lotsOnShelf(4000, [b('old', 6000, '2026-11-20'), b('new', 6000, '2026-11-30')], '2026-11-25').lots.map((l) => l.batch.id)).toEqual(['new'])
  expect(lotsOnShelf(7000, [b('new', 6000, '2026-11-30')], '2026-11-25').unknownQty).toBe(1000)
  expect(lotsOnShelf(-50, [b('new', 6000, '2026-11-30')], '2026-11-25').lots).toEqual([])
})

test('levels', () => {
  expect(expiryLevel(-1)).toBe('expired')
  expect(expiryLevel(0)).toBe('today')
  expect(expiryLevel(1)).toBe('today')
  expect(expiryLevel(3)).toBe('soon')
  expect(expiryLevel(4)).toBe('ok')
})
