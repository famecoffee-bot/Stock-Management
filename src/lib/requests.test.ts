import { describe, expect, it } from 'vitest'
import { baseToPacks, packsToBase, pickList, suggestPacks } from './requests'
import { countDue } from './counts'

describe('daily orders', () => {
  it('suggests packs to get back to the full level', () => {
    expect(suggestPacks(1500, 6000, 2000, 1000)).toBe(5) // need 4500 ml -> 5 cartons
    expect(suggestPacks(6000, 6000, 2000, 1000)).toBe(0)
    expect(suggestPacks(500, 0, 2000, 1000)).toBe(4) // no full level: twice the low level (4000) - 500
    expect(suggestPacks(-300, 1000, 0, 1000)).toBe(1) // below zero counts as empty
    expect(suggestPacks(0, 0, 0, 1000)).toBe(0) // no levels set: nothing suggested
    expect(suggestPacks(20, 100, 0, 1)).toBe(80)
  })

  it('turns packs into base units and back', () => {
    expect(packsToBase('2.5', 1000)).toBe(2500)
    expect(packsToBase('3', 1)).toBe(3)
    expect(packsToBase('', 1000)).toBe(0)
    expect(packsToBase('-1', 1000)).toBeNaN()
    expect(packsToBase('abc', 1000)).toBeNaN()
    expect(baseToPacks(2500, 1000)).toBe('2.5')
    expect(baseToPacks(7, 1)).toBe('7')
  })

  it('adds up waiting orders per item for the stock keeper', () => {
    const line = (itemId: string, qty: number) => ({ itemId, itemName: itemId, qty, baseUnit: 'ml' })
    const list = pickList([
      { status: 'requested', lines: [line('milk', 3000), line('cups', 100)] },
      { status: 'requested', lines: [line('milk', 2000)] },
      { status: 'sent', lines: [line('milk', 9999)] },
    ])
    expect(list).toEqual([
      { itemId: 'cups', itemName: 'cups', baseUnit: 'ml', qty: 100, orders: 1 },
      { itemId: 'milk', itemName: 'milk', baseUnit: 'ml', qty: 5000, orders: 2 },
    ])
  })
})

describe('weekly and monthly counts', () => {
  const now = new Date(2026, 10, 27, 10) // 27 Nov 2026
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86400000)

  it('weekly: ok for a week, then due, overdue after two weeks', () => {
    expect(countDue('weekly', null, now)).toEqual({ state: 'never', days: null })
    expect(countDue('weekly', daysAgo(3), now)).toEqual({ state: 'ok', days: 3 })
    expect(countDue('weekly', daysAgo(7), now)).toEqual({ state: 'due', days: 7 })
    expect(countDue('weekly', daysAgo(15), now).state).toBe('overdue')
  })

  it('monthly: ok if done this month, due if last month, overdue if older', () => {
    expect(countDue('monthly', new Date(2026, 10, 1), now).state).toBe('ok')
    expect(countDue('monthly', new Date(2026, 9, 30), now).state).toBe('due')
    expect(countDue('monthly', new Date(2026, 8, 30), now).state).toBe('overdue')
    expect(countDue('monthly', new Date(2025, 11, 31), new Date(2026, 0, 2)).state).toBe('due') // across the new year
  })
})
