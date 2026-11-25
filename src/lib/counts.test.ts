import { expect, test } from 'vitest'
import { baseToEntry, bigDifference, entryToBase, previewTotals } from './counts'
import type { CountLine } from './types'

test('3 full cartons and an open one with 400 ml = 3400 ml', () => {
  expect(entryToBase({ packs: '3', loose: '400' }, 1000)).toBe(3400)
  expect(entryToBase({ packs: '', loose: '12' }, 50)).toBe(12)
  expect(entryToBase({ packs: '2', loose: '' }, 50)).toBe(100)
  expect(entryToBase({ packs: '0', loose: '' }, 50)).toBe(0)
  expect(entryToBase({ packs: '', loose: '' }, 50)).toBe(null)
  expect(entryToBase({ packs: '1,5', loose: '' }, 1000)).toBe(1500)
  expect(entryToBase({ packs: 'abc', loose: '' }, 1000)).toBeNaN()
  expect(entryToBase({ packs: '-1', loose: '' }, 1000)).toBeNaN()
})

test('a saved count shows again as packs + rest', () => {
  expect(baseToEntry(3400, 1000)).toEqual({ packs: '3', loose: '400' })
  expect(baseToEntry(0, 1000)).toEqual({ packs: '', loose: '0' })
  expect(baseToEntry(12, 1)).toEqual({ packs: '', loose: '12' })
  expect(baseToEntry(null, 1000)).toEqual({ packs: '', loose: '' })
})

const line = (expected: number, counted: number | null, avgCostUsd: number) => ({ expected, counted, avgCostUsd }) as CountLine

test('big differences are flagged to check again', () => {
  expect(bigDifference(line(5000, 4000, 0.0016))).toBe(true) // -20%, $1.60
  expect(bigDifference(line(5000, 4900, 0.0016))).toBe(false) // -2%
  expect(bigDifference(line(100, 50, 0.001))).toBe(false) // worth only 5 cents
  expect(bigDifference(line(100, null, 1))).toBe(false)
})

test('totals before approving', () => {
  expect(previewTotals([line(5000, 4200, 0.0016), line(100, 104, 0.07), line(10, null, 1)])).toEqual({
    counted: 2,
    differences: 2,
    lossUsd: 1.28,
    gainUsd: 0.28,
    netUsd: -1,
  })
})
