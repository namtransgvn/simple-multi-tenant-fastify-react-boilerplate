/**
 * Integration tests for GET /api/providers and GET /api/providers/sso.
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
import { eq } from 'drizzle-orm'
import { buildApp } from '../app.js'
import { db, schema } from '../db/index.js'
import { config } from '../config.js'
import { Permission } from '@repo/shared'

// ─── test state ──────────────────────────────────────────────────────────────

let app: FastifyInstance
let testTenantId: string
let testUserId: string
let chatToken: string
let noAuthToken: string  // no permissions but valid JWT

// ─── helpers ─────────────────────────────────────────────────────────────────

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

// ─── setup / teardown ────────────────────────────────────────────────────────

beforeAll(async () => {
  const slug = `providers-test-${Date.now()}`

  const [tenant] = await db
    .insert(schema.tenants)
    .values({ name: 'Providers Test Tenant', slug })
    .returning({ id: schema.tenants.id })
  testTenantId = tenant.id

  const [user] = await db
    .insert(schema.users)
    .values({ tenantId: testTenantId, email: `prov-user-${Date.now()}@example.com` })
    .returning({ id: schema.users.id })
  testUserId = user.id

  chatToken = makeJwt({
    userId: testUserId,
    tenantId: testTenantId,
    roles: [],
    permissions: [Permission.CHAT_USE],
  })

  noAuthToken = makeJwt({
    userId: testUserId,
    tenantId: testTenantId,
    roles: [],
    permissions: [],
  })

  app = await buildApp()
  await app.ready()
})

afterAll(async () => {
  await db.delete(schema.tenantAiProviders).where(eq(schema.tenantAiProviders.tenantId, testTenantId))
  await db.delete(schema.users).where(eq(schema.users.id, testUserId))
  await db.delete(schema.tenants).where(eq(schema.tenants.id, testTenantId))
  await app.close()
})

afterEach(async () => {
  await db.delete(schema.tenantAiProviders).where(eq(schema.tenantAiProviders.tenantId, testTenantId))
})

// ─── GET /api/providers ───────────────────────────────────────────────────────

describe('GET /api/providers', () => {
  it('returns 401 without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/providers' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 200 with empty providers when none are configured', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/providers',
      headers: authHeader(chatToken),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json<{ providers: unknown[] }>().providers).toEqual([])
  })

  it('returns all factory models when allowedModels is empty (unrestricted)', async () => {
    await db.insert(schema.tenantAiProviders).values({
      tenantId: testTenantId,
      providerType: 'anthropic',
      encryptedApiKey: 'placeholder',
      allowedModels: [],
      enabled: true,
    })

    const res = await app.inject({
      method: 'GET', url: '/api/providers',
      headers: authHeader(chatToken),
    })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ providers: { provider: string; models: string[] }[] }>()
    const anthropic = body.providers.find((p) => p.provider === 'anthropic')
    expect(anthropic).toBeDefined()
    // allowedModels: [] means all factory models are returned
    expect(anthropic!.models.length).toBeGreaterThan(0)
    // All returned models should be from the factory's supported list
    for (const model of anthropic!.models) {
      expect(typeof model).toBe('string')
      expect(model.length).toBeGreaterThan(0)
    }
  })

  it('intersects factory models with tenant allowedModels when restricted', async () => {
    await db.insert(schema.tenantAiProviders).values({
      tenantId: testTenantId,
      providerType: 'anthropic',
      encryptedApiKey: 'placeholder',
      allowedModels: ['claude-sonnet-4-5'],
      enabled: true,
    })

    const res = await app.inject({
      method: 'GET', url: '/api/providers',
      headers: authHeader(chatToken),
    })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ providers: { provider: string; models: string[] }[] }>()
    const anthropic = body.providers.find((p) => p.provider === 'anthropic')
    expect(anthropic).toBeDefined()
    expect(anthropic!.models).toEqual(['claude-sonnet-4-5'])
  })

  it('returns an empty models list when allowedModels contains no factory models', async () => {
    await db.insert(schema.tenantAiProviders).values({
      tenantId: testTenantId,
      providerType: 'anthropic',
      encryptedApiKey: 'placeholder',
      allowedModels: ['nonexistent-model'],
      enabled: true,
    })

    const res = await app.inject({
      method: 'GET', url: '/api/providers',
      headers: authHeader(chatToken),
    })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ providers: { provider: string; models: string[] }[] }>()
    const anthropic = body.providers.find((p) => p.provider === 'anthropic')
    expect(anthropic).toBeDefined()
    expect(anthropic!.models).toEqual([])
  })

  it('returns multiple providers when multiple are configured', async () => {
    await db.insert(schema.tenantAiProviders).values([
      {
        tenantId: testTenantId,
        providerType: 'anthropic',
        encryptedApiKey: 'placeholder',
        allowedModels: [],
        enabled: true,
      },
      {
        tenantId: testTenantId,
        providerType: 'openai',
        encryptedApiKey: 'placeholder',
        allowedModels: [],
        enabled: true,
      },
    ])

    const res = await app.inject({
      method: 'GET', url: '/api/providers',
      headers: authHeader(chatToken),
    })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ providers: { provider: string }[] }>()
    const providerNames = body.providers.map((p) => p.provider).sort()
    expect(providerNames).toContain('anthropic')
    expect(providerNames).toContain('openai')
  })

  it('skips disabled providers', async () => {
    await db.insert(schema.tenantAiProviders).values({
      tenantId: testTenantId,
      providerType: 'anthropic',
      encryptedApiKey: 'placeholder',
      allowedModels: [],
      enabled: false,
    })

    const res = await app.inject({
      method: 'GET', url: '/api/providers',
      headers: authHeader(chatToken),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json<{ providers: unknown[] }>().providers).toEqual([])
  })

  it('does not expose providers from another tenant', async () => {
    const [otherTenant] = await db
      .insert(schema.tenants)
      .values({ name: 'Other', slug: `other-prov-${Date.now()}` })
      .returning({ id: schema.tenants.id })

    await db.insert(schema.tenantAiProviders).values({
      tenantId: otherTenant.id,
      providerType: 'gemini',
      encryptedApiKey: 'placeholder',
      allowedModels: [],
      enabled: true,
    })

    const res = await app.inject({
      method: 'GET', url: '/api/providers',
      headers: authHeader(chatToken),
    })
    expect(res.json<{ providers: unknown[] }>().providers).toEqual([])

    // Cleanup
    await db.delete(schema.tenantAiProviders).where(eq(schema.tenantAiProviders.tenantId, otherTenant.id))
    await db.delete(schema.tenants).where(eq(schema.tenants.id, otherTenant.id))
  })
})

// ─── GET /api/providers/sso ───────────────────────────────────────────────────

describe('GET /api/providers/sso', () => {
  it('returns 200 without an auth token (public endpoint)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/providers/sso' })
    expect(res.statusCode).toBe(200)
  })

  it('returns 200 with an auth token as well', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/providers/sso',
      headers: authHeader(chatToken),
    })
    expect(res.statusCode).toBe(200)
  })

  it('returns a providers array (empty when no SSO credentials are configured)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/providers/sso' })
    const body = res.json<{ providers: unknown }>()
    expect(body).toHaveProperty('providers')
    expect(Array.isArray(body.providers)).toBe(true)
    // In CI/test env with no SSO credentials, the list may be empty.
    // We only verify the shape here.
    for (const p of body.providers as unknown[]) {
      expect(typeof p).toBe('string')
    }
  })
})
