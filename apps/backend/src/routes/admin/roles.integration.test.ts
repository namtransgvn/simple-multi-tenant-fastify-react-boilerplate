/**
 * Integration tests for /api/admin/roles/* routes.
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
let testUserId: string
let adminRoleId: string
let builtinRoleId: string
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

/** Builds an inject options object that merges auth and optional JSON body correctly. */
function req(method: string, url: string, token: string, body?: unknown): InjectOptions {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const opts: InjectOptions = { method: method as InjectOptions['method'], url, headers }
  if (body !== undefined) opts.body = JSON.stringify(body)
  return opts
}

// ─── setup / teardown ────────────────────────────────────────────────────────

beforeAll(async () => {
  const slug = `roles-test-${Date.now()}`

  const [tenant] = await db
    .insert(schema.tenants)
    .values({ name: 'Roles Test Tenant', slug })
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

  const [builtin] = await db
    .insert(schema.roles)
    .values({
      tenantId: testTenantId,
      name: 'Builtin',
      permissions: [],
      isBuiltin: true,
    })
    .returning({ id: schema.roles.id })
  builtinRoleId = builtin!.id

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
  await db.delete(schema.users).where(eq(schema.users.id, testUserId))
  await db.delete(schema.roles).where(eq(schema.roles.tenantId, testTenantId))
  await db.delete(schema.tenants).where(eq(schema.tenants.id, testTenantId))
  await app.close()
})

/** Remove test-created roles (not the setup ones) between tests. */
afterEach(async () => {
  await db
    .delete(schema.roles)
    .where(
      and(
        eq(schema.roles.tenantId, testTenantId),
        notInArray(schema.roles.id, [adminRoleId, builtinRoleId]),
      ),
    )
})

// ─── GET /api/admin/roles ─────────────────────────────────────────────────────

describe('GET /api/admin/roles', () => {
  it('returns 401 without an auth token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/roles' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 403 when the user lacks ADMIN_MANAGE', async () => {
    const res = await app.inject(req('GET', '/api/admin/roles', noPermToken))
    expect(res.statusCode).toBe(403)
  })

  it('returns 200 with an array that includes the setup roles', async () => {
    const res = await app.inject(req('GET', '/api/admin/roles', adminToken))
    expect(res.statusCode).toBe(200)
    const body = res.json<{ id: string }[]>()
    expect(Array.isArray(body)).toBe(true)
    expect(body.some((r) => r.id === adminRoleId)).toBe(true)
    expect(body.some((r) => r.id === builtinRoleId)).toBe(true)
  })

  it('returns roles with the correct shape', async () => {
    const res = await app.inject(req('GET', '/api/admin/roles', adminToken))
    const role = res.json<{ id: string; tenantId: string; name: string; permissions: string[]; isBuiltin: boolean }[]>()
      .find((r) => r.id === adminRoleId)!
    expect(role.tenantId).toBe(testTenantId)
    expect(role.name).toBe('Admin')
    expect(role.permissions).toContain(Permission.ADMIN_MANAGE)
    expect(role.isBuiltin).toBe(false)
  })
})

// ─── POST /api/admin/roles ────────────────────────────────────────────────────

describe('POST /api/admin/roles', () => {
  it('returns 401 without an auth token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/roles',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x', permissions: [] }),
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 403 when the user lacks ADMIN_MANAGE', async () => {
    const res = await app.inject(
      req('POST', '/api/admin/roles', noPermToken, { name: 'x', permissions: [] }),
    )
    expect(res.statusCode).toBe(403)
  })

  it('returns 400 when the request body is invalid', async () => {
    const res = await app.inject(
      req('POST', '/api/admin/roles', adminToken, { permissions: [] }),
    )
    expect(res.statusCode).toBe(400)
  })

  it('returns 201 and the created role', async () => {
    const res = await app.inject(
      req('POST', '/api/admin/roles', adminToken, {
        name: 'editor',
        permissions: [Permission.PROJECT_READ, Permission.PROJECT_UPDATE],
      }),
    )
    expect(res.statusCode).toBe(201)
    const body = res.json<Record<string, unknown>>()
    expect(body.name).toBe('editor')
    expect(body.tenantId).toBe(testTenantId)
    expect(body.isBuiltin).toBe(false)
    expect(body.permissions).toContain(Permission.PROJECT_READ)
    expect(body.id).toBeTypeOf('string')
  })

  it('returns 409 when a role with the same name already exists', async () => {
    await app.inject(
      req('POST', '/api/admin/roles', adminToken, { name: 'duplicate', permissions: [] }),
    )
    const res = await app.inject(
      req('POST', '/api/admin/roles', adminToken, { name: 'duplicate', permissions: [] }),
    )
    expect(res.statusCode).toBe(409)
  })
})

// ─── PUT /api/admin/roles/:roleId ─────────────────────────────────────────────

describe('PUT /api/admin/roles/:roleId', () => {
  it('returns 200 and the updated role', async () => {
    const created = await app.inject(
      req('POST', '/api/admin/roles', adminToken, { name: 'to-update', permissions: [] }),
    )
    const roleId = created.json<{ id: string }>().id

    const res = await app.inject(
      req('PUT', `/api/admin/roles/${roleId}`, adminToken, {
        name: 'updated-name',
        permissions: [Permission.CHAT_USE],
      }),
    )
    expect(res.statusCode).toBe(200)
    const body = res.json<Record<string, unknown>>()
    expect(body.name).toBe('updated-name')
    expect(body.permissions).toContain(Permission.CHAT_USE)
  })

  it('returns 400 when updating a built-in role', async () => {
    const res = await app.inject(
      req('PUT', `/api/admin/roles/${builtinRoleId}`, adminToken, { name: 'new-name' }),
    )
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 when the role does not exist', async () => {
    const res = await app.inject(
      req('PUT', '/api/admin/roles/00000000-0000-0000-0000-000000000000', adminToken, {
        name: 'x',
      }),
    )
    expect(res.statusCode).toBe(404)
  })

  it('returns 400 for an invalid request body', async () => {
    const res = await app.inject(
      req('PUT', `/api/admin/roles/${adminRoleId}`, adminToken, { name: '' }),
    )
    expect(res.statusCode).toBe(400)
  })
})

// ─── DELETE /api/admin/roles/:roleId ─────────────────────────────────────────

describe('DELETE /api/admin/roles/:roleId', () => {
  it('returns 204 and removes the role', async () => {
    const created = await app.inject(
      req('POST', '/api/admin/roles', adminToken, { name: 'to-delete', permissions: [] }),
    )
    const roleId = created.json<{ id: string }>().id

    const res = await app.inject(req('DELETE', `/api/admin/roles/${roleId}`, adminToken))
    expect(res.statusCode).toBe(204)

    const roles = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(eq(schema.roles.id, roleId))
    expect(roles).toHaveLength(0)
  })

  it('returns 400 when deleting a built-in role', async () => {
    const res = await app.inject(
      req('DELETE', `/api/admin/roles/${builtinRoleId}`, adminToken),
    )
    expect(res.statusCode).toBe(400)
  })

  it('returns 409 when the role is still assigned to a user', async () => {
    const created = await app.inject(
      req('POST', '/api/admin/roles', adminToken, { name: 'referenced', permissions: [] }),
    )
    const roleId = created.json<{ id: string }>().id

    await db.insert(schema.userRoles).values({
      userId: testUserId,
      roleId,
      tenantId: testTenantId,
    })

    const res = await app.inject(req('DELETE', `/api/admin/roles/${roleId}`, adminToken))
    expect(res.statusCode).toBe(409)

    // Cleanup the user_role so afterEach can delete the role
    await db
      .delete(schema.userRoles)
      .where(and(eq(schema.userRoles.userId, testUserId), eq(schema.userRoles.roleId, roleId)))
  })

  it('returns 404 when the role does not exist', async () => {
    const res = await app.inject(
      req('DELETE', '/api/admin/roles/00000000-0000-0000-0000-000000000000', adminToken),
    )
    expect(res.statusCode).toBe(404)
  })
})

// ─── tenant isolation ─────────────────────────────────────────────────────────

describe('tenant isolation', () => {
  it('does not return roles belonging to another tenant', async () => {
    const [otherTenant] = await db
      .insert(schema.tenants)
      .values({ name: 'Other Tenant', slug: `other-roles-${Date.now()}` })
      .returning({ id: schema.tenants.id })

    await db
      .insert(schema.roles)
      .values({ tenantId: otherTenant!.id, name: 'other-role', permissions: [] })

    const res = await app.inject(req('GET', '/api/admin/roles', adminToken))
    const body = res.json<{ tenantId: string }[]>()
    expect(body.every((r) => r.tenantId === testTenantId)).toBe(true)

    await db.delete(schema.roles).where(eq(schema.roles.tenantId, otherTenant!.id))
    await db.delete(schema.tenants).where(eq(schema.tenants.id, otherTenant!.id))
  })
})
