import { expect, test } from 'vitest'
import { newDraft, toChangeLine } from './lines'
import type { Item } from './types'

const milk: Item = {
  id: 'milk',
  name: 'Milk',
  category: 'Dairy',
  baseUnit: 'ml',
  purchaseUnit: 'carton 1 L',
  unitsPerPurchase: 1000,
  lastCostUsd: 1.5,
  perishable: true,
  shelfLifeDays: 10,
  defaultReorderPoint: 2000,
  active: true,
}

test('receive in cartons becomes ml and a per-ml cost', () => {
  const r = toChangeLine('receive', { ...newDraft(), itemId: 'milk', qty: '12', packCostUsd: '1.5', expiryDate: '2026-12-10' }, milk)
  expect(r).toEqual({ itemId: 'milk', qty: 12000, unitCostUsd: 0.0015, expiryDate: '2026-12-10' })
})

test('perishable receive needs an expiry date', () => {
  const r = toChangeLine('receive', { ...newDraft(), itemId: 'milk', qty: '1', packCostUsd: '1.5' }, milk)
  expect(r).toHaveProperty('error')
})

test('waste in base units with a reason', () => {
  const r = toChangeLine('waste', { ...newDraft(), itemId: 'milk', qty: '250', inPacks: false, reason: 'spilled' }, milk)
  expect(r).toEqual({ itemId: 'milk', qty: 250, reason: 'spilled' })
  expect(toChangeLine('waste', { ...newDraft(), itemId: 'milk', qty: '250', inPacks: false }, milk)).toHaveProperty('error')
})

test('adjust turns "real amount now" into the difference', () => {
  const r = toChangeLine('adjust', { ...newDraft(), itemId: 'milk', actual: '9.5', reason: 'shelf count' }, milk, 10000)
  expect(r).toEqual({ itemId: 'milk', qty: -500, reason: 'shelf count' })
  expect(toChangeLine('adjust', { ...newDraft(), itemId: 'milk', actual: '10', reason: 'x' }, milk, 10000)).toHaveProperty('error')
})

test('missing item or quantity gives a clear error', () => {
  expect(toChangeLine('waste', newDraft(), undefined)).toHaveProperty('error')
  expect(toChangeLine('waste', { ...newDraft(), itemId: 'milk', qty: '0', reason: 'spilled' }, milk)).toHaveProperty('error')
})
