import { index, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { tenants } from './tenants.js'
import { projects } from './projects.js'

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    projectId: uuid('project_id').notNull().references(() => projects.id),
    sessionId: uuid('session_id').notNull(),
    role: varchar('role', { length: 20 }).notNull(),
    content: text('content').notNull(),
    provider: varchar('provider', { length: 50 }),
    model: varchar('model', { length: 100 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('messages_tenant_id_idx').on(t.tenantId)],
)
