import { config as loadDotenv } from 'dotenv'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default async function setup(): Promise<void> {
  // Load env files so DATABASE_URL / TEST_DATABASE_URL are available in this
  // process (globalSetup runs before vitest applies its own `env` overrides).
  // __dirname = apps/backend/src/__tests__/integration/
  loadDotenv({ path: resolve(__dirname, '../../../.env') })       // apps/backend/.env
  loadDotenv({ path: resolve(__dirname, '../../../../../.env') }) // workspace root .env

  const url =
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL

  if (!url) {
    throw new Error(
      'Integration tests require DATABASE_URL or TEST_DATABASE_URL to be set.',
    )
  }

  const client = postgres(url, { max: 1 })
  const db = drizzle(client)

  await migrate(db, {
    migrationsFolder: resolve(__dirname, '../../db/migrations'),
  })

  // Idempotent column guard: Drizzle's hash-based tracking can get out of sync
  // (e.g. schema created with `drizzle-kit push` before migrations existed).
  // Run each incremental DDL with IF NOT EXISTS so the setup is always safe.
  await client`ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "key_source" varchar(20)`

  await client.end()
}
