import { createHash, randomBytes } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import {
  buildTestApp,
  createTestTenant,
  db,
  makeRequest,
  schema,
  signTestJwt,
  truncateAllTables,
} from './test-helpers.js'

function sha256hex(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

describe('auth routes', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    await truncateAllTables()
  })

  // ── GET /auth/sso ─────────────────────────────────────────────────────────

  it('GET /auth/sso returns 200 with providers array', async () => {
    const res = await makeRequest(app, { method: 'GET', url: '/auth/sso' })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ providers: unknown[] }>()
    expect(body).toHaveProperty('providers')
    expect(Array.isArray(body.providers)).toBe(true)
    // No SSO credentials are configured in the test env → empty list.
    expect(body.providers).toHaveLength(0)
  })

  // ── POST /auth/refresh ────────────────────────────────────────────────────

  it('POST /auth/refresh with valid cookie returns new access token', async () => {
    const tenant = await createTestTenant()
    const rawToken = randomBytes(32).toString('hex')

    await db.insert(schema.refreshTokens).values({
      userId: tenant.adminUser.id,
      tenantId: tenant.tenantId,
      tokenHash: sha256hex(rawToken),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })

    const res = await makeRequest(app, {
      method: 'POST',
      url: '/auth/refresh',
      cookies: `rt=${rawToken}`,
    })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ accessToken: string }>()
    expect(typeof body.accessToken).toBe('string')
    expect(body.accessToken.split('.').length).toBe(3) // valid JWT shape
  })

  it('POST /auth/refresh with revoked token returns 401', async () => {
    const tenant = await createTestTenant()
    const rawToken = randomBytes(32).toString('hex')

    await db.insert(schema.refreshTokens).values({
      userId: tenant.adminUser.id,
      tenantId: tenant.tenantId,
      tokenHash: sha256hex(rawToken),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      revokedAt: new Date(),
    })

    const res = await makeRequest(app, {
      method: 'POST',
      url: '/auth/refresh',
      cookies: `rt=${rawToken}`,
    })

    expect(res.statusCode).toBe(401)
  })

  it('POST /auth/refresh with expired token returns 401', async () => {
    const tenant = await createTestTenant()
    const rawToken = randomBytes(32).toString('hex')

    await db.insert(schema.refreshTokens).values({
      userId: tenant.adminUser.id,
      tenantId: tenant.tenantId,
      tokenHash: sha256hex(rawToken),
      expiresAt: new Date(Date.now() - 1000), // already expired
    })

    const res = await makeRequest(app, {
      method: 'POST',
      url: '/auth/refresh',
      cookies: `rt=${rawToken}`,
    })

    expect(res.statusCode).toBe(401)
  })

  // ── POST /auth/logout ─────────────────────────────────────────────────────

  it('POST /auth/logout clears the cookie and marks the token revoked', async () => {
    const tenant = await createTestTenant()
    const rawToken = randomBytes(32).toString('hex')
    const tokenHash = sha256hex(rawToken)

    await db.insert(schema.refreshTokens).values({
      userId: tenant.adminUser.id,
      tenantId: tenant.tenantId,
      tokenHash,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })

    const res = await makeRequest(app, {
      method: 'POST',
      url: '/auth/logout',
      token: tenant.adminUser.token,
      cookies: `rt=${rawToken}`,
    })

    expect(res.statusCode).toBe(204)

    // Cookie must be cleared (Max-Age=0).
    const setCookie = res.headers['set-cookie'] as string | string[]
    const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie
    expect(cookieStr).toBeDefined()
    expect(cookieStr).toContain('Max-Age=0')

    // Token must be revoked in the database.
    const [row] = await db
      .select({ revokedAt: schema.refreshTokens.revokedAt })
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.tokenHash, tokenHash))

    expect(row?.revokedAt).not.toBeNull()
  })

  it('POST /auth/logout without a cookie still returns 204', async () => {
    const tenant = await createTestTenant()

    const res = await makeRequest(app, {
      method: 'POST',
      url: '/auth/logout',
      token: tenant.adminUser.token,
    })

    expect(res.statusCode).toBe(204)
  })

  // ── Protected route auth guard ────────────────────────────────────────────

  it('protected route without JWT returns 401', async () => {
    const res = await makeRequest(app, { method: 'GET', url: '/api/projects' })
    expect(res.statusCode).toBe(401)
  })

  it('protected route with malformed JWT returns 401', async () => {
    const res = await makeRequest(app, {
      method: 'GET',
      url: '/api/projects',
      token: 'not.a.valid.jwt',
    })
    expect(res.statusCode).toBe(401)
  })

  it('protected route with expired JWT returns 401', async () => {
    const tenant = await createTestTenant()
    const expiredToken = signTestJwt({
      userId: tenant.adminUser.id,
      tenantId: tenant.tenantId,
      roles: ['admin'],
      permissions: [],
      expiresInSeconds: -1, // already expired
    })

    const res = await makeRequest(app, {
      method: 'GET',
      url: '/api/projects',
      token: expiredToken,
    })

    expect(res.statusCode).toBe(401)
  })
})
