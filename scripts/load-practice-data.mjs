// Fills a TEST Firebase project with practice data so you can try every feature.
//
//   node scripts/load-practice-data.mjs <test-project-id>
//
// It refuses to run against grove-mart (the real project). It needs a service
// account key for the TEST project: set GOOGLE_APPLICATION_CREDENTIALS to its path.
// Running it twice is safe: the second time it stops, because the data is already there.

import { createRequire } from 'node:module'

const projectId = process.argv[2]
if (!projectId) throw new Error('Usage: node scripts/load-practice-data.mjs <test-project-id>')
if (projectId === 'grove-mart') throw new Error('Refusing: grove-mart is the real project. Practice data only goes into a test project.')

const require = createRequire(new URL('../functions/package.json', import.meta.url))
const { initializeApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore')

initializeApp({ projectId })
const db = getFirestore('stock')
const auth = getAuth()

if ((await db.collection('inv_settings').doc('practice').get()).exists) {
  console.log(`Practice data is already in ${projectId}. Nothing to do.`)
  process.exit(0)
}

// ---- Dates: the shop day is Cambodia time (UTC+7) ----
const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
const day = (n) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10)
const at = (d, hour) => Timestamp.fromDate(new Date(Date.parse(`${d}T${String(hour).padStart(2, '0')}:00:00Z`) - 7 * 3600e3))

// ---- Users (password practice123) ----
async function user(email, name, role, branchRoles) {
  let u
  try {
    u = await auth.createUser({ email, password: 'practice123', displayName: name })
  } catch {
    u = await auth.getUserByEmail(email)
  }
  await db.collection('inv_users').doc(u.uid).set({ name, email, role, branchRoles, active: true, createdByStock: true, createdAt: FieldValue.serverTimestamp() })
}
await user('owner@grove.kh', 'Mr Ann (test)', 'owner', {})
await user('vanna@grove.kh', 'Vanna', 'member', { rv: 'manager', bkk: 'viewer' })
await user('dara@grove.kh', 'Dara', 'member', { rv: 'staff' })

// ---- Settings, branches, items ----
await db.collection('inv_settings').doc('main').set({ usdToKhr: 4100, categories: ['Coffee', 'Dairy', 'Tea', 'Packaging', 'Other'] })
await db.collection('inv_branches').doc('rv').set({ name: 'Riverside', code: 'RV', address: 'Sisowath Quay', active: true })
await db.collection('inv_branches').doc('bkk').set({ name: 'Toul Kork', code: 'TK', address: 'Street 315', active: true })

const ITEMS = {
  milk: { name: 'Fresh milk', category: 'Dairy', baseUnit: 'ml', purchaseUnit: 'carton 1 L', unitsPerPurchase: 1000, lastCostUsd: 1.6, perishable: true, shelfLifeDays: 10, defaultReorderPoint: 5000 },
  cream: { name: 'Whipping cream', category: 'Dairy', baseUnit: 'ml', purchaseUnit: 'carton 1 L', unitsPerPurchase: 1000, lastCostUsd: 4.5, perishable: true, shelfLifeDays: 14, defaultReorderPoint: 1000 },
  condensed: { name: 'Condensed milk', category: 'Dairy', baseUnit: 'g', purchaseUnit: 'can 390 g', unitsPerPurchase: 390, lastCostUsd: 1.2, perishable: false, shelfLifeDays: 0, defaultReorderPoint: 3900 },
  beans: { name: 'Arabica beans', category: 'Coffee', baseUnit: 'g', purchaseUnit: 'bag 1 kg', unitsPerPurchase: 1000, lastCostUsd: 14, perishable: false, shelfLifeDays: 0, defaultReorderPoint: 2000 },
  robusta: { name: 'Robusta beans', category: 'Coffee', baseUnit: 'g', purchaseUnit: 'bag 1 kg', unitsPerPurchase: 1000, lastCostUsd: 9, perishable: false, shelfLifeDays: 0, defaultReorderPoint: 2000 },
  matcha: { name: 'Matcha powder', category: 'Tea', baseUnit: 'g', purchaseUnit: 'pack 100 g', unitsPerPurchase: 100, lastCostUsd: 6, perishable: false, shelfLifeDays: 0, defaultReorderPoint: 200 },
  cups: { name: 'Cup 16 oz', category: 'Packaging', baseUnit: 'pcs', purchaseUnit: 'sleeve 50', unitsPerPurchase: 50, lastCostUsd: 3.5, perishable: false, shelfLifeDays: 0, defaultReorderPoint: 200 },
}
const cost = (id) => ITEMS[id].lastCostUsd / ITEMS[id].unitsPerPurchase
for (const [id, d] of Object.entries(ITEMS)) await db.collection('inv_items').doc(id).set({ ...d, sku: '', active: true })

// ---- Suppliers ----
await db.collection('inv_suppliers').doc('dairy').set({
  name: 'Phnom Penh Dairy', contactName: 'Sokha', phone: '012 345 678', telegram: '@ppdairy', email: '', address: 'Toul Kork',
  paymentTerms: 'Cash on delivery', leadTimeDays: 1, itemIds: ['milk', 'cream', 'condensed'], note: '', active: true,
})
await db.collection('inv_suppliers').doc('roaster').set({
  name: 'Mondulkiri Roasters', contactName: 'Dara', phone: '098 765 432', telegram: '@mkroast', email: '', address: 'Sen Sok',
  paymentTerms: '7 days', leadTimeDays: 3, itemIds: ['beans', 'robusta'], note: '', active: true,
})

// ---- Menu with recipes ----
await db.collection('inv_products').doc('khmer').set({ name: 'Khmer Iced Coffee', category: 'Coffee', groveName: '', active: true,
  sizes: [{ key: 'M', label: 'Medium', priceUsd: 1.75 }, { key: 'L', label: 'Large', priceUsd: 2.25 }],
  recipes: { M: [{ itemId: 'robusta', qty: 20 }, { itemId: 'condensed', qty: 30 }, { itemId: 'cups', qty: 1 }], L: [{ itemId: 'robusta', qty: 25 }, { itemId: 'condensed', qty: 40 }, { itemId: 'cups', qty: 1 }] } })
await db.collection('inv_products').doc('americano').set({ name: 'Americano', category: 'Coffee', groveName: 'Americano Ice', active: true,
  sizes: [{ key: 'one', label: 'One size', priceUsd: 1.5 }], recipes: { one: [{ itemId: 'robusta', qty: 18 }, { itemId: 'cups', qty: 1 }] } })
await db.collection('inv_products').doc('latte').set({ name: 'Iced Latte', category: 'Coffee', groveName: '', active: true,
  sizes: [{ key: 'one', label: 'One size', priceUsd: 2.5 }], recipes: { one: [{ itemId: 'beans', qty: 18 }, { itemId: 'milk', qty: 220 }, { itemId: 'cups', qty: 1 }] } })
// No recipe on purpose, so you can see the "recipe missing" warning and add one.
await db.collection('inv_products').doc('matcha').set({ name: 'Matcha Latte', category: 'Tea', groveName: '', active: true,
  sizes: [{ key: 'one', label: 'One size', priceUsd: 2.75 }], recipes: {} })

// ---- Stock on hand today ----
const stock = (branchId, itemId, qty, reorderPoint, parLevel) =>
  db.collection('inv_stock').doc(`${branchId}_${itemId}`).set({ branchId, itemId, itemName: ITEMS[itemId].name, baseUnit: ITEMS[itemId].baseUnit, qty, avgCostUsd: cost(itemId), reorderPoint, parLevel })
await stock('rv', 'milk', 9000, 5000, 20000)
await stock('rv', 'cream', 2000, 1000, 3000)
await stock('rv', 'condensed', 7800, 3900, 11700)
await stock('rv', 'beans', 1500, 2000, 8000) // below reorder point
await stock('rv', 'robusta', -150, 2000, 8000) // below zero: shows the "check this" alert
await stock('rv', 'matcha', 300, 200, 600)
await stock('rv', 'cups', 1200, 200, 1000)
await stock('bkk', 'milk', 8000, 5000, 15000)
await stock('bkk', 'robusta', 4000, 2000, 6000)
await stock('bkk', 'condensed', 1500, 2000, 6000)
await stock('bkk', 'cups', 600, 200, 800)

// ---- Expiry lots at Riverside ----
const lot = (itemId, qty, expiryDate) =>
  db.collection('inv_batches').add({ branchId: 'rv', itemId, itemName: ITEMS[itemId].name, qtyReceived: qty, qtyLeft: qty, expiryDate, receivedAt: FieldValue.serverTimestamp(), refId: null })
await lot('milk', 6000, day(-10)) // used up long ago
await lot('milk', 3000, day(-1)) // expired yesterday
await lot('milk', 3000, day(1)) // expires tomorrow
await lot('milk', 3000, day(8))
await lot('cream', 1000, day(3))

// ---- A week of sales, deliveries, waste and a stock count (for Reports and History) ----
const batch = db.batch()
const mv = (branchId, d, hour, type, itemId, qty, extra = {}) =>
  batch.set(db.collection('inv_movements').doc(), {
    branchId, itemId, itemName: ITEMS[itemId].name, baseUnit: ITEMS[itemId].baseUnit, type, qtyChange: qty, qtyBefore: 0, qtyAfter: 0,
    unitCostUsd: cost(itemId), valueUsd: Math.round(qty * cost(itemId) * 10000) / 10000, reason: null, expiryDate: null, note: null,
    refType: null, refId: null, userId: 'practice', userName: 'Dara', createdAt: at(d, hour), ...extra,
  })
for (const [branchId, scale] of [['rv', 1], ['bkk', 0.6]]) {
  for (let n = 7; n >= 1; n--) {
    const d = day(-n)
    const khmer = Math.round((40 + ((n * 7) % 13)) * scale)
    const ame = Math.round((25 + ((n * 5) % 9)) * scale)
    const latte = Math.round((18 + ((n * 3) % 7)) * scale)
    const cups = khmer + ame + latte
    const salesUsd = Math.round((khmer * 1.75 + ame * 1.5 + latte * 2.5) * 100) / 100
    const ref = db.collection('inv_sales').doc()
    const use = { robusta: khmer * 20 + ame * 18, condensed: khmer * 30, milk: latte * 220, beans: latte * 18, cups }
    for (const [itemId, q] of Object.entries(use)) mv(branchId, d, 20, 'sale', itemId, -q, { refType: 'sale', refId: ref.id })
    const costUsd = Object.entries(use).reduce((s, [i, q]) => s + q * cost(i), 0)
    batch.set(ref, { branchId, date: d, source: 'manual', key: null, note: 'Practice data', lines: [], usage: [], cups, costUsd: Math.round(costUsd * 100) / 100, salesUsd, status: 'done', createdBy: 'practice', createdByName: 'Dara', createdAt: at(d, 20) })
    if (n === 6 || n === 2) mv(branchId, d, 9, 'waste', 'milk', -2000 * scale, { reason: 'expired' })
    if (n === 4) mv(branchId, d, 15, 'waste', 'beans', -120, { reason: 'spilled' })
    if (n === 1) mv(branchId, d, 16, 'waste', 'cups', -10, { reason: 'damaged' })
    if (n === 7 || n === 4) {
      mv(branchId, d, 8, 'receive', 'milk', 24000 * scale)
      mv(branchId, d, 8, 'receive', 'robusta', 5000)
      mv(branchId, d, 8, 'receive', 'cups', 500)
    }
    if (n === 1 && branchId === 'rv') {
      mv(branchId, d, 11, 'count', 'milk', -1500, { reason: 'Stock count', refType: 'count' })
      mv(branchId, d, 11, 'count', 'beans', -50, { reason: 'Stock count', refType: 'count' })
      mv(branchId, d, 11, 'count', 'robusta', 150, { reason: 'Stock count', refType: 'count' })
    }
  }
}
await batch.commit()

await db.collection('inv_settings').doc('practice').set({ loadedAt: FieldValue.serverTimestamp(), shopDay: today })
console.log(`Practice data loaded into ${projectId} (shop day ${today}).`)
console.log('Logins (password practice123): owner@grove.kh, vanna@grove.kh, dara@grove.kh')
