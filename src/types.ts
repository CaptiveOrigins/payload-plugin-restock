import type { Access, CollectionConfig, Payload, PayloadRequest } from 'payload'

export type ID = string | number

/** How a supplier takes orders. */
export type OrderMethod = 'quick-order' | 'csv' | 'email' | 'website' | 'phone'

/** Where a purchase order is in its life. Only `draft` lines can be edited. */
export type OrderStatus = 'draft' | 'approved' | 'ordered' | 'partly-received' | 'received' | 'cancelled'

/** For the Console (Tier 2): whether it managed to fill the vendor's cart. */
export type CartStatus = 'filled' | 'failed'

/** A host's own idea of what to buy, for sites without Kitting: per supplier item, in packs. */
export type NeedsFunction = (args: { payload: Payload; req: Partial<PayloadRequest>; scope: ID | null }) => Promise<{ supplierItem: ID; packs: number; why?: string }[]>

export type RestockPluginOptions = {
  /**
   * Collection slugs. Defaults: `suppliers`, `supplier-items`, `purchase-orders`. If a `suppliers`
   * collection already exists (Kitting adds one), Restock adds its ordering fields to it instead of
   * making a second list, so put Restock after Kitting in `plugins`.
   */
  slugs?: { suppliers?: string; items?: string; orders?: string }
  /**
   * Who may do what. `manage` edits suppliers, supplier items and draft orders, and receives.
   * `approve` approves orders and marks them as ordered (default: `manage`). `read` sees them
   * (default: `manage`). Plain Payload access functions; they may return a query.
   */
  access?: { read?: Access; manage?: Access; approve?: Access }
  /** The field that separates sites, such as `tenant`. Your tenant plugin adds it. */
  scopeField?: string
  /** Currency for prices and totals. Default USD. */
  currency?: string
  /** Use Kitting for what to buy and for receiving. Default: when Kitting is installed. */
  kitting?: boolean
  /** Without Kitting: your own idea of what to buy. Without either, orders are filled in by hand. */
  needs?: NeedsFunction
  overrides?: {
    suppliers?: (c: CollectionConfig) => CollectionConfig
    items?: (c: CollectionConfig) => CollectionConfig
    orders?: (c: CollectionConfig) => CollectionConfig
  }
  /** Admin group for Restock's collections. Default `Restock`, or Kitting's group when Kitting is installed. */
  adminGroup?: string
}

export type ResolvedRestock = {
  suppliers: string
  items: string
  orders: string
  userSlug: string
  read: Access
  manage: Access
  approve: Access
  scopeField?: string
  currency: string
  kitting: boolean | undefined
  needs?: NeedsFunction
  adminGroup: string
  /** True when Restock added its fields to an existing suppliers collection. */
  sharedSuppliers: boolean
}
