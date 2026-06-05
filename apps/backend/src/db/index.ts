import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import { config } from '../config.js'
import * as schema from './schema/index.js'

const client = postgres(config.databaseUrl)
export const db = drizzle(client, { schema })

export { schema }

export async function checkDb(): Promise<void> {
  await db.execute(sql`SELECT 1`)
}
