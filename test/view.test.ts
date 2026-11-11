import { describe, expect, it, vi } from 'vitest'

// Payload's admin shell and UI kit are stubbed: this checks the view's access decision, and that the reads behind
// it run only when it says yes, not its rendering in a real admin.
vi.mock('@payloadcms/next/templates', () => ({ DefaultTemplate: ({ children }: { children: unknown }) => children }))
vi.mock('@payloadcms/ui', () => ({ Button: () => null, toast: {}, useConfig: () => ({ config: { routes: { api: '/api' } } }) }))

const { RestockView } = await import('../src/rsc/RestockView.js')

/** A made-up Payload that answers every read with nothing, and remembers which collections were read. */
const fakePayload = (read: unknown, manage: unknown) => {
  const reads: string[] = []
  const payload = {
    config: { routes: { admin: '/admin', api: '/api' }, custom: { restock: { read, manage, approve: () => false, orders: 'purchase-orders', suppliers: 'supply-suppliers', items: 'restock-items', scopeField: null } } },
    find: async ({ collection }: { collection: string }) => (reads.push(collection), { docs: [], totalDocs: 0 }),
    count: async ({ collection }: { collection: string }) => (reads.push(collection), { totalDocs: 0 }),
    logger: { error: () => undefined },
  }
  return { payload, reads }
}
const show = (payload: unknown, user: unknown = { id: 'u', collection: 'users' }) =>
  RestockView({ initPageResult: { req: { user, payload, i18n: {} }, permissions: {}, visibleEntities: {}, locale: undefined }, params: {}, searchParams: {} } as never)

const NOT_TRUE: [string, () => unknown][] = [
  ['1', () => 1],
  ["'yes'", () => 'yes'],
  ['an empty object', () => ({})],
  ['a malformed query', () => ({ tenant: false })],
  ['a thrown error', () => {
    throw new Error('roles store down')
  }],
  ['a rejected promise', async () => {
    throw new Error('roles store down')
  }],
]
const SITE_QUERY = () => ({ tenant: { in: ['site-a'] } })

describe('the Restock admin view (test audit 2026-11-11)', () => {
  it('reads orders only when read answers true or a well-formed query, and suppliers only when manage does', async () => {
    for (const [what, answer] of NOT_TRUE) {
      const { payload, reads } = fakePayload(answer, answer)
      await show(payload)
      expect(reads, what).toEqual([])
    }
    for (const answer of [() => true, SITE_QUERY]) {
      const { payload, reads } = fakePayload(answer, () => false)
      await show(payload)
      expect(reads).toEqual(['purchase-orders'])
    }
    for (const answer of [() => true, SITE_QUERY]) {
      const { payload, reads } = fakePayload(() => false, answer)
      await show(payload)
      expect(reads).toContain('supply-suppliers')
      expect(reads).not.toContain('restock-items')
    }
    const { payload, reads } = fakePayload(() => true, () => true)
    await show(payload, null)
    expect(reads).toEqual([])
  })
})
