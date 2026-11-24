// Cloud Functions for the Grove stock app.
// They live in their own codebase ("stock", see firebase.json) so deploying them
// never touches grove-system-kh's functions (codebase "default").
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { setGlobalOptions } from 'firebase-functions/v2'
import { checkNewUser } from './lib/users.js'

initializeApp()
setGlobalOptions({ region: 'asia-southeast1', maxInstances: 3 })

const db = getFirestore()
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
      throw new HttpsError('already-exists', 'This email already has a login. Ask the owner to add it by hand.')
    }
    throw new HttpsError('internal', e.message)
  }
  await db.collection(USERS).doc(user.uid).set({
    name,
    email,
    role,
    branchRoles,
    active: true,
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
  await getAuth().updateUser(uid, { password })
  return { ok: true }
})
