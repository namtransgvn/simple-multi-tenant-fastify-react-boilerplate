/**
 * Integration tests for /auth/* routes.
 *
 * Prerequisites:
 *   docker compose up -d
 *   pnpm db:migrate
 *   # pnpm db:seed is optional — the beforeAll block upserts the master tenant.
 *
 * Run:
 *   pnpm test:integration
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'

// Mock the SSO provider factory so no real OAuth network calls are made.
// vi.mock is hoisted, so this applies before app.ts is imported.
vi.mock('../providers/auth/factory.js', () => ({
  authProviderFactory: {
    listProviderTypes: vi.fn(() => ['google']),
    resolve: vi.fn((type: string) => {
      if (type !== 'google') throw new Error(`Unknown provider: ${type}`)
      return {
        getAuthorizationUrl: (state: string, redirectUri: string) =>
          `https://accounts.google.com/o/oauth2/auth?state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`,
        exchangeCodeForToken: vi.fn().mockResolvedValue({ accessToken: 'mock-oidc-token' }),
        getUserProfile: vi.fn().mockResolvedValue({
          subject: `test-sub-${Date.now()}`,
          email: `integration-test-${Date.now()}@example.com`,
          displayName: 'Integration Test User',
          providerType: 'google',
        }),
      }
    }),
  },
}))

import type { FastifyInstance } from 'fastify'
import { buildApp } from '../app.js'
import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { config } from '../config.js'

const MASTER_TENANT_ID = config.masterTenantId

let app: FastifyInstance
/** Tracks user IDs created during tests so we can clean them up. */
const createdUserIds: string[] = []

beforeAll(async () => {
  // Ensure the master tenant row exists (seed may not have been run in CI).
  await db
    .insert(schema.tenants)
    .values({ id: MASTER_TENANT_ID, name: 'Master', slug: 'master' })
    .onConflictDoNothing()

  app = await buildApp()
  await app.ready()
})

afterAll(async () => {
  // Clean up in dependency order: refresh_tokens → users.
  for (const userId of createdUserIds) {
    await db.delete(schema.refreshTokens).where(eq(schema.refreshTokens.userId, userId))
    await db.delete(schema.users).where(eq(schema.users.id, userId))
  }
  await app.close()
})

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Extract the `rt` cookie value from a Set-Cookie header. */
function extractRtCookie(setCookieHeader: string | string[] | undefined): string | undefined {
  const headers = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader
    ? [setCookieHeader]
    : []

  for (const h of headers) {
    const pair = h.split(';')[0]
    const eqIdx = pair.indexOf('=')
    if (eqIdx !== -1 && pair.slice(0, eqIdx).trim() === 'rt') {
      return pair.slice(eqIdx + 1).trim()
    }
  }
  return undefined
}

/** Parse the `state` query param from an OAuth redirect Location URL. */
function extractState(location: string): string {
  return new URL(location).searchParams.get('state') ?? ''
}

/**
 * Runs the full SSO callback flow and returns the access token, raw refresh
 * token, and the user ID that was inserted (registered for cleanup).
 */
async function runSsoFlow(): Promise<{ accessToken: string; rtCookie: string; userId: string }> {
  // Step 1: authorise → get the state from the redirect.
  const authorizeRes = await app.inject({ method: 'GET', url: '/auth/sso/google/authorize' })
  expect(authorizeRes.statusCode).toBe(302)

  const state = extractState(authorizeRes.headers.location as string)
  expect(state).toBeTruthy()

  // Step 2: callback with the extracted state (mocked provider handles `code`).
  const callbackRes = await app.inject({
    method: 'GET',
    url: `/auth/sso/google/callback?code=mock-code&state=${encodeURIComponent(state)}`,
  })
  expect(callbackRes.statusCode).toBe(200)

  const body = callbackRes.json<{ accessToken: string }>()
  expect(body.accessToken).toBeTruthy()

  const rtCookie = extractRtCookie(callbackRes.headers['set-cookie'])
  expect(rtCookie).toBeTruthy()

  // Record the newly created user for cleanup.
  const [newUser] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.tenantId, MASTER_TENANT_ID))
    .orderBy(schema.users.createdAt)
    .limit(1)
  if (newUser) createdUserIds.push(newUser.id)

  return { accessToken: body.accessToken, rtCookie: rtCookie!, userId: newUser?.id ?? '' }
}

// ─── GET /auth/sso ────────────────────────────────────────────────────────────

describe('GET /auth/sso', () => {
  it('returns a list of configured SSO providers', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/sso' })
    expect(res.statusCode).toBe(200)

    const body = res.json<{ providers: { providerType: string; name: string; authorizationUrl: string }[] }>()
    expect(body.providers).toBeInstanceOf(Array)
    expect(body.providers.length).toBeGreaterThan(0)

    const google = body.providers.find((p) => p.providerType === 'google')
    expect(google).toBeDefined()
    expect(google?.name).toBe('Google')
    expect(google?.authorizationUrl).toMatch(/^https?:\/\//)
  })
})

// ─── GET /auth/sso/:provider/authorize ───────────────────────────────────────

describe('GET /auth/sso/:provider/authorize', () => {
  it('redirects to the provider authorization URL', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/sso/google/authorize' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toMatch(/accounts\.google\.com/)
  })

  it('includes a non-empty state parameter in the redirect', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/sso/google/authorize' })
    const state = extractState(res.headers.location as string)
    expect(state).toBeTruthy()
    // State format is nonce.hmac — two dot-separated hex strings.
    expect(state.split('.')).toHaveLength(2)
  })

  it('returns 400 for an unknown provider', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/sso/bogus/authorize' })
    expect(res.statusCode).toBe(400)
  })
})

// ─── GET /auth/sso/:provider/callback ────────────────────────────────────────

describe('GET /auth/sso/:provider/callback', () => {
  it('returns 400 when state parameter is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/sso/google/callback?code=abc' })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when code parameter is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/sso/google/callback?state=x.y' })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when the state HMAC is invalid', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/auth/sso/google/callback?code=abc&state=baadnonce.baadhmac',
    })
    expect(res.statusCode).toBe(400)
  })

  it('issues tokens and sets an rt HttpOnly cookie on success', async () => {
    const authorizeRes = await app.inject({ method: 'GET', url: '/auth/sso/google/authorize' })
    const state = extractState(authorizeRes.headers.location as string)

    const res = await app.inject({
      method: 'GET',
      url: `/auth/sso/google/callback?code=mock-code&state=${encodeURIComponent(state)}`,
    })
    expect(res.statusCode).toBe(200)

    const body = res.json<{ accessToken: string }>()
    expect(body.accessToken).toBeTruthy()
    expect(body.accessToken.split('.')).toHaveLength(3)

    const setCookie = res.headers['set-cookie'] as string | string[]
    const rtCookie = extractRtCookie(setCookie)
    expect(rtCookie).toBeTruthy()
    expect(rtCookie).toMatch(/^[0-9a-f]{64}$/)

    // Verify cookie flags.
    const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie
    expect(cookieStr).toMatch(/HttpOnly/i)
    expect(cookieStr).toMatch(/SameSite=Strict/i)

    // Track for cleanup.
    const [user] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.tenantId, MASTER_TENANT_ID))
      .orderBy(schema.users.createdAt)
      .limit(1)
    if (user) createdUserIds.push(user.id)
  })
})

// ─── POST /auth/refresh ───────────────────────────────────────────────────────

describe('POST /auth/refresh', () => {
  it('returns 401 when no rt cookie is present', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/refresh' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 for an unrecognised refresh token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { cookie: 'rt=' + 'a'.repeat(64) },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns a new accessToken for a valid rt cookie', async () => {
    const { rtCookie } = await runSsoFlow()

    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { cookie: `rt=${rtCookie}` },
    })
    expect(res.statusCode).toBe(200)

    const body = res.json<{ accessToken: string }>()
    expect(body.accessToken).toBeTruthy()
    expect(body.accessToken.split('.')).toHaveLength(3)
  })
})

// ─── POST /auth/logout ────────────────────────────────────────────────────────

describe('POST /auth/logout', () => {
  it('returns 401 when no Authorization header is present', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/logout' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 204 and clears the rt cookie for an authenticated user', async () => {
    const { accessToken, rtCookie } = await runSsoFlow()

    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: {
        authorization: `Bearer ${accessToken}`,
        cookie: `rt=${rtCookie}`,
      },
    })
    expect(res.statusCode).toBe(204)

    // Cookie should be cleared (Max-Age=0).
    const setCookie = res.headers['set-cookie'] as string | string[] | undefined
    const cookieStr = Array.isArray(setCookie)
      ? setCookie.join('; ')
      : (setCookie ?? '')
    expect(cookieStr).toMatch(/Max-Age=0/i)
  })

  it('refresh fails after logout (token is revoked)', async () => {
    const { accessToken, rtCookie } = await runSsoFlow()

    // Logout.
    await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: {
        authorization: `Bearer ${accessToken}`,
        cookie: `rt=${rtCookie}`,
      },
    })

    // Attempt refresh with the now-revoked token.
    const refreshRes = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { cookie: `rt=${rtCookie}` },
    })
    expect(refreshRes.statusCode).toBe(401)
  })
})
