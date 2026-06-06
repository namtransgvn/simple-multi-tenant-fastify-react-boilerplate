import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { Permission } from '@repo/shared'
import {
  buildTestApp,
  createTestTenant,
  makeRequest,
  truncateAllTables,
  type TestTenant,
} from './test-helpers.js'

describe('RBAC routes', () => {
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

  // ── Access control ────────────────────────────────────────────────────────

  it('member user cannot access GET /api/admin/roles (403)', async () => {
    const res = await makeRequest(app, {
      method: 'GET',
      url: '/api/admin/roles',
      token: tenant.memberUser.token,
    })

    expect(res.statusCode).toBe(403)
  })

  it('unauthenticated request to /api/admin/roles returns 401', async () => {
    const res = await makeRequest(app, { method: 'GET', url: '/api/admin/roles' })
    expect(res.statusCode).toBe(401)
  })

  // ── Role CRUD ─────────────────────────────────────────────────────────────

  it('admin can create a role', async () => {
    const res = await makeRequest(app, {
      method: 'POST',
      url: '/api/admin/roles',
      token: tenant.adminUser.token,
      body: { name: 'custom-role', permissions: [Permission.PROJECT_READ] },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json<{ id: string; name: string; isBuiltin: boolean; permissions: string[] }>()
    expect(body.name).toBe('custom-role')
    expect(body.isBuiltin).toBe(false)
    expect(body.permissions).toContain(Permission.PROJECT_READ)
  })

  it('admin can update a custom role name and permissions', async () => {
    const created = await makeRequest(app, {
      method: 'POST',
      url: '/api/admin/roles',
      token: tenant.adminUser.token,
      body: { name: 'updatable-role', permissions: [Permission.PROJECT_READ] },
    })
    const { id } = created.json<{ id: string }>()

    const res = await makeRequest(app, {
      method: 'PUT',
      url: `/api/admin/roles/${id}`,
      token: tenant.adminUser.token,
      body: { name: 'updated-role', permissions: [Permission.PROJECT_READ, Permission.CHAT_USE] },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ name: string; permissions: string[] }>()
    expect(body.name).toBe('updated-role')
    expect(body.permissions).toContain(Permission.CHAT_USE)
  })

  it('admin can delete a custom role that is not in use', async () => {
    const created = await makeRequest(app, {
      method: 'POST',
      url: '/api/admin/roles',
      token: tenant.adminUser.token,
      body: { name: 'deletable-role', permissions: [] },
    })
    const { id } = created.json<{ id: string }>()

    const res = await makeRequest(app, {
      method: 'DELETE',
      url: `/api/admin/roles/${id}`,
      token: tenant.adminUser.token,
    })

    expect(res.statusCode).toBe(204)
  })

  it('cannot delete a built-in role (returns 400)', async () => {
    // adminRoleId is the built-in "admin" role created by createTestTenant.
    const res = await makeRequest(app, {
      method: 'DELETE',
      url: `/api/admin/roles/${tenant.adminRoleId}`,
      token: tenant.adminUser.token,
    })

    expect(res.statusCode).toBe(400)
  })

  it('cannot delete a role that is currently assigned to a user (returns 409)', async () => {
    // Create a custom role and assign it to memberUser.
    const created = await makeRequest(app, {
      method: 'POST',
      url: '/api/admin/roles',
      token: tenant.adminUser.token,
      body: { name: 'in-use-role', permissions: [] },
    })
    const { id: roleId } = created.json<{ id: string }>()

    await makeRequest(app, {
      method: 'POST',
      url: `/api/admin/users/${tenant.memberUser.id}/roles`,
      token: tenant.adminUser.token,
      body: { roleIds: [roleId] },
    })

    const res = await makeRequest(app, {
      method: 'DELETE',
      url: `/api/admin/roles/${roleId}`,
      token: tenant.adminUser.token,
    })

    expect(res.statusCode).toBe(409)
  })

  // ── User role assignment ──────────────────────────────────────────────────

  it('assign → verify → revoke → verify lifecycle', async () => {
    // Create a custom role so we can revoke it without leaving the user roleless.
    const created = await makeRequest(app, {
      method: 'POST',
      url: '/api/admin/roles',
      token: tenant.adminUser.token,
      body: { name: 'test-assign-role', permissions: [Permission.PROJECT_READ] },
    })
    const { id: roleId } = created.json<{ id: string }>()

    // Assign — memberUser already has the builtin member role, so this is safe.
    const assignRes = await makeRequest(app, {
      method: 'POST',
      url: `/api/admin/users/${tenant.memberUser.id}/roles`,
      token: tenant.adminUser.token,
      body: { roleIds: [roleId] },
    })
    expect(assignRes.statusCode).toBe(204)

    // Verify assigned.
    const afterAssign = await makeRequest(app, {
      method: 'GET',
      url: `/api/admin/users/${tenant.memberUser.id}/roles`,
      token: tenant.adminUser.token,
    })
    expect(afterAssign.statusCode).toBe(200)
    const assignedIds = afterAssign
      .json<{ direct: { id: string }[] }>()
      .direct.map((r) => r.id)
    expect(assignedIds).toContain(roleId)

    // Revoke — memberUser still has the builtin member role, so this is allowed.
    const revokeRes = await makeRequest(app, {
      method: 'DELETE',
      url: `/api/admin/users/${tenant.memberUser.id}/roles/${roleId}`,
      token: tenant.adminUser.token,
    })
    expect(revokeRes.statusCode).toBe(204)

    // Verify revoked.
    const afterRevoke = await makeRequest(app, {
      method: 'GET',
      url: `/api/admin/users/${tenant.memberUser.id}/roles`,
      token: tenant.adminUser.token,
    })
    const revokedIds = afterRevoke
      .json<{ direct: { id: string }[] }>()
      .direct.map((r) => r.id)
    expect(revokedIds).not.toContain(roleId)
  })

  it('cannot revoke a role that would leave the user with no roles (returns 400)', async () => {
    // memberUser has only the builtin member role (no group memberships).
    // Trying to revoke it must be rejected.
    const res = await makeRequest(app, {
      method: 'DELETE',
      url: `/api/admin/users/${tenant.memberUser.id}/roles/${tenant.memberRoleId}`,
      token: tenant.adminUser.token,
    })

    expect(res.statusCode).toBe(400)
  })
})
