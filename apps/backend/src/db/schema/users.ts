import { index, pgTable, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core'
import { tenants } from './tenants.js'

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    email: varchar('email', { length: 255 }).notNull(),
    displayName: varchar('display_name', { length: 255 }),
    ssoProvider: varchar('sso_provider', { length: 50 }),
    ssoSubject: varchar('sso_subject', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('users_tenant_id_idx').on(t.tenantId),
    unique('users_tenant_email_uniq').on(t.tenantId, t.email),
    unique('users_sso_provider_subject_uniq').on(t.ssoProvider, t.ssoSubject),
  ],
)
