import { describe, expect, it } from 'vitest'

import { isThrowawayDatabase } from '../dev/local-only.js'

describe('the try-out app runs only on its throwaway database', () => {
  it('accepts what npm run dev starts', () => {
    expect(isThrowawayDatabase('mongodb://127.0.0.1:53211/restock-try-out?replicaSet=testset')).toBe(true)
    expect(isThrowawayDatabase('mongodb://127.0.0.1:27017/')).toBe(true)
  })
  it('refuses anything that could reach another database, because the app signs anyone in', () => {
    for (const url of [
      undefined,
      '',
      'mongodb://127.0.0.1:x@example.com/prod', // a user name and password, then another host
      'mongodb://127.0.0.1:27017@example.com/prod',
      'mongodb://127.0.0.1:27017,example.com:27017/prod', // a second host
      'mongodb+srv://127.0.0.1:27017/prod',
      'mongodb://localhost.example.com:27017/prod',
      'mongodb://127.0.0.10:27017/prod',
      'mongodb://example.com:27017/?x=mongodb://127.0.0.1:1',
      'mongodb://127.0.0.1:27017/try?authSource=admin@example.com',
    ])
      expect(isThrowawayDatabase(url), String(url)).toBe(false)
  })
})
