import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyChange, canAt, checkLines, signedQty } from '../lib/stock.js'

test('receiving into empty stock sets the average cost', () => {
  const r = applyChange(undefined, 1000, 0.012)
  assert.equal(r.qtyAfter, 1000)
  assert.equal(r.avgCostUsd, 0.012)
  assert.equal(r.valueUsd, 12)
})

test('weighted average cost moves toward the new price', () => {
  // 1000 g at $0.010, then 1000 g at $0.014 -> 2000 g at $0.012
  const r = applyChange({ qty: 1000, avgCostUsd: 0.01 }, 1000, 0.014)
  assert.equal(r.qtyAfter, 2000)
  assert.equal(r.avgCostUsd, 0.012)
})

test('taking stock out keeps the average and values at average cost', () => {
  const r = applyChange({ qty: 2000, avgCostUsd: 0.012 }, -500)
  assert.equal(r.qtyAfter, 1500)
  assert.equal(r.avgCostUsd, 0.012)
  assert.equal(r.valueUsd, -6)
})

test('cannot take out more than is there, unless allowed', () => {
  assert.match(applyChange({ qty: 100, avgCostUsd: 1 }, -150).error, /Not enough stock/)
  assert.equal(applyChange({ qty: 100, avgCostUsd: 1 }, -150, undefined, { allowNegative: true }).qtyAfter, -50)
})

test('receiving into negative stock prices only the new units', () => {
  const r = applyChange({ qty: -50, avgCostUsd: 0.01 }, 1000, 0.02)
  assert.equal(r.qtyAfter, 950)
  assert.equal(r.avgCostUsd, 0.02)
})

test('zero or missing quantity is refused', () => {
  assert.ok(applyChange({ qty: 1, avgCostUsd: 1 }, 0).error)
  assert.ok(applyChange({ qty: 1, avgCostUsd: 1 }, NaN).error)
})

test('line checks per type', () => {
  assert.ok(checkLines('receive', [{ itemId: 'milk', qty: 1000 }]).error, 'receive needs a cost')
  assert.deepEqual(checkLines('receive', [{ itemId: 'milk', qty: '1000', unitCostUsd: '0.0015', expiryDate: '2026-12-31' }]).lines, [
    { itemId: 'milk', qty: 1000, unitCostUsd: 0.0015, expiryDate: '2026-12-31' },
  ])
  assert.ok(checkLines('waste', [{ itemId: 'milk', qty: 10 }]).error, 'waste needs a reason')
  assert.ok(checkLines('waste', [{ itemId: 'milk', qty: -10, reason: 'spilled' }]).error, 'no negatives')
  assert.ok(checkLines('adjust', [{ itemId: 'milk', qty: -10, reason: '' }]).error, 'adjust needs a reason')
  assert.equal(checkLines('adjust', [{ itemId: 'milk', qty: -10, reason: 'count' }]).lines[0].qty, -10)
  assert.ok(checkLines('waste', [{ itemId: 'a', qty: 1, reason: 'other' }, { itemId: 'a', qty: 2, reason: 'other' }]).error)
  assert.ok(checkLines('receive', []).error)
})

test('signs: waste and transfer out remove, receive adds, adjust keeps its sign', () => {
  assert.equal(signedQty('waste', 5), -5)
  assert.equal(signedQty('transfer_out', 5), -5)
  assert.equal(signedQty('receive', 5), 5)
  assert.equal(signedQty('transfer_in', 5), 5)
  assert.equal(signedQty('adjust', -5), -5)
})

test('branch permissions', () => {
  const staff = { active: true, role: 'member', branchRoles: { b1: 'staff' } }
  assert.equal(canAt(staff, 'b1', 'staff'), true)
  assert.equal(canAt(staff, 'b1', 'manager'), false)
  assert.equal(canAt(staff, 'b2', 'viewer'), false)
  assert.equal(canAt({ active: true, role: 'admin' }, 'b2', 'manager'), true)
  assert.equal(canAt({ active: false, role: 'owner' }, 'b1', 'viewer'), false)
})
