// Every stock collection starts with "inv_" so it can never clash with the
// collections grove-system-kh already uses in the same Firebase project.
export const COL = {
  branches: 'inv_branches',
  users: 'inv_users',
  items: 'inv_items',
  stock: 'inv_stock',
  batches: 'inv_batches',
  movements: 'inv_movements',
  suppliers: 'inv_suppliers',
  purchaseOrders: 'inv_purchase_orders',
  transfers: 'inv_transfers',
  products: 'inv_products',
  recipes: 'inv_recipes',
  sales: 'inv_sales',
  counts: 'inv_counts',
  alerts: 'inv_alerts',
  settings: 'inv_settings',
} as const

/** Document id of one item's stock at one branch. */
export const stockId = (branchId: string, itemId: string) => `${branchId}_${itemId}`
