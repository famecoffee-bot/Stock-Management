import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkRequestInput, checkSendQty, requestNumber } from '../lib/requests.js'
import { checkPeriod } from '../lib/counts.js'

const ok = { branchId: 'rv', warehouseId: 'wh', neededDate: '2026-11-28', lines: [{ itemId: 'milk', qty: 6000 }] }

test('a daily order needs a branch, the warehouse, a date and at least one item', () => {
  assert.deepEqual(checkRequestInput(ok).value, { ...ok, note: '' })
  assert.match(checkRequestInput({ ...ok, warehouseId: 'rv' }).error, /itself/)
  assert.match(checkRequestInput({ ...ok, neededDate: '28/11' }).error, /date/)
  assert.match(checkRequestInput({ ...ok, lines: [] }).error, /at least one/)
  assert.match(checkRequestInput({ ...ok, lines: [{ itemId: 'milk', qty: 0 }] }).error, /more than 0/)
  assert.match(checkRequestInput({ ...ok, lines: [{ itemId: 'milk', qty: 1 }, { itemId: 'milk', qty: 2 }] }).error, /twice/)
  assert.match(checkRequestInput({ ...ok, lines: [{ itemId: 'a/b', qty: 1 }] }).error, /item/)
})

test('the warehouse can send what was asked, less, more, or nothing of one item', () => {
  const lines = [
    { itemId: 'milk', itemName: 'Milk', qty: 6000 },
    { itemId: 'cups', itemName: 'Cups', qty: 100 },
  ]
  const same = checkSendQty(lines, {})
  assert.deepEqual(same.send, [{ itemId: 'milk', qty: 6000 }, { itemId: 'cups', qty: 100 }])
  const changed = checkSendQty(lines, { milk: 4000, cups: 0 })
  assert.deepEqual(changed.send, [{ itemId: 'milk', qty: 4000 }])
  assert.deepEqual(changed.lines.map((l) => l.sentQty), [4000, 0])
  assert.match(checkSendQty(lines, { milk: 0, cups: 0 }).error, /Reject/)
  assert.match(checkSendQty(lines, { milk: -1 }).error, /0 or more/)
  assert.match(checkSendQty(lines, { ghost: 1 }).error, /not on this order/)
})

test('order numbers and kinds of count', () => {
  assert.equal(requestNumber(7), 'REQ-0007')
  assert.equal(checkPeriod('weekly'), 'weekly')
  assert.equal(checkPeriod('monthly'), 'monthly')
  assert.equal(checkPeriod(undefined), 'spot')
  assert.equal(checkPeriod('yearly'), undefined)
})
