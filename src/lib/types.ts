import type { BaseUnit } from './units'
import { t } from './i18n'

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

/** One item at one branch (id = branchId_itemId). Written only by Cloud Functions. */
export interface StockLevel {
  id: string
  branchId: string
  itemId: string
  itemName: string
  baseUnit: BaseUnit
  qty: number
  /** USD per base unit (weighted average). */
  avgCostUsd: number
  reorderPoint: number
  parLevel: number
}

export type MovementType = 'receive' | 'waste' | 'adjust' | 'transfer_out' | 'transfer_in' | 'sale' | 'sale_void' | 'count'

/** One line of the stock history. Never edited. */
export interface Movement {
  id: string
  branchId: string
  itemId: string
  itemName: string
  baseUnit: BaseUnit
  type: MovementType
  qtyChange: number
  qtyBefore: number
  qtyAfter: number
  unitCostUsd: number
  valueUsd: number
  reason: string | null
  expiryDate: string | null
  note: string | null
  refType: string | null
  refId: string | null
  userName: string
  createdAt?: { toDate(): Date }
}

export interface TransferLine {
  itemId: string
  itemName: string
  baseUnit: BaseUnit
  qty: number
  unitCostUsd: number
  receivedQty: number | null
}

export interface Transfer {
  id: string
  fromBranchId: string
  fromName: string
  toBranchId: string
  toName: string
  status: 'sent' | 'received' | 'cancelled'
  short?: boolean
  lines: TransferLine[]
  note: string | null
  sentByName: string
  sentAt?: { toDate(): Date }
  receivedByName?: string
  receivedAt?: { toDate(): Date }
}

export const WASTE_REASONS: { value: string; label: string }[] = [
  { value: 'expired', label: t('Expired') },
  { value: 'spilled', label: t('Spilled') },
  { value: 'damaged', label: t('Damaged') },
  { value: 'staff_drink', label: t('Staff drink') },
  { value: 'quality', label: t('Bad quality / remade') },
  { value: 'other', label: t('Other') },
]

// ---- Phase 3: suppliers and purchase orders

export interface Supplier {
  id: string
  name: string
  contactName: string
  phone: string
  /** Telegram username or phone, how most suppliers in Cambodia take orders. */
  telegram: string
  email: string
  address: string
  /** e.g. "Cash on delivery", "7 days". */
  paymentTerms: string
  /** Usual days from order to delivery. */
  leadTimeDays: number
  /** Items this supplier sells (used to fill orders quickly). */
  itemIds: string[]
  note: string
  active: boolean
}

export type PoStatus = 'draft' | 'sent' | 'partial' | 'received' | 'cancelled'

export interface PoLine {
  itemId: string
  itemName: string
  baseUnit: BaseUnit
  purchaseUnit: string
  unitsPerPurchase: number
  /** Ordered, in purchase units (bags, cartons). */
  packs: number
  /** USD for ONE purchase unit. */
  packCostUsd: number
  receivedPacks: number
  /** Price on the last delivery, if it differed. */
  receivedCostUsd?: number
}

export interface PoReceipt {
  at: { toDate(): Date }
  byName: string
  note: string | null
  lines: { itemId: string; packs: number; packCostUsd: number }[]
}

export interface PurchaseOrder {
  id: string
  number: string
  branchId: string
  branchName: string
  supplierId: string
  supplierName: string
  status: PoStatus
  /** Closed before everything arrived. */
  short: boolean
  lines: PoLine[]
  totalUsd: number
  expectedDate: string | null
  note: string | null
  receipts: PoReceipt[]
  log: { status: PoStatus; action?: string; byName: string; at: { toDate(): Date } }[]
  createdByName: string
  createdAt?: { toDate(): Date }
  sentAt?: { toDate(): Date }
}

export const PO_STATUS_LABEL: Record<PoStatus, string> = {
  draft: t('Draft'),
  sent: t('Sent, waiting'),
  partial: t('Part received'),
  received: t('Received'),
  cancelled: t('Cancelled'),
}

// ---- Phase 4: menu products, recipes and sales

export interface ProductSize {
  /** Short code used in recipes and imports: "S", "M", "L", or "one" for single-size products. */
  key: string
  label: string
  /** Selling price in USD (optional, used for cost % and margin). */
  priceUsd: number | null
}

/** One ingredient in one cup, in the item's base unit. */
export interface RecipeLine {
  itemId: string
  qty: number
}

export interface Product {
  id: string
  name: string
  category: string
  /** The name as written in grove-system-kh sales, if different (used to match imports, and in phase 7). */
  groveName: string
  sizes: ProductSize[]
  /** sizeKey -> ingredients for ONE cup of that size. */
  recipes: Record<string, RecipeLine[]>
  active: boolean
}

export interface SaleLine {
  productId: string
  productName: string
  sizeKey: string
  sizeLabel: string
  qty: number
  priceUsd: number | null
  costUsd: number
}

export interface SaleUsage {
  itemId: string
  itemName: string
  baseUnit: BaseUnit
  qty: number
  qtyAfter: number
  valueUsd: number
}

export interface Sale {
  id: string
  branchId: string
  date: string
  source: 'manual' | 'import' | 'grove'
  note: string | null
  lines: SaleLine[]
  usage: SaleUsage[]
  cups: number
  costUsd: number
  salesUsd: number | null
  status: 'done' | 'void'
  voidReason?: string
  voidedByName?: string
  createdByName: string
  createdAt?: { toDate(): Date }
}

export const PRODUCT_CATEGORIES = ['Coffee', 'Tea', 'Frappe', 'Juice & Soda', 'Food', 'Other']

// ---- Phase 5: stock counts and expiry

export interface CountLine {
  itemId: string
  itemName: string
  category: string
  baseUnit: BaseUnit
  purchaseUnit: string
  unitsPerPurchase: number
  /** What the app expected when the count started (base units). Hidden while counting. */
  expected: number
  avgCostUsd: number
  /** What was found on the shelf (base units); null = not counted yet. */
  counted: number | null
  /** Filled in when approved: counted - expected. */
  variance?: number | null
  varianceUsd?: number | null
}

export interface StockCount {
  id: string
  branchId: string
  status: 'open' | 'submitted' | 'approved' | 'cancelled'
  category: string | null
  note: string | null
  lines: CountLine[]
  totals?: { counted: number; differences: number; lossUsd: number; gainUsd: number; netUsd: number }
  createdBy: string
  createdByName: string
  createdAt?: { toDate(): Date }
  submittedByName?: string
  approvedByName?: string
  approvedAt?: { toDate(): Date }
  cancelledByName?: string
}

/** A received lot of a perishable item, with its expiry date. Made by the server on receive. */
export interface Batch {
  id: string
  branchId: string
  itemId: string
  itemName: string
  qtyReceived: number
  expiryDate: string
  receivedAt?: { toDate(): Date }
}
