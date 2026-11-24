import { describe, expect, test } from 'vitest'
import { costPerBase, formatKhr, formatQty, toBase } from './units'

describe('units', () => {
  test('shows big gram and ml amounts as kg and L', () => {
    expect(formatQty(2500, 'g')).toBe('2.5 kg')
    expect(formatQty(750, 'ml')).toBe('750 ml')
    expect(formatQty(12000, 'ml')).toBe('12 L')
    expect(formatQty(-1500, 'g')).toBe('-1.5 kg')
    expect(formatQty(40, 'pcs')).toBe('40 pcs')
  })

  test('converts purchase units to base units', () => {
    expect(toBase(3, 1000)).toBe(3000)
    expect(toBase(0.5, 12000)).toBe(6000)
  })

  test('cost per base unit', () => {
    expect(costPerBase(12, 1000)).toBeCloseTo(0.012)
    expect(costPerBase(5, 0)).toBe(0)
  })

  test('riel is rounded to 100', () => {
    expect(formatKhr(1.5, 4100)).toBe('6,200 ៛')
  })
})
