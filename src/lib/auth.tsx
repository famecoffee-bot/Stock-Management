import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { onAuthStateChanged, signOut, type User } from 'firebase/auth'
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore'
import { auth, db } from './firebase'
import { COL } from './collections'
import type { InvUser } from './types'

// Who is using the app?
//  1. They sign in with email + password (Firebase Authentication, shared with grove-system-kh).
//  2. We read inv_users/<uid>: that document says their role and branches.
//  3. A grove-system-kh owner (listed in grove_config/owners) who has no inv_users
//     document yet can claim an "owner" profile. The app cannot read that list itself;
//     the Firestore rules check it when the profile is saved. Everyone else is added by an owner.

type State =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'noProfile'; user: User }
  | { status: 'ready'; user: User; profile: InvUser }

const Ctx = createContext<State>({ status: 'loading' })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    let stopProfile: (() => void) | undefined
    const stopAuth = onAuthStateChanged(auth, (user) => {
      stopProfile?.()
      if (!user || user.isAnonymous) {
        setState({ status: 'signedOut' })
        return
      }
      setState({ status: 'loading' })
      stopProfile = onSnapshot(
        doc(db, COL.users, user.uid),
        (snap) => {
          if (snap.exists()) {
            setState({ status: 'ready', user, profile: { id: snap.id, ...(snap.data() as Omit<InvUser, 'id'>) } })
          } else {
            setState({ status: 'noProfile', user })
          }
        },
        () => setState({ status: 'noProfile', user }),
      )
    })
    return () => {
      stopProfile?.()
      stopAuth()
    }
  }, [])

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)

/** The signed-in person's profile. Only call inside pages that render after login. */
export function useProfile(): InvUser {
  const s = useAuth()
  if (s.status !== 'ready') throw new Error('useProfile used before login')
  return s.profile
}

/** First-time setup: a grove-system-kh owner creates their own owner profile. */
export async function claimOwner(user: User, name: string) {
  await setDoc(doc(db, COL.users, user.uid), {
    name,
    email: user.email ?? '',
    role: 'owner',
    branchRoles: {},
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  })
}

export const logout = () => signOut(auth)
