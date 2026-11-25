// Phase 4: sales take ingredients out of stock by recipe. Staff enter what was
// sold (or import a CSV); this function multiplies each recipe by the number
// sold and writes one "sale" movement per ingredient through the same ledger as
// every other stock change. The sale document and the movements are written in
// ONE transaction, so a sale can never be deducted twice or only half-way.
// Everything is in the stock app's own "stock" database.
import { FieldValue } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { checkSaleInput, explodeSale } from './lib/sales.js'
import { ledger } from './stock-api.js'

const C = { products: 'inv_products', sales: 'inv_sales' }
const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d

export function salesApi(db) {
  const { profileOf, need, activeBranch, readItems, readStock, plan, write } = ledger(db)

  async function readProducts(tx, ids) {
    const snaps = await tx.getAll(...ids.map((id) => db.collection(C.products).doc(id)))
    const out = {}
    for (const s of snaps) {
      if (!s.exists) throw new HttpsError('not-found', 'A product on the list does not exist.')
      out[s.id] = s.data()
    }
    return out
  }

  /** Record sales for one branch and one day, and take the ingredients out of stock. */
  const invRecordSales = onCall(async (req) => {
    const me = await profileOf(req.auth)
    const checked = checkSaleInput(req.data)
    if (checked.error) throw new HttpsError('invalid-argument', checked.error)
    const input = checked.value
    need(me, input.branchId, 'staff')
    // An import carries a key (e.g. "2026-11-24-pos-export"), so the same file can't be imported twice.
    const ref = input.key ? db.collection(C.sales).doc(`${input.branchId}_${input.key}`) : db.collection(C.sales).doc()

    return db.runTransaction(async (tx) => {
      if (input.key && (await tx.get(ref)).exists) {
        throw new HttpsError('already-exists', 'These sales were already recorded (same import). Nothing was changed.')
      }
      await activeBranch(tx, input.branchId)
      const products = await readProducts(tx, [...new Set(input.lines.map((l) => l.productId))])
      const ex = explodeSale(input.lines, products)
      if (ex.error) throw new HttpsError('failed-precondition', ex.error)
      const itemIds = [...ex.usage.keys()]
      const items = await readItems(tx, itemIds)
      const stock = await readStock(tx, input.branchId, itemIds)

      // Sales happen whether or not the app thinks the shelf has enough, so stock may go
      // below zero here. A negative number tells the manager a count or a receiving is missing.
      const planned = plan(
        itemIds.map((itemId) => ({ itemId, qty: ex.usage.get(itemId) })),
        'sale',
        stock,
        items,
        { allowNegative: true },
      )
      const label = `Sales ${input.date}${input.source === 'import' ? ' (import)' : ''}`
      write(tx, { branchId: input.branchId, type: 'sale', planned, items, stock, me, note: [label, input.note].filter(Boolean).join(' · '), refType: 'sale', refId: ref.id })

      const costOf = (itemId) => stock[itemId]?.avgCostUsd ?? 0
      const lines = ex.lines.map((l) => {
        const costUsd = round(l.recipe.reduce((s, r) => s + r.qty * costOf(r.itemId), 0) * l.qty, 4)
        return {
          productId: l.productId,
          productName: l.productName,
          sizeKey: l.sizeKey,
          sizeLabel: l.sizeLabel,
          qty: l.qty,
          priceUsd: l.priceUsd,
          costUsd,
        }
      })
      const usage = planned.map((p) => ({
        itemId: p.itemId,
        itemName: items[p.itemId].name,
        baseUnit: items[p.itemId].baseUnit,
        qty: -p.qtyChange,
        qtyAfter: p.qtyAfter,
        valueUsd: round(-p.valueUsd, 4),
      }))
      const salesUsd = lines.every((l) => typeof l.priceUsd === 'number') ? round(lines.reduce((s, l) => s + l.priceUsd * l.qty, 0), 2) : null
      tx.set(ref, {
        branchId: input.branchId,
        date: input.date,
        source: input.source,
        key: input.key,
        note: input.note || null,
        lines,
        usage,
        cups: round(lines.reduce((s, l) => s + l.qty, 0), 2),
        costUsd: round(usage.reduce((s, u) => s + u.valueUsd, 0), 2),
        salesUsd,
        status: 'done',
        createdBy: me.uid,
        createdByName: me.name,
        createdAt: FieldValue.serverTimestamp(),
      })
      return { ok: true, id: ref.id, negative: usage.filter((u) => u.qtyAfter < 0).map((u) => u.itemName) }
    })
  })

  /** A manager takes back a sale entered by mistake: the ingredients go back into stock. */
  const invVoidSale = onCall(async (req) => {
    const me = await profileOf(req.auth)
    const { id } = req.data ?? {}
    if (typeof id !== 'string' || !id) throw new HttpsError('invalid-argument', 'Missing sale.')
    const reason = typeof req.data.reason === 'string' ? req.data.reason.trim().slice(0, 200) : ''
    if (!reason) throw new HttpsError('invalid-argument', 'Write why this sale is being cancelled.')
    const ref = db.collection(C.sales).doc(id)
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists) throw new HttpsError('not-found', 'Sale not found.')
      const sale = snap.data()
      need(me, sale.branchId, 'manager')
      if (sale.status !== 'done') throw new HttpsError('failed-precondition', 'This sale is already cancelled.')
      const itemIds = sale.usage.map((u) => u.itemId)
      const items = await readItems(tx, itemIds)
      const stock = await readStock(tx, sale.branchId, itemIds)
      // put back at the value they left with, so the average cost is not disturbed
      const planned = plan(
        sale.usage.map((u) => ({ itemId: u.itemId, qty: u.qty, unitCostUsd: u.qty > 0 ? u.valueUsd / u.qty : 0 })),
        'sale_void',
        stock,
        items,
      )
      write(tx, { branchId: sale.branchId, type: 'sale_void', planned, items, stock, me, note: `Sales ${sale.date} cancelled: ${reason}`, refType: 'sale', refId: id })
      tx.update(ref, { status: 'void', voidReason: reason, voidedBy: me.uid, voidedByName: me.name, voidedAt: FieldValue.serverTimestamp() })
      return { ok: true }
    })
  })

  return { invRecordSales, invVoidSale }
}
