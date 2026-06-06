import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import {
  buildTestApp,
  createTestTenant,
  db,
  makeRequest,
  schema,
  truncateAllTables,
} from './test-helpers.js'

describe('tenant isolation', () => {
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

  it('tenant A cannot read, update, or delete tenant B projects', async () => {
    const tenantA = await createTestTenant('tenant-a')
    const tenantB = await createTestTenant('tenant-b')

    // Create one project per tenant directly in the DB.
    const [projectA] = await db
      .insert(schema.projects)
      .values({ tenantId: tenantA.tenantId, ownerId: tenantA.adminUser.id, name: 'Project A' })
      .returning()

    const [projectB] = await db
      .insert(schema.projects)
      .values({ tenantId: tenantB.tenantId, ownerId: tenantB.adminUser.id, name: 'Project B' })
      .returning()

    const pidB = projectB!.id

    // GET /api/projects/:id — must be 404, not the actual project.
    const getRes = await makeRequest(app, {
      method: 'GET',
      url: `/api/projects/${pidB}`,
      token: tenantA.adminUser.token,
    })
    expect(getRes.statusCode).toBe(404)

    // PUT /api/projects/:id — must be 404.
    const putRes = await makeRequest(app, {
      method: 'PUT',
      url: `/api/projects/${pidB}`,
      token: tenantA.adminUser.token,
      body: { name: 'Hijacked' },
    })
    expect(putRes.statusCode).toBe(404)

    // DELETE /api/projects/:id — must be 404.
    const delRes = await makeRequest(app, {
      method: 'DELETE',
      url: `/api/projects/${pidB}`,
      token: tenantA.adminUser.token,
    })
    expect(delRes.statusCode).toBe(404)

    // GET /api/projects (list) — must only contain tenant A's project.
    const listRes = await makeRequest(app, {
      method: 'GET',
      url: '/api/projects',
      token: tenantA.adminUser.token,
    })
    expect(listRes.statusCode).toBe(200)

    const listBody = listRes.json<{ items: { id: string }[] }>()
    const returnedIds = listBody.items.map((p) => p.id)
    expect(returnedIds).toContain(projectA!.id)
    expect(returnedIds).not.toContain(pidB)
  })

  it('tenant A cannot manage roles of tenant B', async () => {
    const tenantA = await createTestTenant('role-tenant-a')
    const tenantB = await createTestTenant('role-tenant-b')

    // Tenant A admin attempts to list tenant B's roles — the route scopes
    // the query to request.tenantId (from JWT), so tenant A sees its own roles.
    const listRes = await makeRequest(app, {
      method: 'GET',
      url: '/api/admin/roles',
      token: tenantA.adminUser.token,
    })
    expect(listRes.statusCode).toBe(200)

    const roles = listRes.json<{ id: string; tenantId: string }[]>()
    for (const role of roles) {
      expect(role.tenantId).toBe(tenantA.tenantId)
      expect(role.tenantId).not.toBe(tenantB.tenantId)
    }
  })

  it('tenant A admin cannot access tenant B AI provider config', async () => {
    const tenantA = await createTestTenant('ai-tenant-a')
    const tenantB = await createTestTenant('ai-tenant-b')

    // Configure an AI provider for tenant B only.
    await makeRequest(app, {
      method: 'POST',
      url: '/api/admin/ai-providers',
      token: tenantB.adminUser.token,
      body: { providerType: 'openai', apiKey: 'sk-b-secret' },
    })

    // Tenant A admin GET /api/admin/ai-providers — must return its own (empty) list.
    const listRes = await makeRequest(app, {
      method: 'GET',
      url: '/api/admin/ai-providers',
      token: tenantA.adminUser.token,
    })
    expect(listRes.statusCode).toBe(200)

    const providers = listRes.json<{ providerType: string }[]>()
    expect(providers).toHaveLength(0)
  })
})
