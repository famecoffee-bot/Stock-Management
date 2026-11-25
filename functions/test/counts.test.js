import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkCountEntries, countResult } from '../lib/counts.js'
import { signedQty } from '../lib/stock.js'

test('counted numbers: 0 or more, blank means not counted yet, only items on the sheet', () => {
  assert.deepEqual(checkCountEntries({ milk: 1200, beans: '', cups: 0 }, ['milk', 'beans', 'cups']).value, { milk: 1200, beans: null, cups: 0 })
  assert.match(checkCountEntries({ milk: -1 }, ['milk']).error, /0 or more/)
  assert.match(checkCountEntries({ milk: 'lots' }, ['milk']).error, /0 or more/)
  assert.match(checkCountEntries({ ghost: 1 }, ['milk']).error, /not on this count/)
  assert.match(checkCountEntries({ milk: 1e9 }, ['milk']).error, /too big/)
  assert.match(checkCountEntries([1], ['milk']).error, /Nothing/)
})

test('a count works out the difference per item and what it is worth', () => {
  const r = countResult([
    { itemId: 'milk', expected: 5000, counted: 4200, avgCostUsd: 0.0016 },
    { itemId: 'cups', expected: 100, counted: 104, avgCostUsd: 0.07 },
    { itemId: 'beans', expected: 2000, counted: 2000, avgCostUsd: 0.014 },
    { itemId: 'sugar', expected: 900, counted: null, avgCostUsd: 0.002 },
  ])
  assert.equal(r.lines[0].variance, -800)
  assert.equal(r.lines[0].varianceUsd, -1.28)
  assert.equal(r.lines[1].variance, 4)
  assert.equal(r.lines[3].variance, null, 'not counted: no difference')
  assert.deepEqual(r.totals, { counted: 3, differences: 2, lossUsd: 1.28, gainUsd: 0.28, netUsd: -1 })
})

test('a count movement keeps its sign (found more = +, missing = -)', () => {
  assert.equal(signedQty('count', -800), -800)
  assert.equal(signedQty('count', 4), 4)
})
