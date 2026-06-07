import { eq, and, sql } from 'drizzle-orm'
import { Permission } from '@repo/shared'
import { db } from './index.js'
import { tenants, users, roles, userRoles, ssoProviders, tenantAiProviders } from './schema/index.js'
import { encryptApiKey } from '../lib/crypto.js'
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
          permissions: [
            Permission.PROJECT_CREATE,
            Permission.PROJECT_READ,
            Permission.CHAT_USE,
            Permission.DOCUMENT_MANAGE,
          ],
          isBuiltin: true,
        },
      ])
      .onConflictDoUpdate({
        target: [roles.tenantId, roles.name],
        set: { permissions: sql`excluded.permissions`, updatedAt: new Date() },
      })

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

    // 4. Seed SSO providers for master tenant from env
    const { google, keycloak } = config.sso
    const ssoEntries = [
      google.clientId && google.clientSecret
        ? { providerType: 'google' as const, clientId: google.clientId, clientSecret: google.clientSecret, issuerUrl: null }
        : null,
      keycloak.clientId && keycloak.clientSecret && keycloak.issuerUrl
        ? { providerType: 'keycloak' as const, clientId: keycloak.clientId, clientSecret: keycloak.clientSecret, issuerUrl: keycloak.issuerUrl }
        : null,
    ].filter((e): e is NonNullable<typeof e> => e !== null)

    for (const entry of ssoEntries) {
      await tx
        .insert(ssoProviders)
        .values({ tenantId: MASTER_TENANT_ID, ...entry, enabled: true })
        .onConflictDoUpdate({
          target: [ssoProviders.tenantId, ssoProviders.providerType],
          set: {
            clientId: entry.clientId,
            clientSecret: entry.clientSecret,
            issuerUrl: entry.issuerUrl,
            enabled: true,
            updatedAt: new Date(),
          },
        })
      console.log(`Seeded SSO provider: ${entry.providerType}`)
    }

    // 5. Seed AI providers for master tenant from env
    const aiEntries = [
      config.anthropicApiKey
        ? { providerType: 'anthropic' as const, apiKey: config.anthropicApiKey, allowedModels: ['claude-sonnet-4-5'] }
        : null,
      config.openaiApiKey
        ? { providerType: 'openai' as const, apiKey: config.openaiApiKey, allowedModels: ['gpt-5-mini'] }
        : null,
      config.googleAiApiKey
        ? { providerType: 'gemini' as const, apiKey: config.googleAiApiKey, allowedModels: ['gemini-2.5-flash'] }
        : null,
    ].filter((e): e is NonNullable<typeof e> => e !== null)

    for (const entry of aiEntries) {
      const encryptedApiKey = encryptApiKey(entry.apiKey)
      await tx
        .insert(tenantAiProviders)
        .values({
          tenantId: MASTER_TENANT_ID,
          providerType: entry.providerType,
          encryptedApiKey,
          enabled: true,
          allowedModels: entry.allowedModels,
        })
        .onConflictDoUpdate({
          target: [tenantAiProviders.tenantId, tenantAiProviders.providerType],
          set: {
            encryptedApiKey,
            enabled: true,
            allowedModels: entry.allowedModels,
            updatedAt: new Date(),
          },
        })
      console.log(`Seeded AI provider: ${entry.providerType}`)
    }
  })

  console.log('Seed complete.')
  process.exit(0)
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
