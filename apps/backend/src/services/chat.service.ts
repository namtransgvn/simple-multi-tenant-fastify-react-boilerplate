import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../db/schema/index.js'

type Db = PostgresJsDatabase<typeof schema>

async function saveMessage(
  tenantId: string,
  projectId: string,
  sessionId: string,
  role: string,
  content: string,
  provider: string,
  model: string,
  keySource: 'tenant' | 'platform',
  db: Db,
): Promise<void> {
  await db.insert(schema.messages).values({
    tenantId,
    projectId,
    sessionId,
    role,
    content,
    provider,
    model,
    keySource,
  })
}

export const chatService = { saveMessage }
