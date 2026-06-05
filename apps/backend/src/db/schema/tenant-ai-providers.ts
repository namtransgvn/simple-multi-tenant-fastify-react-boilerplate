import { boolean, index, pgTable, text, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { tenants } from './tenants.js'

export const tenantAiProviders = pgTable(
  'tenant_ai_providers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    providerType: varchar('provider_type', { length: 20 }).notNull(),
    encryptedApiKey: text('encrypted_api_key').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    allowedModels: text('allowed_models').array().notNull().default(sql`'{}'`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('tenant_ai_providers_tenant_id_idx').on(t.tenantId),
    unique('tenant_ai_providers_tenant_provider_uniq').on(t.tenantId, t.providerType),
  ],
)
