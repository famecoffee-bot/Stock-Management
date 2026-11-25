// Tests for firestore.rules (the stock app's own "stock" database), run on the emulator:
//   npm run test:rules
import { after, before, beforeEach, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore'

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8')

let env
const pw = (email) => ({ email, firebase: { sign_in_provider: 'password' } })
const as = (uid, email) => env.authenticatedContext(uid, pw(email)).firestore()
const user = (role, branchRoles = {}, active = true) => ({ name: role, email: `${role}@x.kh`, role, branchRoles, active })

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-grove-stock', firestore: { rules } })
})
after(async () => env.cleanup())
beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'inv_users/owner1'), user('owner'))
    await setDoc(doc(db, 'inv_users/admin1'), user('admin'))
    await setDoc(doc(db, 'inv_users/staff1'), user('member', { b1: 'staff' }))
    await setDoc(doc(db, 'inv_users/gone1'), user('member', { b1: 'manager' }, false))
    await setDoc(doc(db, 'inv_stock/b1_milk'), { branchId: 'b1', itemId: 'milk', qty: 1000 })
    await setDoc(doc(db, 'inv_stock/b2_milk'), { branchId: 'b2', itemId: 'milk', qty: 500 })
    await setDoc(doc(db, 'inv_movements/m1'), { branchId: 'b1', itemId: 'milk', type: 'receive', qtyChange: 1000 })
    await setDoc(doc(db, 'inv_movements/m2'), { branchId: 'b2', itemId: 'milk', type: 'receive', qtyChange: 500 })
    await setDoc(doc(db, 'inv_counts/c1'), { branchId: 'b1', status: 'open', lines: [] })
    await setDoc(doc(db, 'inv_counts/c2'), { branchId: 'b2', status: 'open', lines: [] })
    await setDoc(doc(db, 'inv_batches/l1'), { branchId: 'b1', itemId: 'milk', expiryDate: '2026-12-01' })
    await setDoc(doc(db, 'inv_batches/l2'), { branchId: 'b2', itemId: 'milk', expiryDate: '2026-12-01' })
    await setDoc(doc(db, 'inv_transfers/t1'), { fromBranchId: 'b2', toBranchId: 'b1', status: 'sent', lines: [] })
    await setDoc(doc(db, 'inv_transfers/t2'), { fromBranchId: 'b2', toBranchId: 'b3', status: 'sent', lines: [] })
    await setDoc(doc(db, 'inv_suppliers/s1'), supplier)
    await setDoc(doc(db, 'inv_purchase_orders/po1'), { branchId: 'b1', status: 'sent', lines: [], number: 'PO-0001' })
    await setDoc(doc(db, 'inv_purchase_orders/po2'), { branchId: 'b2', status: 'sent', lines: [], number: 'PO-0002' })
    await setDoc(doc(db, 'inv_counters/purchaseOrders'), { next: 3 })
    await setDoc(doc(db, 'inv_products/latte'), product)
    await setDoc(doc(db, 'inv_sales/s1'), { branchId: 'b1', date: '2026-11-24', status: 'done', lines: [], usage: [] })
    await setDoc(doc(db, 'inv_sales/s2'), { branchId: 'b2', date: '2026-11-24', status: 'done', lines: [], usage: [] })
  })
})

const supplier = { name: 'Bean Co', contactName: '', phone: '012', telegram: '', email: '', address: '', paymentTerms: 'COD', leadTimeDays: 1, itemIds: ['milk'], note: '', active: true }
const product = { name: 'Iced Latte', category: 'Coffee', groveName: '', sizes: [{ key: 'L', label: 'Large', priceUsd: 2.5 }], recipes: { L: [{ itemId: 'milk', qty: 220 }] }, active: true }
const item = { name: 'Milk', baseUnit: 'ml', unitsPerPurchase: 1000, lastCostUsd: 1.5, active: true }

test('nobody can create a profile from the app (only Cloud Functions can)', async () => {
  const profile = { name: 'Boss', email: 'boss@grove.kh', role: 'owner', branchRoles: {}, active: true }
  await assertFails(setDoc(doc(as('boss', 'boss@grove.kh'), 'inv_users/boss'), profile))
  await assertFails(setDoc(doc(as('owner1', 'owner@x.kh'), 'inv_users/new1'), profile))
})

test('nobody can mark a login as made by the stock app', async () => {
  await assertFails(updateDoc(doc(as('owner1', 'owner@x.kh'), 'inv_users/admin1'), { createdByStock: true }))
})

test('only admins write items; everyone with a profile reads them', async () => {
  await assertSucceeds(setDoc(doc(as('admin1', 'admin@x.kh'), 'inv_items/milk'), item))
  await assertFails(setDoc(doc(as('staff1', 'member@x.kh'), 'inv_items/milk2'), item))
  await assertSucceeds(getDoc(doc(as('staff1', 'member@x.kh'), 'inv_items/milk')))
  await assertFails(getDoc(doc(as('nobody', 'nobody@x.kh'), 'inv_items/milk')))
})

test('items with a bad unit or zero pack size are refused', async () => {
  const db = as('owner1', 'owner@x.kh')
  await assertFails(setDoc(doc(db, 'inv_items/a'), { ...item, baseUnit: 'kg' }))
  await assertFails(setDoc(doc(db, 'inv_items/b'), { ...item, unitsPerPurchase: 0 }))
})

test('a blocked user can read nothing', async () => {
  await assertFails(getDoc(doc(as('gone1', 'member@x.kh'), 'inv_stock/b1_milk')))
})

test('staff see stock only at their own branch', async () => {
  const db = as('staff1', 'member@x.kh')
  await assertSucceeds(getDoc(doc(db, 'inv_stock/b1_milk')))
  await assertFails(getDoc(doc(db, 'inv_stock/b2_milk')))
  await assertSucceeds(getDoc(doc(as('admin1', 'admin@x.kh'), 'inv_stock/b2_milk')))
})

test('nobody writes stock numbers directly (only Cloud Functions)', async () => {
  await assertFails(updateDoc(doc(as('owner1', 'owner@x.kh'), 'inv_stock/b1_milk'), { qty: 99999 }))
})

test('admins cannot promote to owner or edit an owner; owners can', async () => {
  await assertFails(updateDoc(doc(as('admin1', 'admin@x.kh'), 'inv_users/staff1'), { role: 'owner' }))
  await assertFails(updateDoc(doc(as('admin1', 'admin@x.kh'), 'inv_users/owner1'), { active: false }))
  await assertSucceeds(updateDoc(doc(as('admin1', 'admin@x.kh'), 'inv_users/staff1'), { branchRoles: { b1: 'manager' } }))
  await assertSucceeds(updateDoc(doc(as('owner1', 'owner@x.kh'), 'inv_users/admin1'), { role: 'member' }))
})

test('nobody can change their own role', async () => {
  await assertFails(updateDoc(doc(as('staff1', 'member@x.kh'), 'inv_users/staff1'), { role: 'admin' }))
  await assertFails(updateDoc(doc(as('admin1', 'admin@x.kh'), 'inv_users/admin1'), { role: 'owner' }))
})

test('staff cannot list all users', async () => {
  await assertSucceeds(getDoc(doc(as('staff1', 'member@x.kh'), 'inv_users/staff1')))
  await assertFails(getDoc(doc(as('staff1', 'member@x.kh'), 'inv_users/admin1')))
})

test('staff can list stock and history of their branch, not of others', async () => {
  const db = as('staff1', 'member@x.kh')
  await assertSucceeds(getDocs(query(collection(db, 'inv_stock'), where('branchId', '==', 'b1'))))
  await assertSucceeds(getDocs(query(collection(db, 'inv_movements'), where('branchId', '==', 'b1'))))
  await assertFails(getDocs(query(collection(db, 'inv_movements'), where('branchId', '==', 'b2'))))
  await assertFails(getDocs(collection(db, 'inv_movements')))
  await assertSucceeds(getDocs(collection(as('admin1', 'admin@x.kh'), 'inv_movements')))
})

test('a branch sees transfers coming to it, but not transfers between other branches', async () => {
  const db = as('staff1', 'member@x.kh')
  await assertSucceeds(getDocs(query(collection(db, 'inv_transfers'), where('toBranchId', '==', 'b1'))))
  await assertSucceeds(getDocs(query(collection(db, 'inv_transfers'), where('fromBranchId', '==', 'b1'))))
  await assertSucceeds(getDoc(doc(db, 'inv_transfers/t1')))
  await assertFails(getDoc(doc(db, 'inv_transfers/t2')))
  await assertFails(updateDoc(doc(as('owner1', 'owner@x.kh'), 'inv_transfers/t1'), { status: 'received' }))
})

test('nobody writes movements from the app', async () => {
  await assertFails(setDoc(doc(as('owner1', 'owner@x.kh'), 'inv_movements/fake'), { branchId: 'b1', qtyChange: 5 }))
})

// ---- Phase 3: suppliers and purchase orders

test('only admins add or edit suppliers; everyone with a profile reads them; nobody deletes', async () => {
  await assertSucceeds(setDoc(doc(as('admin1', 'admin@x.kh'), 'inv_suppliers/s2'), supplier))
  await assertSucceeds(updateDoc(doc(as('owner1', 'owner@x.kh'), 'inv_suppliers/s1'), { phone: '099' }))
  await assertFails(setDoc(doc(as('staff1', 'member@x.kh'), 'inv_suppliers/s3'), supplier))
  await assertSucceeds(getDoc(doc(as('staff1', 'member@x.kh'), 'inv_suppliers/s1')))
  await assertFails(getDoc(doc(as('nobody', 'nobody@x.kh'), 'inv_suppliers/s1')))
  await assertFails(deleteDoc(doc(as('owner1', 'owner@x.kh'), 'inv_suppliers/s1')))
})

test('suppliers without a name, with odd fields or a negative lead time are refused', async () => {
  const db = as('owner1', 'owner@x.kh')
  await assertFails(setDoc(doc(db, 'inv_suppliers/a'), { ...supplier, name: '' }))
  await assertFails(setDoc(doc(db, 'inv_suppliers/b'), { ...supplier, isOwner: true }))
  await assertFails(setDoc(doc(db, 'inv_suppliers/c'), { ...supplier, leadTimeDays: -2 }))
  await assertFails(setDoc(doc(db, 'inv_suppliers/d'), { ...supplier, itemIds: 'milk' }))
})

test('purchase orders: a branch reads its own, never another branch; nobody writes from the app', async () => {
  const db = as('staff1', 'member@x.kh')
  await assertSucceeds(getDoc(doc(db, 'inv_purchase_orders/po1')))
  await assertFails(getDoc(doc(db, 'inv_purchase_orders/po2')))
  await assertSucceeds(getDocs(query(collection(db, 'inv_purchase_orders'), where('branchId', '==', 'b1'))))
  await assertFails(getDocs(collection(db, 'inv_purchase_orders')))
  await assertSucceeds(getDoc(doc(as('admin1', 'admin@x.kh'), 'inv_purchase_orders/po2')))
  await assertFails(updateDoc(doc(as('owner1', 'owner@x.kh'), 'inv_purchase_orders/po1'), { status: 'received' }))
  await assertFails(setDoc(doc(as('owner1', 'owner@x.kh'), 'inv_purchase_orders/po9'), { branchId: 'b1', status: 'draft' }))
})

test('the order number counter is hidden from the app', async () => {
  await assertFails(getDoc(doc(as('owner1', 'owner@x.kh'), 'inv_counters/purchaseOrders')))
  await assertFails(setDoc(doc(as('owner1', 'owner@x.kh'), 'inv_counters/purchaseOrders'), { next: 1 }))
})

// ---- Phase 4: menu products, recipes and sales

test('only admins edit the menu and recipes; everyone with a profile reads it; nobody deletes', async () => {
  await assertSucceeds(setDoc(doc(as('admin1', 'admin@x.kh'), 'inv_products/mocha'), product))
  await assertSucceeds(updateDoc(doc(as('owner1', 'owner@x.kh'), 'inv_products/latte'), { recipes: { L: [{ itemId: 'milk', qty: 200 }] } }))
  await assertFails(updateDoc(doc(as('staff1', 'member@x.kh'), 'inv_products/latte'), { recipes: {} }))
  await assertSucceeds(getDoc(doc(as('staff1', 'member@x.kh'), 'inv_products/latte')))
  await assertFails(getDoc(doc(as('nobody', 'nobody@x.kh'), 'inv_products/latte')))
  await assertFails(deleteDoc(doc(as('owner1', 'owner@x.kh'), 'inv_products/latte')))
})

test('products need a name and at least one size; no extra fields', async () => {
  const db = as('owner1', 'owner@x.kh')
  await assertFails(setDoc(doc(db, 'inv_products/a'), { ...product, name: '' }))
  await assertFails(setDoc(doc(db, 'inv_products/b'), { ...product, sizes: [] }))
  await assertFails(setDoc(doc(db, 'inv_products/c'), { ...product, recipes: 'milk' }))
  await assertFails(setDoc(doc(db, 'inv_products/d'), { ...product, price: 3 }))
})

test('sales: a branch reads its own; nobody writes them from the app (only Cloud Functions)', async () => {
  const db = as('staff1', 'member@x.kh')
  await assertSucceeds(getDoc(doc(db, 'inv_sales/s1')))
  await assertFails(getDoc(doc(db, 'inv_sales/s2')))
  await assertSucceeds(getDocs(query(collection(db, 'inv_sales'), where('branchId', '==', 'b1'))))
  await assertFails(getDocs(collection(db, 'inv_sales')))
  await assertFails(setDoc(doc(as('owner1', 'owner@x.kh'), 'inv_sales/fake'), { branchId: 'b1', lines: [] }))
  await assertFails(updateDoc(doc(as('owner1', 'owner@x.kh'), 'inv_sales/s1'), { status: 'void' }))
})

test('counts and expiry lots: a branch reads its own; nobody writes them from the app', async () => {
  const db = as('staff1', 'member@x.kh')
  await assertSucceeds(getDoc(doc(db, 'inv_counts/c1')))
  await assertFails(getDoc(doc(db, 'inv_counts/c2')))
  await assertSucceeds(getDocs(query(collection(db, 'inv_counts'), where('branchId', '==', 'b1'))))
  await assertFails(updateDoc(doc(db, 'inv_counts/c1'), { status: 'approved' }))
  await assertFails(setDoc(doc(as('owner1', 'owner@x.kh'), 'inv_counts/fake'), { branchId: 'b1', status: 'approved' }))
  await assertSucceeds(getDoc(doc(db, 'inv_batches/l1')))
  await assertFails(getDoc(doc(db, 'inv_batches/l2')))
  await assertSucceeds(getDocs(query(collection(db, 'inv_batches'), where('branchId', '==', 'b1'))))
  await assertFails(updateDoc(doc(as('owner1', 'owner@x.kh'), 'inv_batches/l1'), { qtyReceived: 0 }))
})
