import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'

// Every change to stock goes through a Cloud Function (see functions/stock-api.js).
// The app never writes stock numbers itself, so they cannot be faked or get out of step.

export type ChangeType = 'receive' | 'waste' | 'adjust'

export interface ChangeLine {
  itemId: string
  /** In base units (g, ml, pcs). For "adjust", + adds and - removes. */
  qty: number
  /** Receive only: USD per base unit. */
  unitCostUsd?: number
  /** Receive only, perishable items: YYYY-MM-DD. */
  expiryDate?: string
  reason?: string
}

const call = <T>(name: string) => async (data: unknown) => (await httpsCallable(functions, name)(data)).data as T

export const recordMovement = call<{ ok: true; lines: number }>('invRecordMovement') as (d: {
  branchId: string
  type: ChangeType
  lines: ChangeLine[]
  note?: string
}) => Promise<{ ok: true; lines: number }>

export const sendTransfer = call<{ ok: true; id: string }>('invSendTransfer') as (d: {
  fromBranchId: string
  toBranchId: string
  lines: { itemId: string; qty: number }[]
  note?: string
}) => Promise<{ ok: true; id: string }>

export const receiveTransfer = call<{ ok: true; short: boolean }>('invReceiveTransfer') as (d: {
  transferId: string
  received: Record<string, number>
}) => Promise<{ ok: true; short: boolean }>

export const cancelTransfer = call<{ ok: true }>('invCancelTransfer') as (d: { transferId: string }) => Promise<{ ok: true }>

export const setStockLevels = call<{ ok: true }>('invSetStockLevels') as (d: {
  branchId: string
  itemId: string
  reorderPoint: number
  parLevel: number
}) => Promise<{ ok: true }>

// ---- Phase 3: purchase orders (functions/purchasing-api.js)

export interface PoInputLine {
  itemId: string
  /** In purchase units (bags, cartons). */
  packs: number
  /** USD for one purchase unit. */
  packCostUsd: number
}

export const savePurchaseOrder = call<{ ok: true; id: string; number: string }>('invSavePurchaseOrder') as (d: {
  id?: string
  branchId: string
  supplierId: string
  expectedDate?: string
  note?: string
  lines: PoInputLine[]
}) => Promise<{ ok: true; id: string; number: string }>

export type PoAction = 'send' | 'cancel' | 'close' | 'reopen'

export const purchaseOrderAction = call<{ ok: true; status: string }>('invPurchaseOrderAction') as (d: {
  id: string
  action: PoAction
}) => Promise<{ ok: true; status: string }>

export const receivePurchaseOrder = call<{ ok: true; status: string }>('invReceivePurchaseOrder') as (d: {
  id: string
  note?: string
  lines: { itemId: string; packs: number; packCostUsd?: number; expiryDate?: string }[]
}) => Promise<{ ok: true; status: string }>
