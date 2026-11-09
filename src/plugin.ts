import type { Access, CollectionConfig, Config, Plugin } from 'payload'

import { itemsCollection, orderingFields, ordersCollection, settingsCollection, suppliersCollection } from './collections.js'
import { restockEndpoints } from './endpoints.js'
import { awaitingConfirmation, type Arrived } from './tracking.js'
import type { ResolvedRestock, RestockPluginOptions } from './types.js'

/**
 * Restock: suppliers, supplier items and purchase orders drafted from stock levels, with copy-ready
 * orders and receiving. Works on its own; with Kitting installed (before it in `plugins`), it shares
 * Kitting's supplier list, drafts from Kitting's stock and receives into it.
 */
export const restockPlugin =
  (options: RestockPluginOptions = {}): Plugin =>
  (config: Config): Config => {
    const userSlug = config.admin?.user ?? 'users'
    const signedIn: Access = ({ req }) => Boolean(req.user && req.user.collection === userSlug)
    const kitting = config.custom?.kitting as { items?: string; suppliers?: string; scopeField?: string; adminGroup?: string } | undefined
    const useKitting = options.kitting ?? Boolean(kitting)
    if (options.kitting && !kitting) throw new Error('Restock: `kitting: true`, but Kitting isn’t installed before Restock in `plugins`.')
    const suppliers = options.slugs?.suppliers ?? kitting?.suppliers ?? 'suppliers'
    const existing = (config.collections ?? []).find((c) => c.slug === suppliers)
    const manage = options.access?.manage ?? signedIn
    const o: ResolvedRestock = {
      suppliers,
      items: options.slugs?.items ?? 'supplier-items',
      orders: options.slugs?.orders ?? 'purchase-orders',
      settings: options.slugs?.settings ?? 'restock-settings',
      userSlug,
      read: options.access?.read ?? manage,
      manage,
      approve: options.access?.approve ?? manage,
      scopeField: options.scopeField ?? (useKitting ? kitting?.scopeField : undefined),
      currency: options.currency ?? 'USD',
      kitting: useKitting,
      needs: options.needs,
      adminGroup: options.adminGroup ?? (useKitting ? (kitting?.adminGroup ?? 'Restock') : 'Restock'),
      sharedSuppliers: Boolean(existing),
      track: options.tracking?.track,
      notify: options.notify,
      arrived: async ({ payload, user, scope }) =>
        (await awaitingConfirmation(payload, { user, scope })).map((x: Arrived) => ({ id: x.id, number: x.number, supplier: x.supplier, deliveredAt: x.deliveredAt })),
    }
    const ov = options.overrides ?? {}
    const apply = (c: CollectionConfig, f?: (c: CollectionConfig) => CollectionConfig) => (f ? f(c) : c)
    const added = [apply(itemsCollection(o, useKitting ? (kitting?.items ?? null) : null), ov.items), apply(ordersCollection(o), ov.orders), apply(settingsCollection(o), ov.settings)]
    const clash = (config.collections ?? []).filter((c) => added.some((a) => a.slug === c.slug)).map((c) => c.slug)
    if (clash.length) throw new Error(`Restock: ${clash.join(', ')} already exist${clash.length > 1 ? '' : 's'} in this config. Give Restock other slugs with its \`slugs\` option.`)
    const collections = (config.collections ?? []).map((c) =>
      // One supplier list: add Restock's ordering fields to the one that's there (Kitting's, or the host's).
      c.slug === suppliers ? apply({ ...c, fields: [...c.fields, ...orderingFields()] }, ov.suppliers) : c,
    )
    return {
      ...config,
      custom: { ...config.custom, restock: o },
      collections: [...collections, ...(existing ? [] : [apply(suppliersCollection(o), ov.suppliers)]), ...added],
      endpoints: [...(config.endpoints ?? []), ...restockEndpoints],
      admin: {
        ...config.admin,
        components: {
          ...config.admin?.components,
          afterNavLinks: [...(config.admin?.components?.afterNavLinks ?? []), '@captiveorigins/payload-plugin-restock/rsc#RestockNavLink'],
          views: { ...config.admin?.components?.views, restock: { Component: '@captiveorigins/payload-plugin-restock/rsc#RestockView', path: '/restock', exact: true } },
        },
      },
    }
  }
