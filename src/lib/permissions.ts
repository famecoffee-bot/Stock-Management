import type { BranchRole, InvUser } from './types'

// One place that answers "may this person do X?". The Firestore rules
// (firestore/inv.rules) enforce the same thing on the server; this copy only
// decides which buttons and pages to show.

const RANK: Record<BranchRole, number> = { viewer: 1, staff: 2, manager: 3 }

export function isAdmin(u: InvUser | null | undefined): boolean {
  return !!u && u.active && (u.role === 'owner' || u.role === 'admin')
}

export function isOwner(u: InvUser | null | undefined): boolean {
  return !!u && u.active && u.role === 'owner'
}

/** Does the person have at least `need` rights at this branch? Admins always do. */
export function canAtBranch(u: InvUser | null | undefined, branchId: string, need: BranchRole): boolean {
  if (!u || !u.active) return false
  if (isAdmin(u)) return true
  const has = u.branchRoles?.[branchId]
  return !!has && RANK[has] >= RANK[need]
}

/** Branch ids the person can see at all. */
export function visibleBranchIds(u: InvUser | null | undefined, allIds: string[]): string[] {
  if (!u || !u.active) return []
  if (isAdmin(u)) return allIds
  return allIds.filter((id) => !!u.branchRoles?.[id])
}

/** Owners may give any role; admins may not create or change owners. */
export function canAssignRole(actor: InvUser | null | undefined, target: InvUser['role']): boolean {
  if (isOwner(actor)) return true
  return isAdmin(actor) && target !== 'owner'
}
