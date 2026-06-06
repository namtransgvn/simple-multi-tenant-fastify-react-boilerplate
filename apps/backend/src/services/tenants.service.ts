import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../db/schema/index.js'
import {
  Permission,
  type CreateTenantRequest,
  type TenantResponse,
} from '@repo/shared'
import { config } from '../config.js'

type Db = PostgresJsDatabase<typeof schema>

async function createTenant(data: CreateTenantRequest, db: Db): Promise<TenantResponse> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: schema.tenants.id })
      .from(schema.tenants)
      .where(eq(schema.tenants.slug, data.slug))
      .limit(1)

    if (existing) {
      throw Object.assign(new Error('Tenant slug already exists'), { statusCode: 409 })
    }

    const [tenant] = await tx
      .insert(schema.tenants)
      .values({ name: data.name, slug: data.slug, allowPlatformKeyFallback: false })
      .returning()

    const tenantId = tenant!.id
    const allPermissions = Object.values(Permission)

    await tx.insert(schema.roles).values([
      {
        tenantId,
        name: 'admin',
        permissions: allPermissions,
        isBuiltin: true,
      },
      {
        tenantId,
        name: 'member',
        permissions: [Permission.PROJECT_CREATE, Permission.PROJECT_READ, Permission.CHAT_USE],
        isBuiltin: true,
      },
    ])

    const [adminRole] = await tx
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(and(eq(schema.roles.tenantId, tenantId), eq(schema.roles.name, 'admin')))
      .limit(1)

    await tx
      .insert(schema.users)
      .values({ tenantId, email: data.adminEmail, displayName: 'Admin' })
      .onConflictDoNothing()

    const [adminUser] = await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.email, data.adminEmail)))
      .limit(1)

    if (adminUser && adminRole) {
      await tx
        .insert(schema.userRoles)
        .values({ userId: adminUser.id, roleId: adminRole.id, tenantId })
        .onConflictDoNothing()
    }

    return {
      id: tenant!.id,
      name: tenant!.name,
      slug: tenant!.slug,
      createdAt: tenant!.createdAt.toISOString(),
    }
  })
}

async function setFallbackAllowed(tenantId: string, allowed: boolean, db: Db): Promise<void> {
  if (tenantId === config.masterTenantId) {
    throw Object.assign(
      new Error('Cannot modify fallback setting for the master tenant'),
      { statusCode: 400 },
    )
  }

  const [updated] = await db
    .update(schema.tenants)
    .set({ allowPlatformKeyFallback: allowed })
    .where(eq(schema.tenants.id, tenantId))
    .returning({ id: schema.tenants.id })

  if (!updated) {
    throw Object.assign(new Error('Tenant not found'), { statusCode: 404 })
  }
}

export const tenantsService = {
  createTenant,
  setFallbackAllowed,
}
