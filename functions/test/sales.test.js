import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkRecipe, checkSaleInput, explodeSale, sizeName } from '../lib/sales.js'

const ok = { branchId: 'A', date: '2026-11-24', lines: [{ productId: 'latte', sizeKey: 'L', qty: 10 }] }

test('a good batch passes; the same drink on two lines is added up', () => {
  const r = checkSaleInput({ ...ok, lines: [...ok.lines, { productId: 'latte', sizeKey: 'L', qty: 5 }, { productId: 'latte', sizeKey: 'M', qty: 2 }] })
  assert.deepEqual(r.value.lines, [
    { productId: 'latte', sizeKey: 'L', qty: 15 },
    { productId: 'latte', sizeKey: 'M', qty: 2 },
  ])
  assert.equal(r.value.source, 'manual')
  assert.equal(r.value.key, null)
})

test('sales need a branch, a day, lines and positive numbers', () => {
  assert.match(checkSaleInput({ ...ok, branchId: '' }).error, /branch/)
  assert.match(checkSaleInput({ ...ok, date: '24/11/2026' }).error, /day/)
  assert.match(checkSaleInput({ ...ok, lines: [] }).error, /at least one/)
  assert.match(checkSaleInput({ ...ok, lines: [{ productId: 'latte', sizeKey: 'L', qty: 0 }] }).error, /more than 0/)
  assert.match(checkSaleInput({ ...ok, lines: [{ productId: 'latte', sizeKey: 'L', qty: -3 }] }).error, /more than 0/)
  assert.match(checkSaleInput({ ...ok, lines: [{ productId: 'latte', sizeKey: 'L', qty: 999999 }] }).error, /too big/)
  assert.match(checkSaleInput({ ...ok, source: 'hack' }).error, /source/)
  assert.match(checkSaleInput({ ...ok, key: 'a/b' }).error, /key/)
})

const products = {
  latte: {
    name: 'Iced Latte',
    sizes: [{ key: 'M', label: 'Medium', priceUsd: 2 }, { key: 'L', label: 'Large', priceUsd: 2.5 }],
    recipes: {
      M: [{ itemId: 'beans', qty: 18 }, { itemId: 'milk', qty: 180 }, { itemId: 'cup', qty: 1 }],
      L: [{ itemId: 'beans', qty: 18 }, { itemId: 'milk', qty: 220 }, { itemId: 'cup', qty: 1 }],
    },
  },
  americano: { name: 'Americano', sizes: [{ key: 'one', label: 'One size', priceUsd: 1.5 }], recipes: { one: [{ itemId: 'beans', qty: 18 }, { itemId: 'cup', qty: 1 }] } },
  tea: { name: 'Tea', sizes: [{ key: 'one', label: 'One size' }], recipes: {} },
}

test('selling drinks adds up the ingredients of every recipe', () => {
  const r = explodeSale(
    [
      { productId: 'latte', sizeKey: 'L', qty: 10 },
      { productId: 'latte', sizeKey: 'M', qty: 5 },
      { productId: 'americano', sizeKey: 'one', qty: 20 },
    ],
    products,
  )
  assert.equal(r.usage.get('beans'), 18 * 35) // 630 g
  assert.equal(r.usage.get('milk'), 2200 + 900)
  assert.equal(r.usage.get('cup'), 35)
  assert.equal(r.lines[0].productName, 'Iced Latte')
  assert.equal(r.lines[0].priceUsd, 2.5)
})

test('a drink without a recipe stops the batch with a clear message', () => {
  assert.match(explodeSale([{ productId: 'tea', sizeKey: 'one', qty: 3 }], products).error, /No recipe yet for: Tea/)
  assert.match(explodeSale([{ productId: 'latte', sizeKey: 'XL', qty: 1 }], products).error, /unknown size/)
  assert.match(explodeSale([{ productId: 'ghost', sizeKey: 'M', qty: 1 }], products).error, /does not exist/)
})

test('a broken recipe (negative amount) is refused, so a sale can never ADD stock', () => {
  const bad = { x: { name: 'Bad', sizes: [{ key: 'one', label: 'One size' }], recipes: { one: [{ itemId: 'milk', qty: -200 }] } } }
  assert.match(explodeSale([{ productId: 'x', sizeKey: 'one', qty: 1 }], bad).error, /more than 0/)
  assert.match(checkRecipe([{ itemId: 'a', qty: 1 }, { itemId: 'a', qty: 2 }]), /twice/)
  assert.equal(checkRecipe([{ itemId: 'a', qty: 1 }]), null)
})

test('size names', () => {
  assert.equal(sizeName(products.latte, products.latte.sizes[1]), 'Iced Latte (Large)')
  assert.equal(sizeName(products.americano, products.americano.sizes[0]), 'Americano')
})
