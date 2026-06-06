/**
 * Integration tests for /api/admin/groups/* routes.
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
import { eq } from 'drizzle-orm'
import { buildApp } from '../../app.js'
import { db, schema } from '../../db/index.js'
import { config } from '../../config.js'
import { Permission } from '@repo/shared'

// ─── test state ──────────────────────────────────────────────────────────────

let app: FastifyInstance
let testTenantId: string
let testUserId: string
let adminRoleId: string
let testRoleId: string
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
  const slug = `groups-test-${Date.now()}`

  const [tenant] = await db
    .insert(schema.tenants)
    .values({ name: 'Groups Test Tenant', slug })
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

  const [testRole] = await db
    .insert(schema.roles)
    .values({
      tenantId: testTenantId,
      name: 'Member',
      permissions: [Permission.PROJECT_READ],
      isBuiltin: false,
    })
    .returning({ id: schema.roles.id })
  testRoleId = testRole!.id

  const [user] = await db
    .insert(schema.users)
    .values({ tenantId: testTenantId, email: `admin-${Date.now()}@test.com` })
    .returning({ id: schema.users.id })
  testUserId = user!.id

  await db.insert(schema.userRoles).values({
    userId: testUserId,
    roleId: adminRoleId,
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
  await db.delete(schema.userRoles).where(eq(schema.userRoles.tenantId, testTenantId))
  await db.delete(schema.userGroups).where(eq(schema.userGroups.tenantId, testTenantId))
  // groupRoles are cascade-deleted by afterEach before each test cleans groups
  await db.delete(schema.users).where(eq(schema.users.id, testUserId))
  await db.delete(schema.groups).where(eq(schema.groups.tenantId, testTenantId))
  await db.delete(schema.roles).where(eq(schema.roles.tenantId, testTenantId))
  await db.delete(schema.tenants).where(eq(schema.tenants.id, testTenantId))
  await app.close()
})

/** Clean up all groups (and their relations) created during each test. */
afterEach(async () => {
  const existingGroups = await db
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .where(eq(schema.groups.tenantId, testTenantId))

  for (const g of existingGroups) {
    await db.delete(schema.groupRoles).where(eq(schema.groupRoles.groupId, g.id))
    await db.delete(schema.userGroups).where(eq(schema.userGroups.groupId, g.id))
  }

  await db.delete(schema.groups).where(eq(schema.groups.tenantId, testTenantId))
})

// ─── GET /api/admin/groups ────────────────────────────────────────────────────

describe('GET /api/admin/groups', () => {
  it('returns 401 without an auth token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/groups' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 403 when the user lacks ADMIN_MANAGE', async () => {
    const res = await app.inject(req('GET', '/api/admin/groups', noPermToken))
    expect(res.statusCode).toBe(403)
  })

  it('returns 200 with an empty array when there are no groups', async () => {
    const res = await app.inject(req('GET', '/api/admin/groups', adminToken))
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
  })

  it('returns 200 with groups and their roles', async () => {
    await app.inject(
      req('POST', '/api/admin/groups', adminToken, {
        name: 'developers',
        roleIds: [testRoleId],
      }),
    )

    const res = await app.inject(req('GET', '/api/admin/groups', adminToken))
    expect(res.statusCode).toBe(200)
    const body = res.json<{ name: string; roles: { id: string }[] }[]>()
    expect(body).toHaveLength(1)
    expect(body[0].name).toBe('developers')
    expect(body[0].roles).toHaveLength(1)
    expect(body[0].roles[0].id).toBe(testRoleId)
  })
})

// ─── POST /api/admin/groups ───────────────────────────────────────────────────

describe('POST /api/admin/groups', () => {
  it('returns 201 with the created group and no roles', async () => {
    const res = await app.inject(
      req('POST', '/api/admin/groups', adminToken, { name: 'empty-group', roleIds: [] }),
    )
    expect(res.statusCode).toBe(201)
    const body = res.json<Record<string, unknown>>()
    expect(body.name).toBe('empty-group')
    expect(body.tenantId).toBe(testTenantId)
    expect(body.roles).toEqual([])
    expect(body.id).toBeTypeOf('string')
  })

  it('returns 201 with roles embedded when roleIds are provided', async () => {
    const res = await app.inject(
      req('POST', '/api/admin/groups', adminToken, {
        name: 'dev-team',
        roleIds: [testRoleId],
      }),
    )
    expect(res.statusCode).toBe(201)
    const body = res.json<{ roles: { id: string }[] }>()
    expect(body.roles).toHaveLength(1)
    expect(body.roles[0].id).toBe(testRoleId)
  })

  it('returns 400 when a roleId does not belong to the tenant', async () => {
    const res = await app.inject(
      req('POST', '/api/admin/groups', adminToken, {
        name: 'bad-group',
        roleIds: ['00000000-0000-0000-0000-000000000000'],
      }),
    )
    expect(res.statusCode).toBe(400)
  })

  it('returns 409 when a group with the same name already exists', async () => {
    await app.inject(
      req('POST', '/api/admin/groups', adminToken, { name: 'duplicate', roleIds: [] }),
    )
    const res = await app.inject(
      req('POST', '/api/admin/groups', adminToken, { name: 'duplicate', roleIds: [] }),
    )
    expect(res.statusCode).toBe(409)
  })

  it('returns 400 when the request body is missing required fields', async () => {
    const res = await app.inject(
      req('POST', '/api/admin/groups', adminToken, { roleIds: [] }),
    )
    expect(res.statusCode).toBe(400)
  })
})

// ─── POST /api/admin/groups/:groupId/members ──────────────────────────────────

describe('POST /api/admin/groups/:groupId/members', () => {
  it('returns 204 when the member is added successfully', async () => {
    const created = await app.inject(
      req('POST', '/api/admin/groups', adminToken, { name: 'team', roleIds: [] }),
    )
    const groupId = created.json<{ id: string }>().id

    const res = await app.inject(
      req('POST', `/api/admin/groups/${groupId}/members`, adminToken, { userId: testUserId }),
    )
    expect(res.statusCode).toBe(204)

    const rows = await db
      .select()
      .from(schema.userGroups)
      .where(
        eq(schema.userGroups.groupId, groupId),
      )
    expect(rows).toHaveLength(1)
    expect(rows[0].userId).toBe(testUserId)
  })

  it('returns 204 (idempotent) when the same member is added twice', async () => {
    const created = await app.inject(
      req('POST', '/api/admin/groups', adminToken, { name: 'team-idem', roleIds: [] }),
    )
    const groupId = created.json<{ id: string }>().id

    await app.inject(
      req('POST', `/api/admin/groups/${groupId}/members`, adminToken, { userId: testUserId }),
    )
    const res = await app.inject(
      req('POST', `/api/admin/groups/${groupId}/members`, adminToken, { userId: testUserId }),
    )
    expect(res.statusCode).toBe(204)
  })

  it('returns 404 when the group does not exist', async () => {
    const res = await app.inject(
      req('POST', '/api/admin/groups/00000000-0000-0000-0000-000000000000/members', adminToken, {
        userId: testUserId,
      }),
    )
    expect(res.statusCode).toBe(404)
  })

  it('returns 404 when the user does not exist in the tenant', async () => {
    const created = await app.inject(
      req('POST', '/api/admin/groups', adminToken, { name: 'team-404', roleIds: [] }),
    )
    const groupId = created.json<{ id: string }>().id

    const res = await app.inject(
      req('POST', `/api/admin/groups/${groupId}/members`, adminToken, {
        userId: '00000000-0000-0000-0000-000000000000',
      }),
    )
    expect(res.statusCode).toBe(404)
  })

  it('returns 400 for a missing userId in the body', async () => {
    const created = await app.inject(
      req('POST', '/api/admin/groups', adminToken, { name: 'team-bad', roleIds: [] }),
    )
    const groupId = created.json<{ id: string }>().id

    const res = await app.inject(
      req('POST', `/api/admin/groups/${groupId}/members`, adminToken, {}),
    )
    expect(res.statusCode).toBe(400)
  })
})

// ─── DELETE /api/admin/groups/:groupId/members/:userId ────────────────────────

describe('DELETE /api/admin/groups/:groupId/members/:userId', () => {
  it('returns 204 and removes the member', async () => {
    const created = await app.inject(
      req('POST', '/api/admin/groups', adminToken, { name: 'team-del', roleIds: [] }),
    )
    const groupId = created.json<{ id: string }>().id

    await app.inject(
      req('POST', `/api/admin/groups/${groupId}/members`, adminToken, { userId: testUserId }),
    )

    const res = await app.inject(
      req('DELETE', `/api/admin/groups/${groupId}/members/${testUserId}`, adminToken),
    )
    expect(res.statusCode).toBe(204)

    const rows = await db
      .select()
      .from(schema.userGroups)
      .where(eq(schema.userGroups.groupId, groupId))
    expect(rows).toHaveLength(0)
  })

  it('returns 404 when the group does not exist', async () => {
    const res = await app.inject(
      req(
        'DELETE',
        `/api/admin/groups/00000000-0000-0000-0000-000000000000/members/${testUserId}`,
        adminToken,
      ),
    )
    expect(res.statusCode).toBe(404)
  })
})

// ─── DELETE /api/admin/groups/:groupId ────────────────────────────────────────

describe('DELETE /api/admin/groups/:groupId', () => {
  it('returns 204 and removes the group along with its relations', async () => {
    const created = await app.inject(
      req('POST', '/api/admin/groups', adminToken, {
        name: 'to-delete',
        roleIds: [testRoleId],
      }),
    )
    const groupId = created.json<{ id: string }>().id

    await app.inject(
      req('POST', `/api/admin/groups/${groupId}/members`, adminToken, { userId: testUserId }),
    )

    const res = await app.inject(req('DELETE', `/api/admin/groups/${groupId}`, adminToken))
    expect(res.statusCode).toBe(204)

    const groups = await db
      .select()
      .from(schema.groups)
      .where(eq(schema.groups.id, groupId))
    expect(groups).toHaveLength(0)

    const gRoles = await db
      .select()
      .from(schema.groupRoles)
      .where(eq(schema.groupRoles.groupId, groupId))
    expect(gRoles).toHaveLength(0)

    const uGroups = await db
      .select()
      .from(schema.userGroups)
      .where(eq(schema.userGroups.groupId, groupId))
    expect(uGroups).toHaveLength(0)
  })

  it('returns 404 when the group does not exist', async () => {
    const res = await app.inject(
      req('DELETE', '/api/admin/groups/00000000-0000-0000-0000-000000000000', adminToken),
    )
    expect(res.statusCode).toBe(404)
  })
})

// ─── tenant isolation ─────────────────────────────────────────────────────────

describe('tenant isolation', () => {
  it('does not return groups belonging to another tenant', async () => {
    const [otherTenant] = await db
      .insert(schema.tenants)
      .values({ name: 'Other Tenant', slug: `other-groups-${Date.now()}` })
      .returning({ id: schema.tenants.id })

    await db
      .insert(schema.groups)
      .values({ tenantId: otherTenant!.id, name: 'other-group' })

    const res = await app.inject(req('GET', '/api/admin/groups', adminToken))
    const body = res.json<{ tenantId: string }[]>()
    expect(body.every((g) => g.tenantId === testTenantId)).toBe(true)

    await db.delete(schema.groups).where(eq(schema.groups.tenantId, otherTenant!.id))
    await db.delete(schema.tenants).where(eq(schema.tenants.id, otherTenant!.id))
  })
})
