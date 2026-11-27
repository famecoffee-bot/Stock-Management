// Phase 5: stock counts. Pure logic only (no database), so it is easy to test.
//
// How a count works:
// 1. Someone starts a count. The app writes down what it EXPECTS on the shelf (the "snapshot").
// 2. Staff count the shelf and type in what they find. They do not see the expected number,
//    so they count what is really there instead of copying the screen (a "blind count").
// 3. A manager approves. For each item: difference = counted - expected.
//    That difference is applied to stock as a "count" movement.
//    Applying the DIFFERENCE (not overwriting the number) keeps any sale or delivery that
//    happened while people were counting.

// What kind of count it is. Weekly: the costly, fast-moving items (or everything).
// Monthly: the full stock take. Spot: an extra check any time.
export const COUNT_PERIODS = ['weekly', 'monthly', 'spot']

/** 'weekly' | 'monthly' | 'spot'; missing = 'spot'; anything else = undefined (refused). */
export function checkPeriod(p) {
  if (p === undefined || p === null || p === '') return 'spot'
  return COUNT_PERIODS.includes(p) ? p : undefined
}

const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d
export const MAX_COUNT = 10_000_000

/**
 * Check the numbers a person typed: { itemId: number | null } (null = not counted yet).
 * @returns {{error:string} | {value: Record<string, number|null>}}
 */
export function checkCountEntries(raw, lineIds) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Nothing to save.' }
  const known = new Set(lineIds)
  const value = {}
  for (const [itemId, v] of Object.entries(raw)) {
    if (!known.has(itemId)) return { error: 'An item is not on this count sheet.' }
    if (v === null || v === '') {
      value[itemId] = null
      continue
    }
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0) return { error: 'Counts must be 0 or more.' }
    if (n > MAX_COUNT) return { error: 'A count is too big. Check the number.' }
    value[itemId] = round(n, 4)
  }
  return { value }
}

/**
 * Work out the result of a count: the difference per item and what it is worth.
 * Lines that were not counted are left out of the totals.
 */
export function countResult(lines) {
  let counted = 0
  let differences = 0
  let lossUsd = 0
  let gainUsd = 0
  const out = lines.map((l) => {
    if (l.counted === null || l.counted === undefined) return { ...l, variance: null, varianceUsd: null }
    counted++
    const variance = round(l.counted - l.expected, 4)
    const varianceUsd = round(variance * (l.avgCostUsd ?? 0), 4)
    if (variance !== 0) differences++
    if (varianceUsd < 0) lossUsd += -varianceUsd
    else gainUsd += varianceUsd
    return { ...l, variance, varianceUsd }
  })
  return { lines: out, totals: { counted, differences, lossUsd: round(lossUsd, 2), gainUsd: round(gainUsd, 2), netUsd: round(gainUsd - lossUsd, 2) } }
}
