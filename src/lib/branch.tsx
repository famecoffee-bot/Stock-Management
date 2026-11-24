import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { orderBy } from 'firebase/firestore'
import { COL } from './collections'
import { useCollection } from './data'
import { useProfile } from './auth'
import { visibleBranchIds } from './permissions'
import type { Branch } from './types'

// "Which branch am I working at?" Chosen once in the top bar and remembered on
// this phone/computer, so staff at one shop never have to pick it again.

interface BranchState {
  branches: Branch[] // open branches this person can see
  allBranches: Branch[] // every open branch (for transfer destinations)
  current: Branch | null
  setCurrent: (id: string) => void
  loading: boolean
}

const Ctx = createContext<BranchState>({ branches: [], allBranches: [], current: null, setCurrent: () => {}, loading: true })
const KEY = 'grove-stock.branch'

function readSaved(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

export function BranchProvider({ children }: { children: ReactNode }) {
  const me = useProfile()
  const { rows, loading } = useCollection<Branch>(COL.branches, [orderBy('code')])
  const [chosen, setChosen] = useState(readSaved)

  const allBranches = useMemo(() => rows.filter((b) => b.active), [rows])
  const branches = useMemo(() => {
    const ok = new Set(visibleBranchIds(me, allBranches.map((b) => b.id)))
    return allBranches.filter((b) => ok.has(b.id))
  }, [me, allBranches])
  const current = branches.find((b) => b.id === chosen) ?? branches[0] ?? null

  useEffect(() => {
    if (current && current.id !== chosen) setChosen(current.id)
  }, [current, chosen])

  const setCurrent = (id: string) => {
    setChosen(id)
    try {
      localStorage.setItem(KEY, id)
    } catch {
      /* private mode: just don't remember */
    }
  }

  return <Ctx.Provider value={{ branches, allBranches, current, setCurrent, loading }}>{children}</Ctx.Provider>
}

export const useBranch = () => useContext(Ctx)
