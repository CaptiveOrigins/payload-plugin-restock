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
  slugs?: { suppliers?: string; items?: string; orders?: string; settings?: string }
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
    settings?: (c: CollectionConfig) => CollectionConfig
  }
  /** Admin group for Restock's collections. Default `Restock`, or Kitting's group when Kitting is installed. */
  adminGroup?: string
  /**
   * Carrier tracking (optional; crossing `restock-tracking`). `track` is called when staff add a
   * shipment to an ordered purchase order; your app then calls `markDelivered` when the carrier says it
   * arrived. Without it, staff mark shipments delivered by hand. A delivery never adds stock.
   */
  tracking?: { track?: TrackShipment }
  /** "Arrived, please confirm" emails to staff (optional), once per delivered shipment. */
  notify?: {
    recipients?: string[] | ((args: { payload: Payload; scope: ID | null }) => string[] | Promise<string[]>)
    /** May email go out from here right now? Default: always. */
    canSend?: (args: { payload: Payload }) => boolean | Promise<boolean>
    sendEmail?: (args: { payload: Payload; to: string[]; subject: string; text: string; html: string }) => Promise<void>
  }
}

export type TrackShipment = (args: {
  payload: Payload
  shipment: { carrier: string; trackingNumber: string }
  order: { id: ID; number: string; scope: ID | null }
}) => Promise<{ trackerId?: string | null } | void>

export type ResolvedRestock = {
  suppliers: string
  items: string
  orders: string
  settings: string
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
  track?: TrackShipment
  notify?: RestockPluginOptions['notify']
  /** For other plugins (Kitting's overview): orders whose parcels arrived and wait for a person to confirm. */
  arrived?: (args: { payload: Payload; user?: unknown; scope?: ID | null }) => Promise<{ id: ID; number: string; supplier: string; deliveredAt: string | null }[]>
}
