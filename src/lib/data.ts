import { useEffect, useState } from 'react'
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  addDoc,
  updateDoc,
  type DocumentData,
  type QueryConstraint,
  query,
} from 'firebase/firestore'
import { auth, db } from './firebase'
import { COL } from './collections'
import { DEFAULT_SETTINGS, type Settings } from './types'

/** Live list of a collection. Re-renders whenever the data changes in Firestore. */
export function useCollection<T extends { id: string }>(name: string, ...constraints: QueryConstraint[]) {
  const [rows, setRows] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const key = name + constraints.length

  useEffect(() => {
    const q = query(collection(db, name), ...constraints)
    return onSnapshot(
      q,
      (snap) => {
        setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as DocumentData) }) as T))
        setLoading(false)
      },
      (err) => {
        setError(err.message)
        setLoading(false)
      },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { rows, loading, error }
}

/** Live settings document, with sensible defaults until it is saved once. */
export function useSettings(): Settings {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS)
  useEffect(
    () =>
      onSnapshot(
        doc(db, COL.settings, 'main'),
        (snap) => setS({ ...DEFAULT_SETTINGS, ...(snap.data() as Partial<Settings> | undefined) }),
        () => undefined,
      ),
    [],
  )
  return s
}

function stamp(): Record<string, unknown> {
  return { updatedAt: serverTimestamp(), updatedBy: auth.currentUser?.uid ?? null }
}

/** Create (no id) or update (with id) a document, adding who/when fields. */
export async function saveDoc(name: string, id: string | undefined, data: Record<string, unknown>) {
  if (id) {
    await updateDoc(doc(db, name, id), { ...data, ...stamp() })
    return id
  }
  const ref = await addDoc(collection(db, name), { ...data, ...stamp(), createdAt: serverTimestamp() })
  return ref.id
}

export async function saveSettings(data: Settings) {
  await setDoc(doc(db, COL.settings, 'main'), { ...data, ...stamp() })
}
