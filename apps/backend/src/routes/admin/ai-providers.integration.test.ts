/**
 * Integration tests for /api/admin/ai-providers/* routes.
 *
 * Prerequisites:
 *   docker compose up -d
 *   pnpm db:migrate
 *
 * Run:
 *   pnpm test:integration
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { createHmac } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { and, eq } from 'drizzle-orm'
import { buildApp } from '../../app.js'
import { db, schema } from '../../db/index.js'
import { config } from '../../config.js'
import { Permission } from '@repo/shared'

// ─── test state ──────────────────────────────────────────────────────────────

let app: FastifyInstance
let testTenantId: string
let testUserId: string
let testRoleId: string
let adminToken: string
let noPermToken: string

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Craft a valid HS256 JWT without touching the DB. */
function makeJwt(payload: Record<string, unknown>): string {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(
    JSON.stringify({ ...payload, iat: now, exp: now + 3600 }),
  ).toString('base64url')
  const sig = createHmac('sha256', config.jwtSecret)
    .update(`${header}.${body}`)
    .digest('base64url')
  return `${header}.${body}.${sig}`
}

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` }
}

function jsonBody(payload: unknown) {
  return { headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }
}

// ─── setup / teardown ────────────────────────────────────────────────────────

beforeAll(async () => {
  const slug = `ai-prov-test-${Date.now()}`

  const [tenant] = await db
    .insert(schema.tenants)
    .values({ name: 'AI Providers Test Tenant', slug })
    .returning({ id: schema.tenants.id })
  testTenantId = tenant.id

  const [role] = await db
    .insert(schema.roles)
    .values({
      tenantId: testTenantId,
      name: 'Admin',
      permissions: [Permission.ADMIN_MANAGE],
      isBuiltin: false,
    })
    .returning({ id: schema.roles.id })
  testRoleId = role.id

  const [user] = await db
    .insert(schema.users)
    .values({ tenantId: testTenantId, email: `admin-${Date.now()}@example.com` })
    .returning({ id: schema.users.id })
  testUserId = user.id

  await db.insert(schema.userRoles).values({
    userId: testUserId,
    roleId: testRoleId,
    tenantId: testTenantId,
  })

  adminToken = makeJwt({
    userId: testUserId,
    tenantId: testTenantId,
    roles: ['Admin'],
    permissions: [Permission.ADMIN_MANAGE],
  })

  noPermToken = makeJwt({
    userId: testUserId,
    tenantId: testTenantId,
    roles: [],
    permissions: [],
  })

  app = await buildApp()
  await app.ready()
})

afterAll(async () => {
  await db
    .delete(schema.tenantAiProviders)
    .where(eq(schema.tenantAiProviders.tenantId, testTenantId))
  await db.delete(schema.userRoles).where(eq(schema.userRoles.tenantId, testTenantId))
  await db.delete(schema.users).where(eq(schema.users.id, testUserId))
  await db.delete(schema.roles).where(eq(schema.roles.id, testRoleId))
  await db.delete(schema.tenants).where(eq(schema.tenants.id, testTenantId))
  await app.close()
})

/** Remove all tenant_ai_providers for this tenant between tests. */
afterEach(async () => {
  await db
    .delete(schema.tenantAiProviders)
    .where(eq(schema.tenantAiProviders.tenantId, testTenantId))
})

// ─── GET /api/admin/ai-providers ─────────────────────────────────────────────

describe('GET /api/admin/ai-providers', () => {
  it('returns 401 without an auth token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/ai-providers' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 403 when user lacks ADMIN_MANAGE permission', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/ai-providers',
      headers: authHeader(noPermToken),
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns 200 with an empty array when no providers are configured', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/ai-providers',
      headers: authHeader(adminToken),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
  })

  it('returns 200 with configured providers after creation', async () => {
    await db.insert(schema.tenantAiProviders).values({
      tenantId: testTenantId,
      providerType: 'anthropic',
      encryptedApiKey: 'placeholder',
      allowedModels: ['claude-sonnet-4-5'],
    })

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/ai-providers',
      headers: authHeader(adminToken),
    })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ providerType: string; hasKey: boolean }[]>()
    expect(body).toHaveLength(1)
    expect(body[0].providerType).toBe('anthropic')
    expect(body[0].hasKey).toBe(true)
    expect(body[0]).not.toHaveProperty('encryptedApiKey')
  })
})

// ─── POST /api/admin/ai-providers ────────────────────────────────────────────

describe('POST /api/admin/ai-providers', () => {
  it('creates a provider and returns 201 with the response shape', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/ai-providers',
      headers: authHeader(adminToken),
      ...jsonBody({ providerType: 'anthropic', apiKey: 'sk-ant-test-key' }),
    })

    expect(res.statusCode).toBe(201)
    const body = res.json<Record<string, unknown>>()
    expect(body.providerType).toBe('anthropic')
    expect(body.hasKey).toBe(true)
    expect(body.enabled).toBe(true)
    expect(body.allowedModels).toEqual([])
    expect(body.id).toBeTypeOf('string')
    expect(body).not.toHaveProperty('encryptedApiKey')
    expect(body).not.toHaveProperty('apiKey')
  })

  it('stores allowedModels when provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/ai-providers',
      headers: authHeader(adminToken),
      ...jsonBody({ providerType: 'openai', apiKey: 'sk-openai-key', allowedModels: ['gpt-4o', 'gpt-4o-mini'] }),
    })

    expect(res.statusCode).toBe(201)
    expect(res.json<{ allowedModels: string[] }>().allowedModels).toEqual(['gpt-4o', 'gpt-4o-mini'])
  })

  it('returns 400 for an unknown providerType', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/ai-providers',
      headers: authHeader(adminToken),
      ...jsonBody({ providerType: 'unknown-llm', apiKey: 'some-key' }),
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when apiKey is absent', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/ai-providers',
      headers: authHeader(adminToken),
      ...jsonBody({ providerType: 'anthropic' }),
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when apiKey is an empty string', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/ai-providers',
      headers: authHeader(adminToken),
      ...jsonBody({ providerType: 'anthropic', apiKey: '' }),
    })
    expect(res.statusCode).toBe(400)
  })

  it('upserts (overwrites) when the same providerType is posted twice', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/admin/ai-providers',
      headers: authHeader(adminToken),
      ...jsonBody({ providerType: 'anthropic', apiKey: 'sk-first' }),
    })
    const second = await app.inject({
      method: 'POST',
      url: '/api/admin/ai-providers',
      headers: authHeader(adminToken),
      ...jsonBody({ providerType: 'anthropic', apiKey: 'sk-second', allowedModels: ['claude-haiku-4-5'] }),
    })
    expect(second.statusCode).toBe(201)

    const rows = await db
      .select()
      .from(schema.tenantAiProviders)
      .where(eq(schema.tenantAiProviders.tenantId, testTenantId))
    expect(rows).toHaveLength(1)
    expect(rows[0].allowedModels).toEqual(['claude-haiku-4-5'])
  })
})

// ─── PUT /api/admin/ai-providers/:providerType ────────────────────────────────

describe('PUT /api/admin/ai-providers/:providerType', () => {
  beforeAll(async () => {
    // Seed a provider to update
    await db.insert(schema.tenantAiProviders).values({
      tenantId: testTenantId,
      providerType: 'openai',
      encryptedApiKey: 'placeholder-old-key',
      allowedModels: [],
    })
  })

  it('updates allowedModels without supplying a new key', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/ai-providers/openai',
      headers: authHeader(adminToken),
      ...jsonBody({ allowedModels: ['gpt-4o', 'gpt-4o-mini'] }),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json<{ allowedModels: string[] }>().allowedModels).toEqual(['gpt-4o', 'gpt-4o-mini'])
  })

  it('updates the encrypted key when apiKey is provided', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/ai-providers/openai',
      headers: authHeader(adminToken),
      ...jsonBody({ apiKey: 'sk-openai-new-key' }),
    })
    expect(res.statusCode).toBe(200)

    // Verify the key was actually re-encrypted in the DB
    const [row] = await db
      .select({ encryptedApiKey: schema.tenantAiProviders.encryptedApiKey })
      .from(schema.tenantAiProviders)
      .where(
        and(
          eq(schema.tenantAiProviders.tenantId, testTenantId),
          eq(schema.tenantAiProviders.providerType, 'openai'),
        ),
      )
    expect(row?.encryptedApiKey).not.toBe('placeholder-old-key')
  })

  it('returns 404 for a non-existent providerType (without a new key)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/ai-providers/gemini',
      headers: authHeader(adminToken),
      ...jsonBody({ allowedModels: [] }),
    })
    expect(res.statusCode).toBe(404)
  })
})

// ─── PATCH /api/admin/ai-providers/:providerType/disable|enable ───────────────

describe('PATCH /disable and /enable', () => {
  beforeAll(async () => {
    await db.insert(schema.tenantAiProviders).values({
      tenantId: testTenantId,
      providerType: 'gemini',
      encryptedApiKey: 'placeholder',
      allowedModels: [],
      enabled: true,
    })
  })

  it('PATCH /disable returns 204 and sets enabled = false', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/ai-providers/gemini/disable',
      headers: authHeader(adminToken),
    })
    expect(res.statusCode).toBe(204)

    const [row] = await db
      .select({ enabled: schema.tenantAiProviders.enabled })
      .from(schema.tenantAiProviders)
      .where(
        and(
          eq(schema.tenantAiProviders.tenantId, testTenantId),
          eq(schema.tenantAiProviders.providerType, 'gemini'),
        ),
      )
    expect(row?.enabled).toBe(false)
  })

  it('PATCH /enable returns 204 and sets enabled = true', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/ai-providers/gemini/enable',
      headers: authHeader(adminToken),
    })
    expect(res.statusCode).toBe(204)

    const [row] = await db
      .select({ enabled: schema.tenantAiProviders.enabled })
      .from(schema.tenantAiProviders)
      .where(
        and(
          eq(schema.tenantAiProviders.tenantId, testTenantId),
          eq(schema.tenantAiProviders.providerType, 'gemini'),
        ),
      )
    expect(row?.enabled).toBe(true)
  })

  it('returns 404 when the provider does not exist', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/ai-providers/anthropic/enable',
      headers: authHeader(adminToken),
    })
    expect(res.statusCode).toBe(404)
  })
})

// ─── DELETE /api/admin/ai-providers/:providerType ─────────────────────────────

describe('DELETE /api/admin/ai-providers/:providerType', () => {
  beforeAll(async () => {
    await db.insert(schema.tenantAiProviders).values({
      tenantId: testTenantId,
      providerType: 'anthropic',
      encryptedApiKey: 'placeholder',
      allowedModels: [],
    })
  })

  it('returns 204 and removes the row from the DB', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/ai-providers/anthropic',
      headers: authHeader(adminToken),
    })
    expect(res.statusCode).toBe(204)

    const rows = await db
      .select()
      .from(schema.tenantAiProviders)
      .where(
        and(
          eq(schema.tenantAiProviders.tenantId, testTenantId),
          eq(schema.tenantAiProviders.providerType, 'anthropic'),
        ),
      )
    expect(rows).toHaveLength(0)
  })

  it('returns 404 when the provider does not exist', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/ai-providers/openai',
      headers: authHeader(adminToken),
    })
    expect(res.statusCode).toBe(404)
  })
})

// ─── tenant isolation ─────────────────────────────────────────────────────────

describe('tenant isolation', () => {
  it('does not return providers belonging to another tenant', async () => {
    // Insert a provider under a different tenant directly
    const [otherTenant] = await db
      .insert(schema.tenants)
      .values({ name: 'Other Tenant', slug: `other-${Date.now()}` })
      .returning({ id: schema.tenants.id })

    await db.insert(schema.tenantAiProviders).values({
      tenantId: otherTenant.id,
      providerType: 'anthropic',
      encryptedApiKey: 'other-tenant-key',
      allowedModels: [],
    })

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/ai-providers',
      headers: authHeader(adminToken),
    })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ providerType: string }[]>()
    // Our test tenant has no providers; the other tenant's row must not leak
    expect(body).toHaveLength(0)

    // Cleanup
    await db
      .delete(schema.tenantAiProviders)
      .where(eq(schema.tenantAiProviders.tenantId, otherTenant.id))
    await db.delete(schema.tenants).where(eq(schema.tenants.id, otherTenant.id))
  })
})
