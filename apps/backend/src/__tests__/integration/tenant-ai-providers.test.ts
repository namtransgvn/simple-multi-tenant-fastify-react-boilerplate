/**
 * Integration tests for per-tenant AI provider configuration.
 *
 * The AI provider factory is mocked so tests never make real API calls.
 * All provider resolution, key encryption/decryption, and access-control
 * logic runs against the real database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { and, eq } from 'drizzle-orm'

// ── Mock the AI provider factory ──────────────────────────────────────────────
// vi.mock is hoisted before all imports, so the mock is in place when the app
// builds and registers routes/chat.ts.
vi.mock('../../providers/ai/factory.js', () => ({
  aiProviderFactory: {
    resolve: vi.fn(() => ({
      providerType: 'anthropic',
      supportedModels: ['claude-haiku-4-5'],
      async *streamChat() {
        yield 'test-chunk'
      },
    })),
    getSupportedModels: vi.fn(() => ['claude-haiku-4-5']),
  },
}))

import { Permission } from '@repo/shared'
import {
  buildTestApp,
  createTestTenant,
  db,
  makeRequest,
  schema,
  signTestJwt,
  truncateAllTables,
  type TestTenant,
} from './test-helpers.js'
import { encryptApiKey, decryptApiKey } from '../../lib/crypto.js'

const MASTER_TENANT_ID = '00000000-0000-0000-0000-000000000001'

/** Insert the master tenant row (needed for platform-fallback tests). */
async function seedMasterTenant(): Promise<void> {
  await db
    .insert(schema.tenants)
    .values({ id: MASTER_TENANT_ID, name: 'Master', slug: 'master' })
    .onConflictDoNothing()
}

/** Wait up to `maxMs` ms for the first message row to appear for a project. */
async function waitForMessage(
  tenantId: string,
  projectId: string,
  maxMs = 2000,
): Promise<typeof schema.messages.$inferSelect | undefined> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    const [row] = await db
      .select()
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.tenantId, tenantId),
          eq(schema.messages.projectId, projectId),
        ),
      )
      .limit(1)
    if (row) return row
    await new Promise((r) => setTimeout(r, 50))
  }
  return undefined
}

describe('tenant AI providers', () => {
  let app: FastifyInstance
  let tenant: TestTenant

  beforeAll(async () => {
    app = await buildTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    await truncateAllTables()
    tenant = await createTestTenant()
  })

  // ── POST /api/admin/ai-providers ──────────────────────────────────────────

  it('creates a provider entry and returns 201 without the API key', async () => {
    const res = await makeRequest(app, {
      method: 'POST',
      url: '/api/admin/ai-providers',
      token: tenant.adminUser.token,
      body: { providerType: 'anthropic', apiKey: 'sk-test-should-never-be-returned' },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json<Record<string, unknown>>()

    // Required response fields.
    expect(body.id).toBeDefined()
    expect(body.providerType).toBe('anthropic')
    expect(body.enabled).toBe(true)
    expect(body.hasKey).toBe(true)

    // The raw or encrypted key must NOT be present.
    expect(body).not.toHaveProperty('apiKey')
    expect(body).not.toHaveProperty('encryptedApiKey')
  })

  it('member user cannot configure AI providers (403)', async () => {
    const res = await makeRequest(app, {
      method: 'POST',
      url: '/api/admin/ai-providers',
      token: tenant.memberUser.token,
      body: { providerType: 'anthropic', apiKey: 'sk-test' },
    })

    expect(res.statusCode).toBe(403)
  })

  // ── GET /api/admin/ai-providers ───────────────────────────────────────────

  it('lists configured providers without exposing the key', async () => {
    await makeRequest(app, {
      method: 'POST',
      url: '/api/admin/ai-providers',
      token: tenant.adminUser.token,
      body: { providerType: 'anthropic', apiKey: 'sk-secret' },
    })

    const res = await makeRequest(app, {
      method: 'GET',
      url: '/api/admin/ai-providers',
      token: tenant.adminUser.token,
    })

    expect(res.statusCode).toBe(200)
    const list = res.json<Record<string, unknown>[]>()
    expect(list).toHaveLength(1)

    const entry = list[0]!
    expect(entry.providerType).toBe('anthropic')
    expect(entry).not.toHaveProperty('apiKey')
    expect(entry).not.toHaveProperty('encryptedApiKey')
  })

  // ── GET /api/providers ────────────────────────────────────────────────────

  it('tenant-scoped GET /api/providers returns only enabled configured providers', async () => {
    await makeRequest(app, {
      method: 'POST',
      url: '/api/admin/ai-providers',
      token: tenant.adminUser.token,
      body: { providerType: 'anthropic', apiKey: 'sk-x' },
    })

    const res = await makeRequest(app, {
      method: 'GET',
      url: '/api/providers',
      token: tenant.adminUser.token,
    })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ providers: { provider: string; models: string[] }[] }>()
    const providerNames = body.providers.map((p) => p.provider)
    expect(providerNames).toContain('anthropic')
  })

  it('disabled provider is absent from GET /api/providers', async () => {
    await makeRequest(app, {
      method: 'POST',
      url: '/api/admin/ai-providers',
      token: tenant.adminUser.token,
      body: { providerType: 'anthropic', apiKey: 'sk-x' },
    })

    await makeRequest(app, {
      method: 'PATCH',
      url: '/api/admin/ai-providers/anthropic/disable',
      token: tenant.adminUser.token,
    })

    const res = await makeRequest(app, {
      method: 'GET',
      url: '/api/providers',
      token: tenant.adminUser.token,
    })

    expect(res.statusCode).toBe(200)
    const providerNames = res
      .json<{ providers: { provider: string }[] }>()
      .providers.map((p) => p.provider)
    expect(providerNames).not.toContain('anthropic')
  })

  // ── /api/chat — validation errors ────────────────────────────────────────

  it('POST /api/chat with unconfigured provider returns 400', async () => {
    // No AI provider configured for this tenant.
    const [project] = await db
      .insert(schema.projects)
      .values({ tenantId: tenant.tenantId, ownerId: tenant.adminUser.id, name: 'P' })
      .returning()

    const res = await makeRequest(app, {
      method: 'POST',
      url: '/api/chat',
      token: tenant.adminUser.token,
      body: {
        projectId: project!.id,
        messages: [{ role: 'user', content: 'Hello' }],
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
      },
    })

    expect(res.statusCode).toBe(400)
  })

  it('POST /api/chat with model not in allowedModels returns 400', async () => {
    const [project] = await db
      .insert(schema.projects)
      .values({ tenantId: tenant.tenantId, ownerId: tenant.adminUser.id, name: 'P' })
      .returning()

    // Configure with a restricted model list.
    await makeRequest(app, {
      method: 'POST',
      url: '/api/admin/ai-providers',
      token: tenant.adminUser.token,
      body: {
        providerType: 'anthropic',
        apiKey: 'sk-x',
        allowedModels: ['claude-haiku-4-5'],
      },
    })

    // Send a request with a model NOT in allowedModels.
    const res = await makeRequest(app, {
      method: 'POST',
      url: '/api/chat',
      token: tenant.adminUser.token,
      body: {
        projectId: project!.id,
        messages: [{ role: 'user', content: 'Hello' }],
        provider: 'anthropic',
        model: 'claude-opus-4-5',
      },
    })

    expect(res.statusCode).toBe(400)
  })

  // ── Cross-tenant key isolation ────────────────────────────────────────────

  it("tenant A's provider config is invisible to tenant B", async () => {
    const tenantA = await createTestTenant('ai-a')
    const tenantB = await createTestTenant('ai-b')

    // Configure anthropic for tenant A only.
    await makeRequest(app, {
      method: 'POST',
      url: '/api/admin/ai-providers',
      token: tenantA.adminUser.token,
      body: { providerType: 'anthropic', apiKey: 'sk-a-secret' },
    })

    // Tenant B should see an empty list.
    const res = await makeRequest(app, {
      method: 'GET',
      url: '/api/admin/ai-providers',
      token: tenantB.adminUser.token,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json<unknown[]>()).toHaveLength(0)
  })

  // ── Platform key fallback ─────────────────────────────────────────────────

  it('tenant with allow_platform_key_fallback=true can chat via platform key', async () => {
    // 1. Insert master tenant + platform-level anthropic provider.
    await seedMasterTenant()

    const platformKey = encryptApiKey('sk-platform-key')
    await db.insert(schema.tenantAiProviders).values({
      tenantId: MASTER_TENANT_ID,
      providerType: 'anthropic',
      encryptedApiKey: platformKey,
      enabled: true,
      allowedModels: [],
    })

    // 2. Create tenant C with fallback enabled (direct DB insert).
    const [tenantC] = await db
      .insert(schema.tenants)
      .values({ name: 'tenant-c', slug: 'tenant-c', allowPlatformKeyFallback: true })
      .returning()

    const allPerms = Object.values(Permission)
    const [adminRoleC] = await db
      .insert(schema.roles)
      .values({ tenantId: tenantC!.id, name: 'admin', permissions: allPerms, isBuiltin: true })
      .returning()

    const [adminUserC] = await db
      .insert(schema.users)
      .values({ tenantId: tenantC!.id, email: 'admin@tenant-c.test', displayName: 'Admin C' })
      .returning()

    await db.insert(schema.userRoles).values({
      userId: adminUserC!.id,
      roleId: adminRoleC!.id,
      tenantId: tenantC!.id,
    })

    const tokenC = signTestJwt({
      userId: adminUserC!.id,
      tenantId: tenantC!.id,
      roles: ['admin'],
      permissions: allPerms,
    })

    // 3. Create a project for tenant C.
    const [project] = await db
      .insert(schema.projects)
      .values({ tenantId: tenantC!.id, ownerId: adminUserC!.id, name: 'Fallback Project' })
      .returning()

    // 4. POST /api/chat — should succeed via platform key (mock yields one chunk).
    const res = await makeRequest(app, {
      method: 'POST',
      url: '/api/chat',
      token: tokenC,
      body: {
        projectId: project!.id,
        messages: [{ role: 'user', content: 'Hello' }],
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
      },
    })

    // The route hijacks the response for SSE; status is set via writeHead.
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('"done":true')

    // 5. Verify keySource='platform' in the persisted message (fire-and-forget).
    const msg = await waitForMessage(tenantC!.id, project!.id)
    expect(msg?.keySource).toBe('platform')
  })

  it('tenant with allow_platform_key_fallback=false and no config gets 400', async () => {
    await seedMasterTenant()

    // Create tenant D with fallback explicitly off.
    const [tenantD] = await db
      .insert(schema.tenants)
      .values({ name: 'tenant-d', slug: 'tenant-d', allowPlatformKeyFallback: false })
      .returning()

    const allPerms = Object.values(Permission)
    const [adminRoleD] = await db
      .insert(schema.roles)
      .values({ tenantId: tenantD!.id, name: 'admin', permissions: allPerms, isBuiltin: true })
      .returning()

    const [adminUserD] = await db
      .insert(schema.users)
      .values({ tenantId: tenantD!.id, email: 'admin@tenant-d.test', displayName: 'Admin D' })
      .returning()

    await db.insert(schema.userRoles).values({
      userId: adminUserD!.id,
      roleId: adminRoleD!.id,
      tenantId: tenantD!.id,
    })

    const tokenD = signTestJwt({
      userId: adminUserD!.id,
      tenantId: tenantD!.id,
      roles: ['admin'],
      permissions: allPerms,
    })

    const [project] = await db
      .insert(schema.projects)
      .values({ tenantId: tenantD!.id, ownerId: adminUserD!.id, name: 'No Provider' })
      .returning()

    const res = await makeRequest(app, {
      method: 'POST',
      url: '/api/chat',
      token: tokenD,
      body: {
        projectId: project!.id,
        messages: [{ role: 'user', content: 'Hello' }],
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
      },
    })

    expect(res.statusCode).toBe(400)
  })

  // ── Encryption round-trip ────────────────────────────────────────────────

  it('decryptApiKey(encryptApiKey(x)) === x for arbitrary inputs', () => {
    const inputs = [
      'simple-api-key',
      'sk-test-1234567890abcdef',
      'a'.repeat(100),
      'special chars: !@#$%^&*()',
    ]

    for (const plaintext of inputs) {
      expect(decryptApiKey(encryptApiKey(plaintext))).toBe(plaintext)
    }
  })

  it('every encryption call produces a different ciphertext (random IV)', () => {
    const plaintext = 'same-key-each-time'
    const cipher1 = encryptApiKey(plaintext)
    const cipher2 = encryptApiKey(plaintext)

    expect(cipher1).not.toBe(cipher2)
    expect(decryptApiKey(cipher1)).toBe(plaintext)
    expect(decryptApiKey(cipher2)).toBe(plaintext)
  })
})
