import { describe, expect, it } from 'vitest'

import { packsFor, pickItem } from '../src/index.js'

describe('rounding to packs', () => {
  it('rounds up to whole packs, then to the minimum', () => {
    expect(packsFor(500, 200)).toBe(3)
    expect(packsFor(400, 200)).toBe(2)
    expect(packsFor(401, 200)).toBe(3)
    expect(packsFor(40, 25, 4)).toBe(4)
    expect(packsFor(0.3, 0.1)).toBe(3) // no floating-point dust: 0.3 / 0.1 is 2.9999…
    expect(packsFor(0, 10)).toBe(0)
    expect(packsFor(5, 0)).toBe(0)
  })
})

describe('choosing a supplier item', () => {
  it('prefers preferred items, then the cheapest per unit, and skips ones no longer sold', () => {
    const items = [
      { id: 'a', price: 30, packSize: 200 }, // 0.15 each
      { id: 'b', price: 10, packSize: 100 }, // 0.10 each
      { id: 'c', price: 1, packSize: 100, active: false },
      { id: 'd', price: 2, packSize: 100, preferred: false },
      { id: 'e', packSize: 100 }, // no price: last
    ]
    expect(pickItem(items)?.id).toBe('b')
    expect(pickItem([{ id: 'x', preferred: false, price: 5 }, { id: 'y', preferred: false, price: 4 }])?.id).toBe('y')
    expect(pickItem([{ id: 'c', active: false }])).toBeNull()
  })
})
