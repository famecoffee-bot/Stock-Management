// Cloud Functions for the Grove stock app.
// They live in their own codebase ("stock", see firebase.json) so deploying them
// never touches grove-system-kh's functions (codebase "default").
//
// HARD RULE: grove-system-kh's data is READ ONLY. All writes go to the separate
// "stock" database. The "(default)" database (grove-system-kh) is only ever read.
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { setGlobalOptions } from 'firebase-functions/v2'
import { checkNewUser, isListedOwner } from './lib/users.js'
import { stockApi } from './stock-api.js'
import { purchasingApi } from './purchasing-api.js'
import { salesApi } from './sales-api.js'
import { countsApi } from './counts-api.js'

initializeApp()
setGlobalOptions({ region: 'asia-southeast1', maxInstances: 3 })

const db = getFirestore('stock') // the stock app's own database: read and write
const groveDb = getFirestore() // grove-system-kh's database: READ ONLY, never write here
const USERS = 'inv_users'

/** The caller's stock profile, or an error if they are not an active owner/admin. */
async function requireAdmin(auth) {
  if (!auth) throw new HttpsError('unauthenticated', 'Please sign in.')
  const snap = await db.collection(USERS).doc(auth.uid).get()
  const me = snap.data()
  if (!me || !me.active || !['owner', 'admin'].includes(me.role)) {
    throw new HttpsError('permission-denied', 'Only an owner or admin can do this.')
  }
  return me
}

/**
 * First-time setup: a person whose email is on grove-system-kh's owner list
 * (grove_config/owners, only READ here) creates their own owner profile.
 */
export const invClaimOwner = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Please sign in.')
  const email = req.auth.token.email
  const name = typeof req.data?.name === 'string' ? req.data.name.trim() : ''
  if (!name || name.length > 60) throw new HttpsError('invalid-argument', 'Please enter your name.')
  const owners = (await groveDb.collection('grove_config').doc('owners').get()).data()
  if (req.auth.token.firebase?.sign_in_provider !== 'password' || !isListedOwner(email, owners?.emails)) {
    throw new HttpsError('permission-denied', 'Only emails on the grove-system-kh owner list can do this.')
  }
  const ref = db.collection(USERS).doc(req.auth.uid)
  await db.runTransaction(async (tx) => {
    if ((await tx.get(ref)).exists) throw new HttpsError('already-exists', 'You already have a profile.')
    tx.set(ref, {
      name,
      email: email.toLowerCase(),
      role: 'owner',
      branchRoles: {},
      active: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: req.auth.uid,
    })
  })
  return { ok: true }
})

/** Owner/admin creates a login (email + password) and the stock profile in one step. */
export const invCreateUser = onCall(async (req) => {
  const me = await requireAdmin(req.auth)
  const input = checkNewUser(req.data, me.role)
  if (input.error) throw new HttpsError('invalid-argument', input.error)
  const { email, password, name, role, branchRoles } = input.value

  let user
  try {
    user = await getAuth().createUser({ email, password, displayName: name })
  } catch (e) {
    if (e.code === 'auth/email-already-exists') {
      throw new HttpsError('already-exists', 'This email already has a login (maybe in grove-system-kh). Use a different email.')
    }
    throw new HttpsError('internal', e.message)
  }
  await db.collection(USERS).doc(user.uid).set({
    name,
    email,
    role,
    branchRoles,
    active: true,
    // marks a login made BY the stock app; only those may have their password changed here
    createdByStock: true,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: req.auth.uid,
  })
  return { uid: user.uid }
})

/** Owner/admin sets a new password for a stock user (admins cannot change owners). */
export const invSetPassword = onCall(async (req) => {
  const me = await requireAdmin(req.auth)
  const { uid, password } = req.data ?? {}
  if (typeof uid !== 'string' || typeof password !== 'string' || password.length < 8) {
    throw new HttpsError('invalid-argument', 'Password must be at least 8 characters.')
  }
  const target = (await db.collection(USERS).doc(uid).get()).data()
  if (!target) throw new HttpsError('not-found', 'No such stock user.')
  if (target.role === 'owner' && me.role !== 'owner') {
    throw new HttpsError('permission-denied', 'Only an owner can change an owner.')
  }
  // A login that already existed (e.g. a grove-system-kh account) is never changed from here.
  if (target.createdByStock !== true) {
    throw new HttpsError('failed-precondition', 'This login also belongs to grove-system-kh, so its password can only be changed there.')
  }
  await getAuth().updateUser(uid, { password })
  return { ok: true }
})

// ---- Phase 2: stock in / out, transfers, stock levels (stock-api.js)
export const { invRecordMovement, invSendTransfer, invReceiveTransfer, invCancelTransfer, invSetStockLevels } = stockApi(db)

// ---- Phase 3: purchase orders (purchasing-api.js). Suppliers are plain documents (rules check them).
export const { invSavePurchaseOrder, invPurchaseOrderAction, invReceivePurchaseOrder } = purchasingApi(db)

// ---- Phase 4: sales take ingredients out of stock by recipe (sales-api.js). Products and recipes are plain documents.
export const { invRecordSales, invVoidSale } = salesApi(db)

// ---- Phase 5: stock counts (counts-api.js). Expiry and alerts are worked out on screen from stock and batches.
export const { invStartCount, invSaveCount, invApproveCount, invCancelCount } = countsApi(db)
