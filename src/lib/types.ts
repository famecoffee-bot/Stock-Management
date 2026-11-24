import type { BaseUnit } from './units'

export type Role = 'owner' | 'admin' | 'member'
export type BranchRole = 'manager' | 'staff' | 'viewer'

export interface Branch {
  id: string
  name: string
  code: string
  address?: string
  /** Branch name as written in grove-system-kh sales (`branch` field). Used to link sales in phase 7. */
  groveBranch?: string
  active: boolean
}

export interface InvUser {
  id: string // = Firebase Auth uid
  name: string
  email: string
  role: Role
  /** Only used when role is "member": what the person may do at each branch. */
  branchRoles: Record<string, BranchRole>
  active: boolean
}

export interface Item {
  id: string
  name: string
  sku?: string
  category: string
  /** Unit all quantities are stored in. */
  baseUnit: BaseUnit
  /** How the supplier sells it, e.g. "bag 1 kg" or "carton 12 x 1 L". */
  purchaseUnit: string
  /** How many base units are in one purchase unit, e.g. 1000 (g in a 1 kg bag). */
  unitsPerPurchase: number
  /** Last cost of ONE purchase unit, in USD. */
  lastCostUsd: number
  perishable: boolean
  shelfLifeDays?: number
  /** Default reorder point for branches, in base units. */
  defaultReorderPoint: number
  active: boolean
}

export interface Settings {
  usdToKhr: number
  categories: string[]
}

export const DEFAULT_SETTINGS: Settings = {
  usdToKhr: 4100,
  categories: ['Coffee', 'Dairy', 'Syrup & Sauce', 'Tea & Powder', 'Bakery', 'Packaging', 'Cleaning', 'Other'],
}
