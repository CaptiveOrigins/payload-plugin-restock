import { kittingPlugin } from '@captiveorigins/payload-plugin-kitting'
import { restockPlugin } from '@captiveorigins/payload-plugin-restock'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildConfig } from 'payload'

import { seed, TRY_EMAIL } from './seed'

/**
 * The local try-out app: Restock with Kitting, on a throwaway in-memory database that `npm run dev`
 * starts and deletes. Made-up suppliers and supplies only. Signs in by itself, so it listens on
 * 127.0.0.1 only and is never deployed.
 */
const dirname = path.dirname(fileURLToPath(import.meta.url))
const url = process.env.TRY_DATABASE_URI
if (!url || !/^mongodb:\/\/127\.0\.0\.1:/.test(url)) throw new Error('Start this with `npm run dev`: it only runs on its own throwaway database.')

export default buildConfig({
  secret: process.env.TRY_SECRET ?? 'local-try-out-only',
  telemetry: false,
  typescript: { autoGenerate: false },
  db: mongooseAdapter({ url, ensureIndexes: true }),
  collections: [{ slug: 'users', auth: true, admin: { useAsTitle: 'name' }, fields: [{ name: 'name', type: 'text' }] }],
  admin: {
    user: 'users',
    autoLogin: { email: TRY_EMAIL },
    importMap: { baseDir: dirname, importMapFile: path.join(dirname, 'app/(payload)/admin/importMap.js') },
    meta: { titleSuffix: ' · Restock try-out' },
  },
  plugins: [
    kittingPlugin({}),
    restockPlugin({
      // No email service here: Payload writes the "Arrived, please confirm" email to the terminal.
      notify: { recipients: ['receiving@example.com'] },
    }),
  ],
  onInit: seed,
})
