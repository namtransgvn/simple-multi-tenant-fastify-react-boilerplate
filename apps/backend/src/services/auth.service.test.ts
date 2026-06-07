import { describe, it, expect, vi, beforeEach } from 'vitest'

// Must be hoisted before any imports that pull in config.ts or factory.ts.
vi.mock('../config.js', () => ({
  config: {
    jwtSecret: 'unit-test-secret-at-least-32-characters-long!',
    jwtExpiresIn: '24h',
    refreshTokenExpiresIn: '7d',
    masterTenantId: '00000000-0000-0000-0000-000000000001',
    nodeEnv: 'test' as const,
    authRateLimit: { max: 10, windowMs: 60_000 },
  },
}))

vi.mock('../providers/auth/factory.js', () => ({
  authProviderFactory: {
    resolve: vi.fn(),
    listProviderTypes: vi.fn(() => []),
  },
}))

import { authService, parseDurationSeconds } from './auth.service.js'
import { authProviderFactory } from '../providers/auth/factory.js'

// ─── helpers ────────────────────────────────────────────────────────────────

/** Decode the JWT payload without signature verification. */
function jwtPayload(token: string): Record<string, unknown> {
  const [, part] = token.split('.')
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf-8'))
}

/**
 * Returns a thenable that resolves to `value` at every step of a Drizzle
 * query chain (select / insert / update). Chainable methods (from, where, …)
 * all return the same object so any sequence of calls eventually resolves.
 */
function thenable(value: unknown): any {
  const self: any = {
    then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
      Promise.resolve(value).then(resolve, reject)
    },
    // returning() is the only terminal op that explicitly returns a Promise.
    returning: vi.fn().mockResolvedValue(value),
  }
  for (const m of ['from', 'innerJoin', 'where', 'limit', 'set', 'values']) {
    self[m] = vi.fn().mockReturnValue(self)
  }
  return self
}

function mockDb(selectResponses: unknown[], insertValue: unknown = []) {
  let idx = 0
  return {
    select: vi.fn().mockImplementation(() => thenable(selectResponses[idx++] ?? [])),
    insert: vi.fn().mockReturnValue(thenable(insertValue)),
    update: vi.fn().mockReturnValue(thenable([])),
  }
}

// ─── parseDurationSeconds ────────────────────────────────────────────────────

describe('parseDurationSeconds', () => {
  it.each([
    ['24h', 86_400],
    ['7d', 604_800],
    ['30m', 1_800],
    ['60s', 60],
    ['1d', 86_400],
  ])('%s → %i seconds', (input, expected) => {
    expect(parseDurationSeconds(input)).toBe(expected)
  })

  it('throws on an unrecognised format', () => {
    expect(() => parseDurationSeconds('2w')).toThrow()
    expect(() => parseDurationSeconds('')).toThrow()
    expect(() => parseDurationSeconds('abc')).toThrow()
  })
})

// ─── generateTokens ──────────────────────────────────────────────────────────

describe('authService.generateTokens', () => {
  const user = { id: 'user-uuid-001', tenantId: 'tenant-uuid-001' }

  it('returns an accessToken with correct JWT structure and payload', async () => {
    const db = mockDb(
      [
        [{ name: 'member', permissions: ['chat:use', 'project:read'] }], // userRoles
        [], // groupRoles
      ],
      [],
    )

    const result = await authService.generateTokens(user, db as any)

    // JWT has three dot-separated base64url segments
    expect(result.accessToken.split('.')).toHaveLength(3)

    const payload = jwtPayload(result.accessToken)
    expect(payload.userId).toBe(user.id)
    expect(payload.tenantId).toBe(user.tenantId)
    expect(payload.roles).toEqual(['member'])
    expect(payload.permissions).toEqual(expect.arrayContaining(['chat:use', 'project:read']))
    expect(typeof payload.iat).toBe('number')
    expect(typeof payload.exp).toBe('number')
    expect(payload.exp as number).toBeGreaterThan(payload.iat as number)
  })

  it('returns a refreshToken that is a 64-character hex string', async () => {
    const db = mockDb([[]], [])
    const result = await authService.generateTokens(user, db as any)
    expect(result.refreshToken).toMatch(/^[0-9a-f]{64}$/)
  })

  it('deduplicates permissions from direct and group-derived roles', async () => {
    const db = mockDb(
      [
        [{ name: 'member', permissions: ['chat:use'] }],      // userRoles
        [{ name: 'member', permissions: ['chat:use', 'project:read'] }], // groupRoles (overlap)
      ],
      [],
    )

    const result = await authService.generateTokens(user, db as any)
    const payload = jwtPayload(result.accessToken)
    const perms = payload.permissions as string[]

    expect(perms).toContain('chat:use')
    expect(perms).toContain('project:read')
    // No duplicates
    expect(perms.length).toBe(new Set(perms).size)
  })

  it('calls db.insert to store the hashed refresh token', async () => {
    const db = mockDb([[]], [])
    await authService.generateTokens(user, db as any)
    expect(db.insert).toHaveBeenCalledOnce()
  })
})

// ─── refreshAccessToken ──────────────────────────────────────────────────────

describe('authService.refreshAccessToken', () => {
  it('throws 401 when token hash is not found', async () => {
    const db = mockDb([[]])   // empty result from refreshTokens lookup
    await expect(authService.refreshAccessToken('deadbeef', db as any))
      .rejects.toMatchObject({ statusCode: 401 })
  })

  it('throws 401 when token is revoked', async () => {
    const tokenRow = {
      userId: 'u1',
      tenantId: 't1',
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 100_000),
    }
    const db = mockDb([[tokenRow]])
    await expect(authService.refreshAccessToken('tok', db as any))
      .rejects.toMatchObject({ statusCode: 401 })
  })

  it('throws 401 when token is expired', async () => {
    const tokenRow = {
      userId: 'u1',
      tenantId: 't1',
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1_000), // in the past
    }
    const db = mockDb([[tokenRow]])
    await expect(authService.refreshAccessToken('tok', db as any))
      .rejects.toMatchObject({ statusCode: 401 })
  })

  it('returns a new accessToken for a valid, non-expired, non-revoked token', async () => {
    const tokenRow = {
      userId: 'user-uuid-001',
      tenantId: 'tenant-uuid-001',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    }
    const db = mockDb(
      [
        [tokenRow],  // refreshTokens lookup
        [],          // userRoles
        [],          // groupRoles
      ],
    )

    const result = await authService.refreshAccessToken('valid-token', db as any)

    expect(result.accessToken.split('.')).toHaveLength(3)
    const payload = jwtPayload(result.accessToken)
    expect(payload.userId).toBe(tokenRow.userId)
    expect(payload.tenantId).toBe(tokenRow.tenantId)
  })
})

// ─── revokeRefreshToken ──────────────────────────────────────────────────────

describe('authService.revokeRefreshToken', () => {
  it('calls db.update and sets revokedAt to a Date', async () => {
    const setMock = vi.fn().mockReturnValue(thenable([]))
    const db = { update: vi.fn().mockReturnValue({ set: setMock }) }

    await authService.revokeRefreshToken('some-token', db as any)

    expect(db.update).toHaveBeenCalledOnce()
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ revokedAt: expect.any(Date) }),
    )
  })
})

// ─── handleSsoCallback ───────────────────────────────────────────────────────

describe('authService.handleSsoCallback', () => {
  const mockProvider = {
    exchangeCodeForToken: vi.fn().mockResolvedValue({ accessToken: 'oidc-token' }),
    getUserProfile: vi.fn().mockResolvedValue({
      subject: 'sub-123',
      email: 'user@example.com',
      displayName: 'Test User',
      providerType: 'google',
    }),
  }

  beforeEach(() => {
    vi.mocked(authProviderFactory.resolve).mockReturnValue(mockProvider as any)
  })

  it('creates a new user when none exists and returns tokens', async () => {
    const newUser = { id: 'new-user-id', tenantId: '00000000-0000-0000-0000-000000000001' }
    const db = {
      // select calls in order: existing user lookup, sso provider lookup, userByEmail, userRoles, groupRoles
      select: vi.fn()
        .mockReturnValueOnce(thenable([]))         // existing user → not found
        .mockReturnValueOnce(thenable([]))         // sso_providers → not found → fall back to master tenant
        .mockReturnValueOnce(thenable([]))         // userByEmail → not found → proceed to insert
        .mockReturnValueOnce(thenable([]))         // userRoles (for generateTokens)
        .mockReturnValueOnce(thenable([])),        // groupRoles
      insert: vi.fn()
        .mockReturnValueOnce(
          Object.assign(thenable([newUser]), {
            values: vi.fn().mockReturnValue({
              ...thenable([newUser]),
              returning: vi.fn().mockResolvedValue([newUser]),
            }),
          }),
        )
        .mockReturnValue(thenable([])), // refresh token insert
      update: vi.fn().mockReturnValue(thenable([])),
    }

    const result = await authService.handleSsoCallback('google', 'code-123', 'http://localhost/cb', db as any)

    expect(result.accessToken.split('.')).toHaveLength(3)
    expect(result.refreshToken).toMatch(/^[0-9a-f]{64}$/)
    expect(result.user.tenantId).toBe(newUser.tenantId)
  })

  it('updates an existing user and reuses their tenant', async () => {
    const existingUser = {
      id: 'existing-user-id',
      tenantId: 'existing-tenant-id',
      email: 'user@example.com',
      displayName: 'Old Name',
      ssoProvider: 'google',
      ssoSubject: 'sub-123',
    }
    const db = {
      select: vi.fn()
        .mockReturnValueOnce(thenable([existingUser])) // existing user found
        .mockReturnValueOnce(thenable([]))              // userRoles
        .mockReturnValueOnce(thenable([])),             // groupRoles
      insert: vi.fn().mockReturnValue(thenable([])),
      update: vi.fn().mockReturnValue(thenable([])),
    }

    const result = await authService.handleSsoCallback('google', 'code-456', 'http://localhost/cb', db as any)

    expect(db.update).toHaveBeenCalledOnce() // display name update
    expect(result.user.tenantId).toBe(existingUser.tenantId)
    expect(result.user.id).toBe(existingUser.id)
  })
})
