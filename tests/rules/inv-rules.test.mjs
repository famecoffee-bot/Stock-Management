// Tests for firestore.rules (the stock app's own "stock" database), run on the emulator:
//   npm run test:rules
import { after, before, beforeEach, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'

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
  })
})

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
