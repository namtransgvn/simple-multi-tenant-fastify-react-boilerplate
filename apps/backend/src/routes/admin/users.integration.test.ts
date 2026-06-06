/**
 * Integration tests for /api/admin/users/:userId/roles routes.
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
import type { FastifyInstance, InjectOptions } from 'fastify'
import { and, eq, notInArray } from 'drizzle-orm'
import { buildApp } from '../../app.js'
import { db, schema } from '../../db/index.js'
import { config } from '../../config.js'
import { Permission } from '@repo/shared'

// ─── test state ──────────────────────────────────────────────────────────────

let app: FastifyInstance
let testTenantId: string
let adminUserId: string
let targetUserId: string
let adminRoleId: string
let roleAId: string
let roleBId: string
let adminToken: string
let noPermToken: string

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

function req(method: string, url: string, token: string, body?: unknown): InjectOptions {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const opts: InjectOptions = { method: method as InjectOptions['method'], url, headers }
  if (body !== undefined) opts.body = JSON.stringify(body)
  return opts
}

// ─── setup / teardown ────────────────────────────────────────────────────────

beforeAll(async () => {
  const slug = `users-roles-test-${Date.now()}`

  const [tenant] = await db
    .insert(schema.tenants)
    .values({ name: 'Users Roles Test Tenant', slug })
    .returning({ id: schema.tenants.id })
  testTenantId = tenant!.id

  const [adminRole] = await db
    .insert(schema.roles)
    .values({
      tenantId: testTenantId,
      name: 'Admin',
      permissions: [Permission.ADMIN_MANAGE],
      isBuiltin: false,
    })
    .returning({ id: schema.roles.id })
  adminRoleId = adminRole!.id

  const [roleA] = await db
    .insert(schema.roles)
    .values({ tenantId: testTenantId, name: 'RoleA', permissions: [Permission.PROJECT_READ] })
    .returning({ id: schema.roles.id })
  roleAId = roleA!.id

  const [roleB] = await db
    .insert(schema.roles)
    .values({ tenantId: testTenantId, name: 'RoleB', permissions: [Permission.CHAT_USE] })
    .returning({ id: schema.roles.id })
  roleBId = roleB!.id

  const ts = Date.now()

  const [admin] = await db
    .insert(schema.users)
    .values({ tenantId: testTenantId, email: `admin-${ts}@test.com` })
    .returning({ id: schema.users.id })
  adminUserId = admin!.id

  const [target] = await db
    .insert(schema.users)
    .values({ tenantId: testTenantId, email: `target-${ts}@test.com` })
    .returning({ id: schema.users.id })
  targetUserId = target!.id

  // Admin user gets adminRole; target user gets roleA as their starting role
  await db.insert(schema.userRoles).values([
    { userId: adminUserId, roleId: adminRoleId, tenantId: testTenantId },
    { userId: targetUserId, roleId: roleAId, tenantId: testTenantId },
  ])

  adminToken = makeJwt({
    userId: adminUserId,
    tenantId: testTenantId,
    roles: ['Admin'],
    permissions: [Permission.ADMIN_MANAGE],
  })

  noPermToken = makeJwt({
    userId: adminUserId,
    tenantId: testTenantId,
    roles: [],
    permissions: [],
  })

  app = await buildApp()
  await app.ready()
})

afterAll(async () => {
  await db.delete(schema.userGroups).where(eq(schema.userGroups.tenantId, testTenantId))
  // groupRoles are cascade-deleted per-test by afterEach before groups are cleaned
  await db.delete(schema.groups).where(eq(schema.groups.tenantId, testTenantId))
  await db.delete(schema.userRoles).where(eq(schema.userRoles.tenantId, testTenantId))
  await db.delete(schema.users).where(eq(schema.users.tenantId, testTenantId))
  await db.delete(schema.roles).where(eq(schema.roles.tenantId, testTenantId))
  await db.delete(schema.tenants).where(eq(schema.tenants.id, testTenantId))
  await app.close()
})

/**
 * Reset target user's roles to just roleA between tests.
 * Admin user's adminRole is left untouched.
 */
afterEach(async () => {
  await db
    .delete(schema.userRoles)
    .where(
      and(
        eq(schema.userRoles.userId, targetUserId),
        notInArray(schema.userRoles.roleId, [roleAId]),
      ),
    )

  // Ensure roleA is still assigned (some tests may have revoked it)
  await db
    .insert(schema.userRoles)
    .values({ userId: targetUserId, roleId: roleAId, tenantId: testTenantId })
    .onConflictDoNothing()

  // Clean up any groups created during tests
  const groups = await db
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .where(eq(schema.groups.tenantId, testTenantId))

  for (const g of groups) {
    await db.delete(schema.userGroups).where(eq(schema.userGroups.groupId, g.id))
    await db.delete(schema.groupRoles).where(eq(schema.groupRoles.groupId, g.id))
  }
  await db.delete(schema.groups).where(eq(schema.groups.tenantId, testTenantId))
})

// ─── GET /api/admin/users/:userId/roles ──────────────────────────────────────

describe('GET /api/admin/users/:userId/roles', () => {
  it('returns 401 without an auth token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/users/${targetUserId}/roles`,
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 403 when the user lacks ADMIN_MANAGE', async () => {
    const res = await app.inject(
      req('GET', `/api/admin/users/${targetUserId}/roles`, noPermToken),
    )
    expect(res.statusCode).toBe(403)
  })

  it('returns 200 with direct roles and empty fromGroups when no groups', async () => {
    const res = await app.inject(
      req('GET', `/api/admin/users/${targetUserId}/roles`, adminToken),
    )
    expect(res.statusCode).toBe(200)
    const body = res.json<{ direct: { id: string }[]; fromGroups: { id: string }[] }>()
    expect(body.direct.some((r) => r.id === roleAId)).toBe(true)
    expect(body.fromGroups).toEqual([])
  })

  it('returns group-derived roles in fromGroups', async () => {
    // Create a group with roleBId and add targetUser to it
    const created = await app.inject(
      req('POST', '/api/admin/groups', adminToken, {
        name: 'test-group',
        roleIds: [roleBId],
      }),
    )
    const groupId = created.json<{ id: string }>().id
    await app.inject(
      req('POST', `/api/admin/groups/${groupId}/members`, adminToken, { userId: targetUserId }),
    )

    const res = await app.inject(
      req('GET', `/api/admin/users/${targetUserId}/roles`, adminToken),
    )
    const body = res.json<{ direct: { id: string }[]; fromGroups: { id: string }[] }>()
    expect(body.fromGroups.some((r) => r.id === roleBId)).toBe(true)
  })
})

// ─── POST /api/admin/users/:userId/roles ─────────────────────────────────────

describe('POST /api/admin/users/:userId/roles', () => {
  it('returns 204 and assigns the roles', async () => {
    const res = await app.inject(
      req('POST', `/api/admin/users/${targetUserId}/roles`, adminToken, {
        roleIds: [roleBId],
      }),
    )
    expect(res.statusCode).toBe(204)

    const rows = await db
      .select({ roleId: schema.userRoles.roleId })
      .from(schema.userRoles)
      .where(
        and(
          eq(schema.userRoles.userId, targetUserId),
          eq(schema.userRoles.tenantId, testTenantId),
        ),
      )
    expect(rows.some((r) => r.roleId === roleBId)).toBe(true)
  })

  it('is idempotent when the role is already assigned', async () => {
    await app.inject(
      req('POST', `/api/admin/users/${targetUserId}/roles`, adminToken, { roleIds: [roleBId] }),
    )
    const res = await app.inject(
      req('POST', `/api/admin/users/${targetUserId}/roles`, adminToken, { roleIds: [roleBId] }),
    )
    expect(res.statusCode).toBe(204)
  })

  it('assigns multiple roles at once', async () => {
    const res = await app.inject(
      req('POST', `/api/admin/users/${targetUserId}/roles`, adminToken, {
        roleIds: [roleAId, roleBId],
      }),
    )
    expect(res.statusCode).toBe(204)
  })

  it('returns 400 when a roleId does not belong to the tenant', async () => {
    const res = await app.inject(
      req('POST', `/api/admin/users/${targetUserId}/roles`, adminToken, {
        roleIds: ['00000000-0000-0000-0000-000000000000'],
      }),
    )
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when roleIds is empty', async () => {
    const res = await app.inject(
      req('POST', `/api/admin/users/${targetUserId}/roles`, adminToken, { roleIds: [] }),
    )
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when request body is missing roleIds', async () => {
    const res = await app.inject(
      req('POST', `/api/admin/users/${targetUserId}/roles`, adminToken, {}),
    )
    expect(res.statusCode).toBe(400)
  })
})

// ─── DELETE /api/admin/users/:userId/roles/:roleId ───────────────────────────

describe('DELETE /api/admin/users/:userId/roles/:roleId', () => {
  it('returns 204 and removes the role assignment when another role remains', async () => {
    // Give target user both roleA and roleB; then revoke roleB
    await app.inject(
      req('POST', `/api/admin/users/${targetUserId}/roles`, adminToken, { roleIds: [roleBId] }),
    )

    const res = await app.inject(
      req('DELETE', `/api/admin/users/${targetUserId}/roles/${roleBId}`, adminToken),
    )
    expect(res.statusCode).toBe(204)

    const rows = await db
      .select({ roleId: schema.userRoles.roleId })
      .from(schema.userRoles)
      .where(
        and(
          eq(schema.userRoles.userId, targetUserId),
          eq(schema.userRoles.roleId, roleBId),
        ),
      )
    expect(rows).toHaveLength(0)
  })

  it('returns 400 when revoking the last role would leave the user with zero roles', async () => {
    // targetUser has only roleA at this point (set up by afterEach)
    const res = await app.inject(
      req('DELETE', `/api/admin/users/${targetUserId}/roles/${roleAId}`, adminToken),
    )
    expect(res.statusCode).toBe(400)

    // roleA must still be assigned
    const rows = await db
      .select()
      .from(schema.userRoles)
      .where(
        and(
          eq(schema.userRoles.userId, targetUserId),
          eq(schema.userRoles.roleId, roleAId),
        ),
      )
    expect(rows).toHaveLength(1)
  })

  it('allows revoking the last direct role when the user still has group-derived roles', async () => {
    // Put targetUser in a group with roleB, then revoke their only direct role (roleA)
    const created = await app.inject(
      req('POST', '/api/admin/groups', adminToken, {
        name: 'revoke-test-group',
        roleIds: [roleBId],
      }),
    )
    const groupId = created.json<{ id: string }>().id
    await app.inject(
      req('POST', `/api/admin/groups/${groupId}/members`, adminToken, { userId: targetUserId }),
    )

    const res = await app.inject(
      req('DELETE', `/api/admin/users/${targetUserId}/roles/${roleAId}`, adminToken),
    )
    expect(res.statusCode).toBe(204)
  })

  it('returns 400 when user lacks ADMIN_MANAGE', async () => {
    const res = await app.inject(
      req('DELETE', `/api/admin/users/${targetUserId}/roles/${roleAId}`, noPermToken),
    )
    expect(res.statusCode).toBe(403)
  })
})
