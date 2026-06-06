import { createHmac, randomBytes } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../app.js'
import { db } from '../../db/index.js'
import * as schema from '../../db/schema/index.js'
import { Permission } from '@repo/shared'

export { db, schema }

// ── App ───────────────────────────────────────────────────────────────────────

export async function buildTestApp(): Promise<FastifyInstance> {
  return buildApp()
}

// ── Database ──────────────────────────────────────────────────────────────────

/**
 * Truncates every table in dependency order (CASCADE handles FK cleanup).
 * Call in beforeEach to isolate each test.
 */
export async function truncateAllTables(): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE
      messages,
      documents,
      user_roles,
      user_groups,
      group_roles,
      refresh_tokens,
      tenant_ai_providers,
      sso_providers,
      groups,
      roles,
      users,
      projects,
      tenants
    RESTART IDENTITY CASCADE
  `)
}

// ── JWT ───────────────────────────────────────────────────────────────────────

export interface JwtPayload {
  userId: string
  tenantId: string
  roles: string[]
  permissions: string[]
  expiresInSeconds?: number
}

/**
 * Signs a JWT using the same algorithm as auth.service.ts so tokens are
 * accepted by @fastify/jwt in the test app.
 */
export function signTestJwt(payload: JwtPayload): string {
  const secret = process.env.JWT_SECRET ?? 'integration-test-secret-min-32-chars-long!'
  const now = Math.floor(Date.now() / 1000)
  const exp = now + (payload.expiresInSeconds ?? 86400)

  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(
    JSON.stringify({
      userId: payload.userId,
      tenantId: payload.tenantId,
      roles: payload.roles,
      permissions: payload.permissions,
      iat: now,
      exp,
    }),
  ).toString('base64url')
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')

  return `${header}.${body}.${sig}`
}

// ── Tenant fixture ────────────────────────────────────────────────────────────

export interface TestUser {
  id: string
  email: string
  token: string
}

export interface TestTenant {
  tenantId: string
  adminUser: TestUser
  memberUser: TestUser
  adminRoleId: string
  memberRoleId: string
}

/**
 * Inserts a tenant with builtin admin/member roles and two users.
 * Returns signed JWTs for both users.
 */
export async function createTestTenant(slug?: string): Promise<TestTenant> {
  const tenantSlug = slug ?? `t-${randomBytes(4).toString('hex')}`
  const allPerms = Object.values(Permission)

  const [tenant] = await db
    .insert(schema.tenants)
    .values({ name: tenantSlug, slug: tenantSlug })
    .returning()

  const tenantId = tenant!.id

  const insertedRoles = await db
    .insert(schema.roles)
    .values([
      { tenantId, name: 'admin', permissions: allPerms, isBuiltin: true },
      {
        tenantId,
        name: 'member',
        permissions: [Permission.PROJECT_CREATE, Permission.PROJECT_READ, Permission.CHAT_USE],
        isBuiltin: true,
      },
    ])
    .returning()

  const adminRole = insertedRoles[0]!
  const memberRole = insertedRoles[1]!

  const adminEmail = `admin@${tenantSlug}.test`
  const memberEmail = `member@${tenantSlug}.test`

  const insertedUsers = await db
    .insert(schema.users)
    .values([
      { tenantId, email: adminEmail, displayName: 'Admin' },
      { tenantId, email: memberEmail, displayName: 'Member' },
    ])
    .returning()

  const adminUser = insertedUsers[0]!
  const memberUser = insertedUsers[1]!

  await db.insert(schema.userRoles).values([
    { userId: adminUser.id, roleId: adminRole.id, tenantId },
    { userId: memberUser.id, roleId: memberRole.id, tenantId },
  ])

  return {
    tenantId,
    adminUser: {
      id: adminUser.id,
      email: adminEmail,
      token: signTestJwt({ userId: adminUser.id, tenantId, roles: ['admin'], permissions: allPerms }),
    },
    memberUser: {
      id: memberUser.id,
      email: memberEmail,
      token: signTestJwt({
        userId: memberUser.id,
        tenantId,
        roles: ['member'],
        permissions: [Permission.PROJECT_CREATE, Permission.PROJECT_READ, Permission.CHAT_USE],
      }),
    },
    adminRoleId: adminRole.id,
    memberRoleId: memberRole.id,
  }
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

export interface MakeRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  url: string
  /** Bearer token — added as Authorization header. */
  token?: string
  /** Raw cookie header value (e.g. `rt=<token>`). */
  cookies?: string
  body?: unknown
}

export async function makeRequest(app: FastifyInstance, opts: MakeRequestOptions) {
  const headers: Record<string, string> = {}
  if (opts.token) headers['authorization'] = `Bearer ${opts.token}`
  if (opts.cookies) headers['cookie'] = opts.cookies
  if (opts.body !== undefined) headers['content-type'] = 'application/json'

  return app.inject({
    method: opts.method,
    url: opts.url,
    headers,
    payload: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
}
