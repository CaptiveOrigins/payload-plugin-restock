// `npm run dev`: the local try-out. Starts a throwaway MongoDB in memory, runs the app on
// http://127.0.0.1:3200 (this Mac only), and deletes the database when you press Ctrl+C.
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { MongoMemoryReplSet } from 'mongodb-memory-server'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = process.env.PORT ?? '3200'

console.log('Starting a throwaway database…')
const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } })
const env = {
  ...process.env,
  TRY_DATABASE_URI: mongo.getUri('restock-try-out'),
  TRY_SECRET: randomBytes(32).toString('hex'),
  PAYLOAD_CONFIG_PATH: path.join(root, 'dev/payload.config.ts'),
  NEXT_TELEMETRY_DISABLED: '1',
}

const run = (args) => new Promise((resolve) => spawn('npx', args, { cwd: root, env, stdio: 'inherit' }).on('exit', resolve))
await run(['payload', 'generate:importmap'])

console.log(`\nRestock try-out: http://127.0.0.1:${PORT}/admin/restock (signs you in as made-up staff). Ctrl+C stops it and deletes the data.\n`)
const next = spawn('npx', ['next', 'dev', 'dev', '-H', '127.0.0.1', '-p', PORT], { cwd: root, env, stdio: 'inherit' })
let stopping = false
const stop = async () => {
  if (stopping) return
  stopping = true
  next.kill('SIGINT')
  await mongo.stop({ doCleanup: true, force: true })
  console.log('\nStopped. The try-out database is deleted.')
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
next.on('exit', stop)
