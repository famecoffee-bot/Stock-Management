import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PO_ACTIONS, checkPoInput, planPoReceipt, poNumber, poTotal, remainingPacks } from '../lib/purchasing.js'

const ok = { supplierId: 'sup1', branchId: 'A', lines: [{ itemId: 'milk', packs: 12, packCostUsd: 1.5 }] }

test('a good order passes and is cleaned', () => {
  const r = checkPoInput({ ...ok, note: '  call first  ', expectedDate: '2026-12-01' })
  assert.deepEqual(r.value.lines, [{ itemId: 'milk', packs: 12, packCostUsd: 1.5 }])
  assert.equal(r.value.note, 'call first')
  assert.equal(r.value.expectedDate, '2026-12-01')
})

test('orders need a supplier, a branch, lines, quantities and prices', () => {
  assert.match(checkPoInput({ ...ok, supplierId: '' }).error, /supplier/)
  assert.match(checkPoInput({ ...ok, branchId: undefined }).error, /branch/)
  assert.match(checkPoInput({ ...ok, lines: [] }).error, /at least one/)
  assert.match(checkPoInput({ ...ok, lines: [{ itemId: 'milk', packs: 0, packCostUsd: 1 }] }).error, /quantity/)
  assert.match(checkPoInput({ ...ok, lines: [{ itemId: 'milk', packs: 1, packCostUsd: -1 }] }).error, /price/)
  assert.match(checkPoInput({ ...ok, lines: [{ itemId: 'milk', packs: 1, packCostUsd: 1 }, { itemId: 'milk', packs: 2, packCostUsd: 1 }] }).error, /twice/)
  assert.match(checkPoInput({ ...ok, expectedDate: '01/12/2026' }).error, /date/)
  assert.match(checkPoInput({ ...ok, lines: [{ itemId: '../x', packs: 1, packCostUsd: 1 }] }).error, /Unknown/)
})

test('total and PO numbers', () => {
  assert.equal(poTotal([{ packs: 12, packCostUsd: 1.5 }, { packs: 3, packCostUsd: 12.333 }]), 55)
  assert.equal(poNumber(7), 'PO-0007')
  assert.equal(poNumber(12345), 'PO-12345')
})

test('the action table: what each status allows', () => {
  assert.deepEqual(PO_ACTIONS.send.from, ['draft'])
  assert.ok(!PO_ACTIONS.cancel.from.includes('partial'), 'part-received orders are closed, not cancelled')
  assert.equal(PO_ACTIONS.close.to, 'received')
})

const po = {
  status: 'sent',
  lines: [
    { itemId: 'milk', itemName: 'Milk', packs: 12, packCostUsd: 1.5, receivedPacks: 0, unitsPerPurchase: 1000 },
    { itemId: 'beans', itemName: 'Beans', packs: 5, packCostUsd: 12, receivedPacks: 0, unitsPerPurchase: 1000 },
  ],
}
const items = { milk: { perishable: true }, beans: { perishable: false } }

test('receiving everything closes the order', () => {
  const r = planPoReceipt(po, [{ itemId: 'milk', packs: 12, expiryDate: '2026-12-10' }, { itemId: 'beans', packs: 5 }], items)
  assert.equal(r.status, 'received')
  assert.equal(r.lines[0].receivedPacks, 12)
  assert.equal(r.receive[0].packCostUsd, 1.5, 'price defaults to the order price')
})

test('receiving part leaves it open, and the rest can come later', () => {
  const r = planPoReceipt(po, [{ itemId: 'beans', packs: 3, packCostUsd: 13 }], items)
  assert.equal(r.status, 'partial')
  assert.equal(remainingPacks(r.lines[1]), 2)
  assert.equal(r.lines[1].receivedCostUsd, 13)
  const r2 = planPoReceipt({ ...po, status: 'partial', lines: r.lines }, [{ itemId: 'beans', packs: 2 }, { itemId: 'milk', packs: 12, expiryDate: '2026-12-10' }], items)
  assert.equal(r2.status, 'received')
})

test('receiving is refused when it makes no sense', () => {
  assert.match(planPoReceipt({ ...po, status: 'draft' }, [{ itemId: 'beans', packs: 1 }]).error, /sent/)
  assert.match(planPoReceipt({ ...po, status: 'received' }, [{ itemId: 'beans', packs: 1 }]).error, /sent/)
  assert.match(planPoReceipt(po, [{ itemId: 'sugar', packs: 1 }]).error, /not on this order/)
  assert.match(planPoReceipt(po, [{ itemId: 'beans', packs: 0 }]).error, /at least one/)
  assert.match(planPoReceipt(po, [{ itemId: 'beans', packs: 50 }]).error, /much more/)
  assert.match(planPoReceipt(po, [{ itemId: 'milk', packs: 1 }], items).error, /expiry/)
  assert.match(planPoReceipt(po, [{ itemId: 'beans', packs: -1 }]).error, /0 or more/)
})

test('a small extra (supplier added one) is accepted', () => {
  const r = planPoReceipt(po, [{ itemId: 'beans', packs: 6 }], items)
  assert.equal(r.lines[1].receivedPacks, 6)
  assert.equal(remainingPacks(r.lines[1]), 0)
})
