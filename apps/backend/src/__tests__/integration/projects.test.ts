import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import {
  buildTestApp,
  createTestTenant,
  db,
  makeRequest,
  schema,
  truncateAllTables,
  type TestTenant,
} from './test-helpers.js'

describe('projects routes', () => {
  let app: FastifyInstance
  let tenant: TestTenant

  beforeAll(async () => {
    app = await buildTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    await truncateAllTables()
    tenant = await createTestTenant()
  })

  // ── POST /api/projects ────────────────────────────────────────────────────

  it('creates a project and returns 201 with the new project', async () => {
    const res = await makeRequest(app, {
      method: 'POST',
      url: '/api/projects',
      token: tenant.adminUser.token,
      body: { name: 'My Project', description: 'Integration test project' },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json<{ id: string; name: string; tenantId: string; documentCount: number }>()
    expect(body.name).toBe('My Project')
    expect(body.tenantId).toBe(tenant.tenantId)
    expect(body.documentCount).toBe(0)
    expect(typeof body.id).toBe('string')
  })

  it('returns 400 for missing project name', async () => {
    const res = await makeRequest(app, {
      method: 'POST',
      url: '/api/projects',
      token: tenant.adminUser.token,
      body: { description: 'No name provided' },
    })

    expect(res.statusCode).toBe(400)
  })

  it('member with project:create permission can create a project', async () => {
    const res = await makeRequest(app, {
      method: 'POST',
      url: '/api/projects',
      token: tenant.memberUser.token,
      body: { name: 'Member Project' },
    })

    expect(res.statusCode).toBe(201)
  })

  // ── GET /api/projects ─────────────────────────────────────────────────────

  it('returns paginated results with correct metadata', async () => {
    // Insert 5 projects directly.
    for (let i = 0; i < 5; i++) {
      await db.insert(schema.projects).values({
        tenantId: tenant.tenantId,
        ownerId: tenant.adminUser.id,
        name: `Project ${i}`,
      })
    }

    const res = await makeRequest(app, {
      method: 'GET',
      url: '/api/projects?page=2&limit=2',
      token: tenant.adminUser.token,
    })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ items: unknown[]; total: number; page: number; limit: number }>()
    expect(body.total).toBe(5)
    expect(body.items.length).toBe(2)
    expect(body.page).toBe(2)
    expect(body.limit).toBe(2)
  })

  it('soft-deleted projects do not appear in the list', async () => {
    const [active] = await db
      .insert(schema.projects)
      .values({ tenantId: tenant.tenantId, ownerId: tenant.adminUser.id, name: 'Active' })
      .returning()

    const [deleted] = await db
      .insert(schema.projects)
      .values({
        tenantId: tenant.tenantId,
        ownerId: tenant.adminUser.id,
        name: 'Deleted',
        deletedAt: new Date(),
      })
      .returning()

    const res = await makeRequest(app, {
      method: 'GET',
      url: '/api/projects',
      token: tenant.adminUser.token,
    })

    expect(res.statusCode).toBe(200)
    const ids = res.json<{ items: { id: string }[] }>().items.map((p) => p.id)
    expect(ids).toContain(active!.id)
    expect(ids).not.toContain(deleted!.id)
  })

  // ── GET /api/projects/:projectId ──────────────────────────────────────────

  it('returns 404 for a non-existent project', async () => {
    const res = await makeRequest(app, {
      method: 'GET',
      url: '/api/projects/00000000-0000-0000-0000-000000000099',
      token: tenant.adminUser.token,
    })

    expect(res.statusCode).toBe(404)
  })

  // ── PUT /api/projects/:projectId ──────────────────────────────────────────

  it('owner can update their own project', async () => {
    const [project] = await db
      .insert(schema.projects)
      .values({ tenantId: tenant.tenantId, ownerId: tenant.adminUser.id, name: 'Original' })
      .returning()

    const res = await makeRequest(app, {
      method: 'PUT',
      url: `/api/projects/${project!.id}`,
      token: tenant.adminUser.token,
      body: { name: 'Updated', description: 'New description' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json<{ name: string }>().name).toBe('Updated')
  })

  it('non-owner without admin:manage permission gets 403', async () => {
    // Project is owned by adminUser.
    const [project] = await db
      .insert(schema.projects)
      .values({ tenantId: tenant.tenantId, ownerId: tenant.adminUser.id, name: 'Admin Project' })
      .returning()

    // memberUser has no admin:manage and is not the owner.
    const res = await makeRequest(app, {
      method: 'PUT',
      url: `/api/projects/${project!.id}`,
      token: tenant.memberUser.token,
      body: { name: 'Hijacked' },
    })

    expect(res.statusCode).toBe(403)
  })

  // ── DELETE /api/projects/:projectId ──────────────────────────────────────

  it('soft-deletes a project and it disappears from list', async () => {
    const [project] = await db
      .insert(schema.projects)
      .values({ tenantId: tenant.tenantId, ownerId: tenant.adminUser.id, name: 'To Delete' })
      .returning()

    const delRes = await makeRequest(app, {
      method: 'DELETE',
      url: `/api/projects/${project!.id}`,
      token: tenant.adminUser.token,
    })

    expect(delRes.statusCode).toBe(204)

    // Verify deleted_at is set in DB, not a hard delete.
    const [row] = await db
      .select({ deletedAt: schema.projects.deletedAt })
      .from(schema.projects)
      .where(eq(schema.projects.id, project!.id))
    expect(row?.deletedAt).not.toBeNull()

    // Verify it no longer appears in the API list.
    const listRes = await makeRequest(app, {
      method: 'GET',
      url: '/api/projects',
      token: tenant.adminUser.token,
    })
    const ids = listRes.json<{ items: { id: string }[] }>().items.map((p) => p.id)
    expect(ids).not.toContain(project!.id)
  })

  it('member without project:delete permission gets 403 on delete', async () => {
    const [project] = await db
      .insert(schema.projects)
      .values({ tenantId: tenant.tenantId, ownerId: tenant.adminUser.id, name: 'Protected' })
      .returning()

    const res = await makeRequest(app, {
      method: 'DELETE',
      url: `/api/projects/${project!.id}`,
      token: tenant.memberUser.token,
    })

    expect(res.statusCode).toBe(403)
  })
})
