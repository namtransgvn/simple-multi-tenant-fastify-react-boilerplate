/**
 * Integration tests for /api/projects/* routes.
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
import { eq, and, isNull } from 'drizzle-orm'
import { buildApp } from '../app.js'
import { db, schema } from '../db/index.js'
import { config } from '../config.js'
import { Permission } from '@repo/shared'

// ─── test state ──────────────────────────────────────────────────────────────

let app: FastifyInstance
let testTenantId: string
let otherTenantId: string
let ownerUserId: string
let otherUserId: string
let ownerToken: string
let otherUserToken: string
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

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` }
}

function jsonBody(payload: unknown) {
  return { headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }
}

// ─── setup / teardown ────────────────────────────────────────────────────────

beforeAll(async () => {
  const slug = `projects-test-${Date.now()}`

  const [tenant] = await db
    .insert(schema.tenants)
    .values({ name: 'Projects Test Tenant', slug })
    .returning({ id: schema.tenants.id })
  testTenantId = tenant.id

  const [other] = await db
    .insert(schema.tenants)
    .values({ name: 'Other Tenant', slug: `other-${Date.now()}` })
    .returning({ id: schema.tenants.id })
  otherTenantId = other.id

  const [owner] = await db
    .insert(schema.users)
    .values({ tenantId: testTenantId, email: `owner-${Date.now()}@example.com` })
    .returning({ id: schema.users.id })
  ownerUserId = owner.id

  const [other2] = await db
    .insert(schema.users)
    .values({ tenantId: testTenantId, email: `other-${Date.now()}@example.com` })
    .returning({ id: schema.users.id })
  otherUserId = other2.id

  ownerToken = makeJwt({
    userId: ownerUserId,
    tenantId: testTenantId,
    roles: [],
    permissions: [Permission.PROJECT_CREATE, Permission.PROJECT_DELETE, Permission.DOCUMENT_MANAGE],
  })

  noPermToken = makeJwt({
    userId: otherUserId,
    tenantId: testTenantId,
    roles: [],
    permissions: [],
  })

  otherUserToken = makeJwt({
    userId: otherUserId,
    tenantId: testTenantId,
    roles: [],
    permissions: [Permission.PROJECT_CREATE, Permission.PROJECT_DELETE],
  })

  adminToken = makeJwt({
    userId: otherUserId,
    tenantId: testTenantId,
    roles: ['Admin'],
    permissions: [
      Permission.PROJECT_CREATE,
      Permission.PROJECT_DELETE,
      Permission.ADMIN_MANAGE,
      Permission.DOCUMENT_MANAGE,
    ],
  })

  app = await buildApp()
  await app.ready()
})

afterAll(async () => {
  await db.delete(schema.documents).where(eq(schema.documents.tenantId, testTenantId))
  await db.delete(schema.projects).where(eq(schema.projects.tenantId, testTenantId))
  await db.delete(schema.users).where(eq(schema.users.id, ownerUserId))
  await db.delete(schema.users).where(eq(schema.users.id, otherUserId))
  await db.delete(schema.tenants).where(eq(schema.tenants.id, testTenantId))
  await db.delete(schema.tenants).where(eq(schema.tenants.id, otherTenantId))
  await app.close()
})

afterEach(async () => {
  await db.delete(schema.documents).where(eq(schema.documents.tenantId, testTenantId))
  await db
    .update(schema.projects)
    .set({ deletedAt: null })
    .where(eq(schema.projects.tenantId, testTenantId))
  await db.delete(schema.projects).where(eq(schema.projects.tenantId, testTenantId))
})

// ─── GET /api/projects ────────────────────────────────────────────────────────

describe('GET /api/projects', () => {
  it('returns 401 without an auth token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 200 with empty items when no projects exist', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/projects',
      headers: authHeader(ownerToken),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ items: unknown[]; total: number; page: number; limit: number }>()
    expect(body.items).toEqual([])
    expect(body.total).toBe(0)
    expect(body.page).toBe(1)
    expect(body.limit).toBe(20)
  })

  it('returns projects belonging to the tenant', async () => {
    await db.insert(schema.projects).values({
      tenantId: testTenantId,
      ownerId: ownerUserId,
      name: 'Alpha',
    })
    await db.insert(schema.projects).values({
      tenantId: testTenantId,
      ownerId: ownerUserId,
      name: 'Beta',
    })

    const res = await app.inject({
      method: 'GET', url: '/api/projects',
      headers: authHeader(ownerToken),
    })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ items: { name: string }[]; total: number }>()
    expect(body.total).toBe(2)
    expect(body.items).toHaveLength(2)
    expect(body.items.map((i) => i.name).sort()).toEqual(['Alpha', 'Beta'])
  })

  it('respects ?page and ?limit query params', async () => {
    for (let i = 0; i < 3; i++) {
      await db.insert(schema.projects).values({
        tenantId: testTenantId,
        ownerId: ownerUserId,
        name: `Project ${i}`,
      })
    }

    const res = await app.inject({
      method: 'GET', url: '/api/projects?page=1&limit=2',
      headers: authHeader(ownerToken),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ items: unknown[]; total: number; limit: number; page: number }>()
    expect(body.items).toHaveLength(2)
    expect(body.total).toBe(3)
    expect(body.limit).toBe(2)
    expect(body.page).toBe(1)
  })

  it('excludes soft-deleted projects', async () => {
    const [project] = await db
      .insert(schema.projects)
      .values({ tenantId: testTenantId, ownerId: ownerUserId, name: 'Deleted' })
      .returning({ id: schema.projects.id })
    await db
      .update(schema.projects)
      .set({ deletedAt: new Date() })
      .where(eq(schema.projects.id, project.id))

    const res = await app.inject({
      method: 'GET', url: '/api/projects',
      headers: authHeader(ownerToken),
    })
    expect(res.json<{ total: number }>().total).toBe(0)
  })
})

// ─── POST /api/projects ───────────────────────────────────────────────────────

describe('POST /api/projects', () => {
  it('returns 401 without a token', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/projects',
      ...jsonBody({ name: 'X' }),
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 403 when user lacks project:create permission', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/projects',
      headers: authHeader(noPermToken),
      ...jsonBody({ name: 'Blocked' }),
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns 201 and creates the project', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/projects',
      headers: authHeader(ownerToken),
      ...jsonBody({ name: 'New Project', description: 'A desc' }),
    })

    expect(res.statusCode).toBe(201)
    const body = res.json<Record<string, unknown>>()
    expect(body.name).toBe('New Project')
    expect(body.description).toBe('A desc')
    expect(body.ownerId).toBe(ownerUserId)
    expect(body.tenantId).toBe(testTenantId)
    expect(body.documentCount).toBe(0)
    expect(body.id).toBeTypeOf('string')
  })

  it('creates a project without a description', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/projects',
      headers: authHeader(ownerToken),
      ...jsonBody({ name: 'Minimal' }),
    })
    expect(res.statusCode).toBe(201)
    expect(res.json<{ description: unknown }>().description).toBeNull()
  })

  it('returns 400 when name is missing', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/projects',
      headers: authHeader(ownerToken),
      ...jsonBody({ description: 'No name' }),
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when name exceeds 100 characters', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/projects',
      headers: authHeader(ownerToken),
      ...jsonBody({ name: 'x'.repeat(101) }),
    })
    expect(res.statusCode).toBe(400)
  })
})

// ─── GET /api/projects/:projectId ────────────────────────────────────────────

describe('GET /api/projects/:projectId', () => {
  it('returns 401 without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects/00000000-0000-0000-0000-000000000001' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 404 for a non-existent project', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/projects/00000000-0000-0000-0000-000000000099',
      headers: authHeader(ownerToken),
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 200 with the project', async () => {
    const [project] = await db
      .insert(schema.projects)
      .values({ tenantId: testTenantId, ownerId: ownerUserId, name: 'My Project' })
      .returning()

    const res = await app.inject({
      method: 'GET', url: `/api/projects/${project.id}`,
      headers: authHeader(ownerToken),
    })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ id: string; name: string; documentCount: number }>()
    expect(body.id).toBe(project.id)
    expect(body.name).toBe('My Project')
    expect(body.documentCount).toBe(0)
  })

  it('returns 404 for a soft-deleted project', async () => {
    const [project] = await db
      .insert(schema.projects)
      .values({ tenantId: testTenantId, ownerId: ownerUserId, name: 'Gone' })
      .returning()
    await db
      .update(schema.projects)
      .set({ deletedAt: new Date() })
      .where(eq(schema.projects.id, project.id))

    const res = await app.inject({
      method: 'GET', url: `/api/projects/${project.id}`,
      headers: authHeader(ownerToken),
    })
    expect(res.statusCode).toBe(404)
  })
})

// ─── PUT /api/projects/:projectId ────────────────────────────────────────────

describe('PUT /api/projects/:projectId', () => {
  it('returns 401 without a token', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/api/projects/00000000-0000-0000-0000-000000000001',
      ...jsonBody({ name: 'X' }),
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 404 for a non-existent project', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/api/projects/00000000-0000-0000-0000-000000000099',
      headers: authHeader(ownerToken),
      ...jsonBody({ name: 'X' }),
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 200 when the owner updates their own project', async () => {
    const [project] = await db
      .insert(schema.projects)
      .values({ tenantId: testTenantId, ownerId: ownerUserId, name: 'Original' })
      .returning()

    const res = await app.inject({
      method: 'PUT', url: `/api/projects/${project.id}`,
      headers: authHeader(ownerToken),
      ...jsonBody({ name: 'Renamed', description: 'Updated desc' }),
    })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ name: string; description: string }>()
    expect(body.name).toBe('Renamed')
    expect(body.description).toBe('Updated desc')
  })

  it('returns 403 when a non-owner without admin:manage tries to update', async () => {
    const [project] = await db
      .insert(schema.projects)
      .values({ tenantId: testTenantId, ownerId: ownerUserId, name: 'Owned' })
      .returning()

    const res = await app.inject({
      method: 'PUT', url: `/api/projects/${project.id}`,
      headers: authHeader(noPermToken),
      ...jsonBody({ name: 'Hijacked' }),
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns 200 when an admin updates a project they do not own', async () => {
    const [project] = await db
      .insert(schema.projects)
      .values({ tenantId: testTenantId, ownerId: ownerUserId, name: 'Owned By Other' })
      .returning()

    const res = await app.inject({
      method: 'PUT', url: `/api/projects/${project.id}`,
      headers: authHeader(adminToken),
      ...jsonBody({ name: 'Admin Updated' }),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json<{ name: string }>().name).toBe('Admin Updated')
  })

  it('returns 400 for an invalid body', async () => {
    const [project] = await db
      .insert(schema.projects)
      .values({ tenantId: testTenantId, ownerId: ownerUserId, name: 'X' })
      .returning()

    const res = await app.inject({
      method: 'PUT', url: `/api/projects/${project.id}`,
      headers: authHeader(ownerToken),
      ...jsonBody({ name: 'x'.repeat(101) }),
    })
    expect(res.statusCode).toBe(400)
  })
})

// ─── DELETE /api/projects/:projectId ─────────────────────────────────────────

describe('DELETE /api/projects/:projectId', () => {
  it('returns 401 without a token', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/projects/00000000-0000-0000-0000-000000000001' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 403 when user lacks project:delete permission', async () => {
    const [project] = await db
      .insert(schema.projects)
      .values({ tenantId: testTenantId, ownerId: ownerUserId, name: 'X' })
      .returning()

    const res = await app.inject({
      method: 'DELETE', url: `/api/projects/${project.id}`,
      headers: authHeader(noPermToken),
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns 204 and soft-deletes the project', async () => {
    const [project] = await db
      .insert(schema.projects)
      .values({ tenantId: testTenantId, ownerId: ownerUserId, name: 'To Delete' })
      .returning()

    const res = await app.inject({
      method: 'DELETE', url: `/api/projects/${project.id}`,
      headers: authHeader(ownerToken),
    })
    expect(res.statusCode).toBe(204)

    const [row] = await db
      .select({ deletedAt: schema.projects.deletedAt })
      .from(schema.projects)
      .where(eq(schema.projects.id, project.id))
    expect(row?.deletedAt).not.toBeNull()
  })

  it('returns 404 for a non-existent project', async () => {
    const res = await app.inject({
      method: 'DELETE', url: '/api/projects/00000000-0000-0000-0000-000000000099',
      headers: authHeader(ownerToken),
    })
    expect(res.statusCode).toBe(404)
  })
})

// ─── tenant isolation ─────────────────────────────────────────────────────────

describe('tenant isolation', () => {
  it('does not return projects from another tenant', async () => {
    const [otherUser] = await db
      .insert(schema.users)
      .values({ tenantId: otherTenantId, email: `iso-${Date.now()}@example.com` })
      .returning({ id: schema.users.id })

    await db.insert(schema.projects).values({
      tenantId: otherTenantId,
      ownerId: otherUser.id,
      name: 'Other Tenant Project',
    })

    const res = await app.inject({
      method: 'GET', url: '/api/projects',
      headers: authHeader(ownerToken),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json<{ total: number }>().total).toBe(0)

    // Cleanup
    await db.delete(schema.projects).where(eq(schema.projects.tenantId, otherTenantId))
    await db.delete(schema.users).where(eq(schema.users.id, otherUser.id))
  })

  it('returns 404 when fetching a project that belongs to another tenant', async () => {
    const [otherUser] = await db
      .insert(schema.users)
      .values({ tenantId: otherTenantId, email: `iso2-${Date.now()}@example.com` })
      .returning({ id: schema.users.id })
    const [otherProject] = await db
      .insert(schema.projects)
      .values({ tenantId: otherTenantId, ownerId: otherUser.id, name: 'Private' })
      .returning()

    const res = await app.inject({
      method: 'GET', url: `/api/projects/${otherProject.id}`,
      headers: authHeader(ownerToken),
    })
    expect(res.statusCode).toBe(404)

    // Cleanup
    await db.delete(schema.projects).where(eq(schema.projects.id, otherProject.id))
    await db.delete(schema.users).where(eq(schema.users.id, otherUser.id))
  })
})
