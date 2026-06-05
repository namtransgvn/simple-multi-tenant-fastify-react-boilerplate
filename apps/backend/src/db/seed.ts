import { eq, and } from 'drizzle-orm'
import { Permission } from '@repo/shared'
import { db } from './index.js'
import { tenants, users, roles, userRoles } from './schema/index.js'
import { config } from '../config.js'

const MASTER_TENANT_ID = config.masterTenantId

async function seed(): Promise<void> {
  await db.transaction(async (tx) => {
    // 1. Insert master tenant
    await tx
      .insert(tenants)
      .values({
        id: MASTER_TENANT_ID,
        name: 'Master',
        slug: 'master',
      })
      .onConflictDoNothing()

    // 2. Insert built-in roles for master tenant
    const allPermissions = Object.values(Permission)

    await tx
      .insert(roles)
      .values([
        {
          tenantId: MASTER_TENANT_ID,
          name: 'admin',
          permissions: allPermissions,
          isBuiltin: true,
        },
        {
          tenantId: MASTER_TENANT_ID,
          name: 'member',
          permissions: [Permission.PROJECT_CREATE, Permission.PROJECT_READ, Permission.CHAT_USE],
          isBuiltin: true,
        },
      ])
      .onConflictDoNothing()

    // 3. Upsert admin user and assign admin role
    if (!config.adminEmail) {
      console.log('ADMIN_EMAIL not set — skipping admin user creation')
      return
    }

    await tx
      .insert(users)
      .values({
        tenantId: MASTER_TENANT_ID,
        email: config.adminEmail,
        displayName: 'Admin',
      })
      .onConflictDoNothing()

    const [adminUser] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.tenantId, MASTER_TENANT_ID), eq(users.email, config.adminEmail)))

    const [adminRole] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.tenantId, MASTER_TENANT_ID), eq(roles.name, 'admin')))

    if (adminUser && adminRole) {
      await tx
        .insert(userRoles)
        .values({
          userId: adminUser.id,
          roleId: adminRole.id,
          tenantId: MASTER_TENANT_ID,
        })
        .onConflictDoNothing()
    }
  })

  console.log('Seed complete.')
  process.exit(0)
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
