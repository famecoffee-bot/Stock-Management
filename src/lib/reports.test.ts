import { expect, test } from 'vitest'
import { addDays, buildReport, periodRange, shopDay, shopDayStart, toCsv } from './reports'
import type { Movement, Sale } from './types'

const at = (iso: string) => ({ toDate: () => new Date(iso) })
let n = 0
const mv = (type: Movement['type'], itemId: string, qtyChange: number, valueUsd: number, when: string, reason: string | null = null) =>
  ({ id: `m${n++}`, branchId: 'A', itemId, itemName: itemId === 'milk' ? 'Milk' : 'Beans', baseUnit: itemId === 'milk' ? 'ml' : 'g', type, qtyChange, qtyBefore: 0, qtyAfter: 0, unitCostUsd: 0, valueUsd, reason, expiryDate: null, note: null, refType: null, refId: null, userName: 'x', createdAt: at(when) }) as Movement
const sale = (date: string, salesUsd: number | null, cups: number, status: Sale['status'] = 'done') => ({ id: `s${n++}`, branchId: 'A', date, salesUsd, cups, status }) as Sale

test('shop days are Cambodia time', () => {
  expect(shopDay(new Date('2026-11-24T18:00:00Z'))).toBe('2026-11-25')
  expect(shopDayStart('2026-11-25').toISOString()).toBe('2026-11-24T17:00:00.000Z')
  expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
})

test('periods', () => {
  expect(periodRange('7d', '2026-11-25')).toEqual({ from: '2026-11-19', to: '2026-11-25' })
  expect(periodRange('month', '2026-11-25')).toEqual({ from: '2026-11-01', to: '2026-11-25' })
  expect(periodRange('lastMonth', '2026-03-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
  expect(periodRange('yesterday', '2026-12-01')).toEqual({ from: '2026-11-30', to: '2026-11-30' })
})

test('cost of sales, waste, variance and purchases add up from the ledger', () => {
  const r = buildReport(
    [
      mv('receive', 'milk', 10000, 16, '2026-11-24T02:00:00Z'),
      mv('sale', 'milk', -3000, -4.8, '2026-11-24T10:00:00Z'),
      mv('sale', 'beans', -270, -3.78, '2026-11-24T10:00:00Z'),
      mv('sale', 'milk', -1000, -1.6, '2026-11-25T03:00:00Z'),
      mv('sale_void', 'milk', 1000, 1.6, '2026-11-25T04:00:00Z'), // a mistaken sale, cancelled
      mv('waste', 'milk', -500, -0.8, '2026-11-25T05:00:00Z', 'expired'),
      mv('waste', 'beans', -50, -0.7, '2026-11-25T05:00:00Z', 'spilled'),
      mv('count', 'milk', -400, -0.64, '2026-11-25T06:00:00Z'),
      mv('transfer_out', 'milk', -1000, -1.6, '2026-11-25T07:00:00Z'),
      mv('adjust', 'beans', 10, 0.14, '2026-11-25T07:00:00Z'),
    ],
    [sale('2026-11-24', 30, 15), sale('2026-11-25', null, 2), sale('2026-11-25', 9, 4, 'void')],
  )
  expect(r.costOfSalesUsd).toBe(8.58)
  expect(r.salesUsd).toBe(30)
  expect(r.salesWithoutPrice).toBe(1)
  expect(r.cups).toBe(17)
  expect(r.costPct).toBe(28.6)
  expect(r.wasteUsd).toBe(1.5)
  expect(r.wasteByReason).toEqual([{ reason: 'expired', usd: 0.8 }, { reason: 'spilled', usd: 0.7 }])
  expect(r.varianceUsd).toBe(-0.64)
  expect(r.receivedUsd).toBe(16)
  expect(r.adjustUsd).toBe(0.14)
  const milk = r.items.find((i) => i.itemId === 'milk')!
  expect([milk.usedQty, milk.usedUsd, milk.wastedQty, milk.varianceQty, milk.receivedQty]).toEqual([3000, 4.8, 500, -400, 10000])
  expect(r.days).toEqual([
    { day: '2026-11-24', salesUsd: 30, costOfSalesUsd: 8.58, wasteUsd: 0, varianceUsd: 0, receivedUsd: 16 },
    { day: '2026-11-25', salesUsd: 0, costOfSalesUsd: 0, wasteUsd: 1.5, varianceUsd: -0.64, receivedUsd: 0 },
  ])
})

test('no sales: no cost %', () => {
  expect(buildReport([], []).costPct).toBe(null)
})

test('CSV for Excel: BOM, quotes when needed', () => {
  expect(toCsv(['Item', 'Note'], [['Milk, fresh', 'say "hi"'], ['Beans', 2]])).toBe('\uFEFFItem,Note\r\n"Milk, fresh","say ""hi"""\r\nBeans,2\r\n')
})
