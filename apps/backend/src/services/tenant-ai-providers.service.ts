import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../db/schema/index.js'
import { encryptApiKey, decryptApiKey } from '../lib/crypto.js'
import { config } from '../config.js'
import type { TenantAiProviderResponse } from '@repo/shared'

type Db = PostgresJsDatabase<typeof schema>

function toResponse(row: typeof schema.tenantAiProviders.$inferSelect): TenantAiProviderResponse {
  return {
    id: row.id,
    providerType: row.providerType,
    enabled: row.enabled,
    allowedModels: row.allowedModels,
    hasKey: true,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

async function listProviders(tenantId: string, db: Db): Promise<TenantAiProviderResponse[]> {
  const rows = await db
    .select()
    .from(schema.tenantAiProviders)
    .where(eq(schema.tenantAiProviders.tenantId, tenantId))
  return rows.map(toResponse)
}

async function getEffectiveProviders(tenantId: string, db: Db): Promise<string[]> {
  const [tenant] = await db
    .select({ allowPlatformKeyFallback: schema.tenants.allowPlatformKeyFallback })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId))
    .limit(1)

  const tenantRows = await db
    .select({ providerType: schema.tenantAiProviders.providerType })
    .from(schema.tenantAiProviders)
    .where(
      and(
        eq(schema.tenantAiProviders.tenantId, tenantId),
        eq(schema.tenantAiProviders.enabled, true),
      ),
    )

  const providerTypes = new Set(tenantRows.map((r) => r.providerType))

  if (tenant?.allowPlatformKeyFallback) {
    const platformRows = await db
      .select({ providerType: schema.tenantAiProviders.providerType })
      .from(schema.tenantAiProviders)
      .where(
        and(
          eq(schema.tenantAiProviders.tenantId, config.masterTenantId),
          eq(schema.tenantAiProviders.enabled, true),
        ),
      )
    for (const { providerType } of platformRows) {
      providerTypes.add(providerType)
    }
  }

  return [...providerTypes]
}

async function resolveApiKey(
  tenantId: string,
  providerType: string,
  db: Db,
): Promise<{ apiKey: string; keySource: 'tenant' | 'platform' }> {
  const [row] = await db
    .select()
    .from(schema.tenantAiProviders)
    .where(
      and(
        eq(schema.tenantAiProviders.tenantId, tenantId),
        eq(schema.tenantAiProviders.providerType, providerType),
      ),
    )
    .limit(1)

  if (row?.enabled) {
    return { apiKey: decryptApiKey(row.encryptedApiKey), keySource: 'tenant' }
  }

  const [tenant] = await db
    .select({ allowPlatformKeyFallback: schema.tenants.allowPlatformKeyFallback })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId))
    .limit(1)

  if (tenant?.allowPlatformKeyFallback) {
    const [platformRow] = await db
      .select()
      .from(schema.tenantAiProviders)
      .where(
        and(
          eq(schema.tenantAiProviders.tenantId, config.masterTenantId),
          eq(schema.tenantAiProviders.providerType, providerType),
          eq(schema.tenantAiProviders.enabled, true),
        ),
      )
      .limit(1)

    if (platformRow) {
      return { apiKey: decryptApiKey(platformRow.encryptedApiKey), keySource: 'platform' }
    }
  }

  throw Object.assign(
    new Error(`Provider '${providerType}' is not configured or enabled for this tenant.`),
    { statusCode: 400 },
  )
}

async function validateModelAllowed(
  tenantId: string,
  providerType: string,
  model: string,
  db: Db,
): Promise<void> {
  const [row] = await db
    .select({ allowedModels: schema.tenantAiProviders.allowedModels })
    .from(schema.tenantAiProviders)
    .where(
      and(
        eq(schema.tenantAiProviders.tenantId, tenantId),
        eq(schema.tenantAiProviders.providerType, providerType),
      ),
    )
    .limit(1)

  if (!row || row.allowedModels.length === 0) return

  if (!row.allowedModels.includes(model)) {
    throw Object.assign(
      new Error(`Model '${model}' is not permitted for this tenant.`),
      { statusCode: 400 },
    )
  }
}

async function upsertProvider(
  tenantId: string,
  data: { providerType: string; apiKey: string; allowedModels?: string[] },
  db: Db,
): Promise<TenantAiProviderResponse> {
  const now = new Date()

  if (data.apiKey === '') {
    // Update without touching the encrypted key (PUT path where key is unchanged)
    const setValues: Partial<typeof schema.tenantAiProviders.$inferInsert> & { updatedAt: Date } =
      { updatedAt: now }
    if (data.allowedModels !== undefined) {
      setValues.allowedModels = data.allowedModels
    }

    const rows = await db
      .update(schema.tenantAiProviders)
      .set(setValues)
      .where(
        and(
          eq(schema.tenantAiProviders.tenantId, tenantId),
          eq(schema.tenantAiProviders.providerType, data.providerType),
        ),
      )
      .returning()

    if (rows.length === 0) {
      throw Object.assign(new Error('Provider not found'), { statusCode: 404 })
    }
    return toResponse(rows[0])
  }

  const encryptedApiKey = encryptApiKey(data.apiKey)
  const conflictSet: Partial<typeof schema.tenantAiProviders.$inferInsert> & { updatedAt: Date } =
    { encryptedApiKey, updatedAt: now }
  if (data.allowedModels !== undefined) {
    conflictSet.allowedModels = data.allowedModels
  }

  const [row] = await db
    .insert(schema.tenantAiProviders)
    .values({
      tenantId,
      providerType: data.providerType,
      encryptedApiKey,
      allowedModels: data.allowedModels ?? [],
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.tenantAiProviders.tenantId, schema.tenantAiProviders.providerType],
      set: conflictSet,
    })
    .returning()

  return toResponse(row)
}

async function setEnabled(
  tenantId: string,
  providerType: string,
  enabled: boolean,
  db: Db,
): Promise<void> {
  const rows = await db
    .update(schema.tenantAiProviders)
    .set({ enabled, updatedAt: new Date() })
    .where(
      and(
        eq(schema.tenantAiProviders.tenantId, tenantId),
        eq(schema.tenantAiProviders.providerType, providerType),
      ),
    )
    .returning({ id: schema.tenantAiProviders.id })

  if (rows.length === 0) {
    throw Object.assign(new Error('Provider not found'), { statusCode: 404 })
  }
}

async function deleteProvider(tenantId: string, providerType: string, db: Db): Promise<void> {
  const rows = await db
    .delete(schema.tenantAiProviders)
    .where(
      and(
        eq(schema.tenantAiProviders.tenantId, tenantId),
        eq(schema.tenantAiProviders.providerType, providerType),
      ),
    )
    .returning({ id: schema.tenantAiProviders.id })

  if (rows.length === 0) {
    throw Object.assign(new Error('Provider not found'), { statusCode: 404 })
  }
}

export const tenantAiProvidersService = {
  listProviders,
  getEffectiveProviders,
  resolveApiKey,
  validateModelAllowed,
  upsertProvider,
  setEnabled,
  deleteProvider,
}
