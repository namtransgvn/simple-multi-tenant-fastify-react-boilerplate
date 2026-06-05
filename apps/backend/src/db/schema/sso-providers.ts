import { boolean, index, pgTable, text, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core'
import { tenants } from './tenants.js'

export const ssoProviders = pgTable(
  'sso_providers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').references(() => tenants.id),
    providerType: varchar('provider_type', { length: 50 }).notNull(),
    clientId: text('client_id').notNull(),
    clientSecret: text('client_secret').notNull(),
    issuerUrl: text('issuer_url'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('sso_providers_tenant_id_idx').on(t.tenantId),
    unique('sso_providers_tenant_provider_uniq').on(t.tenantId, t.providerType),
  ],
)
