import { describe, it, expect, vi } from 'vitest'

vi.mock('../config.js', () => ({
  config: {
    masterTenantId: '00000000-0000-0000-0000-000000000001',
    jwtSecret: 'unit-test-secret-at-least-32-chars-long!',
    uploadDir: './uploads',
  },
}))

import { rbacService } from './rbac.service.js'
import { Permission } from '@repo/shared'

// ─── fixtures ────────────────────────────────────────────────────────────────

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-000000000001'
const ROLE_ID = 'cccccccc-0000-0000-0000-000000000003'
const ROLE_ID_2 = 'cccccccc-0000-0000-0000-000000000004'
const GROUP_ID = 'dddddddd-0000-0000-0000-000000000004'
const USER_ID = 'eeeeeeee-0000-0000-0000-000000000005'

// ─── mock helpers ─────────────────────────────────────────────────────────────

/**
 * Builds a chainable thenable that resolves to `value`.
 * All Drizzle query builder methods return `self`; `.returning()` resolves to `value`.
 */
function thenable(value: unknown): any {
  const self: any = {
    then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
      Promise.resolve(value).then(resolve, reject)
    },
    returning: vi.fn().mockResolvedValue(value),
  }
  for (const m of [
    'from', 'innerJoin', 'leftJoin', 'where', 'limit', 'offset',
    'set', 'values', 'onConflictDoUpdate', 'onConflictDoNothing', 'groupBy', 'orderBy',
  ]) {
    self[m] = vi.fn().mockReturnValue(self)
  }
  return self
}

function mockDb(opts: {
  selectSeq?: unknown[]
  insertReturn?: unknown
  updateReturn?: unknown
  deleteReturn?: unknown
} = {}) {
  const { selectSeq = [], insertReturn = [], updateReturn = [], deleteReturn = [] } = opts
  let selectIdx = 0
  return {
    select: vi.fn().mockImplementation(() => thenable(selectSeq[selectIdx++] ?? [])),
    insert: vi.fn().mockReturnValue(thenable(insertReturn)),
    update: vi.fn().mockReturnValue(thenable(updateReturn)),
    delete: vi.fn().mockReturnValue(thenable(deleteReturn)),
  }
}

function roleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ROLE_ID,
    tenantId: TENANT_ID,
    name: 'editor',
    permissions: [Permission.PROJECT_READ],
    isBuiltin: false,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-02T00:00:00Z'),
    ...overrides,
  }
}

function groupRow(overrides: Record<string, unknown> = {}) {
  return {
    id: GROUP_ID,
    tenantId: TENANT_ID,
    name: 'developers',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-02T00:00:00Z'),
    ...overrides,
  }
}

// ─── listRoles ────────────────────────────────────────────────────────────────

describe('rbacService.listRoles', () => {
  it('returns an empty array when tenant has no roles', async () => {
    const db = mockDb({ selectSeq: [[]] })
    const result = await rbacService.listRoles(TENANT_ID, db as any)
    expect(result).toEqual([])
  })

  it('maps DB rows to RoleResponse objects', async () => {
    const row = roleRow()
    const db = mockDb({ selectSeq: [[row]] })
    const result = await rbacService.listRoles(TENANT_ID, db as any)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      id: ROLE_ID,
      tenantId: TENANT_ID,
      name: 'editor',
      permissions: [Permission.PROJECT_READ],
      isBuiltin: false,
    })
  })
})

// ─── getRole ─────────────────────────────────────────────────────────────────

describe('rbacService.getRole', () => {
  it('returns the role when found', async () => {
    const db = mockDb({ selectSeq: [[roleRow()]] })
    const result = await rbacService.getRole(TENANT_ID, ROLE_ID, db as any)
    expect(result.id).toBe(ROLE_ID)
    expect(result.name).toBe('editor')
  })

  it('throws 404 when the role does not exist', async () => {
    const db = mockDb({ selectSeq: [[]] })
    await expect(
      rbacService.getRole(TENANT_ID, ROLE_ID, db as any),
    ).rejects.toMatchObject({ statusCode: 404, message: 'Role not found' })
  })
})

// ─── createRole ───────────────────────────────────────────────────────────────

describe('rbacService.createRole', () => {
  it('inserts and returns the new role', async () => {
    const row = roleRow()
    // selectSeq[0]: no name conflict found
    const db = mockDb({ selectSeq: [[]], insertReturn: [row] })
    const result = await rbacService.createRole(
      TENANT_ID,
      { name: 'editor', permissions: [Permission.PROJECT_READ] },
      db as any,
    )
    expect(db.insert).toHaveBeenCalledOnce()
    expect(result.id).toBe(ROLE_ID)
    expect(result.name).toBe('editor')
    expect(result.permissions).toEqual([Permission.PROJECT_READ])
  })

  it('throws 409 when a role with the same name already exists in the tenant', async () => {
    const db = mockDb({ selectSeq: [[{ id: ROLE_ID }]] })
    await expect(
      rbacService.createRole(TENANT_ID, { name: 'editor', permissions: [] }, db as any),
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(db.insert).not.toHaveBeenCalled()
  })

  it('throws 400 for an invalid permission string', async () => {
    const db = mockDb()
    await expect(
      rbacService.createRole(
        TENANT_ID,
        { name: 'bad', permissions: ['not:a:permission' as any] },
        db as any,
      ),
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(db.select).not.toHaveBeenCalled()
  })
})

// ─── updateRole ───────────────────────────────────────────────────────────────

describe('rbacService.updateRole', () => {
  it('updates and returns the role', async () => {
    const existing = roleRow()
    const updated = roleRow({ name: 'writer', permissions: [Permission.PROJECT_UPDATE] })
    const db = mockDb({ selectSeq: [[existing]], updateReturn: [updated] })
    const result = await rbacService.updateRole(
      TENANT_ID, ROLE_ID,
      { name: 'writer', permissions: [Permission.PROJECT_UPDATE] },
      db as any,
    )
    expect(db.update).toHaveBeenCalledOnce()
    expect(result.name).toBe('writer')
    expect(result.permissions).toEqual([Permission.PROJECT_UPDATE])
  })

  it('throws 400 when the role is built-in', async () => {
    const db = mockDb({ selectSeq: [[roleRow({ isBuiltin: true })]] })
    await expect(
      rbacService.updateRole(TENANT_ID, ROLE_ID, { name: 'other' }, db as any),
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(db.update).not.toHaveBeenCalled()
  })

  it('throws 404 when the role does not exist', async () => {
    const db = mockDb({ selectSeq: [[]] })
    await expect(
      rbacService.updateRole(TENANT_ID, ROLE_ID, { name: 'x' }, db as any),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

// ─── deleteRole ───────────────────────────────────────────────────────────────

describe('rbacService.deleteRole', () => {
  it('deletes the role when it has no references', async () => {
    // selectSeq: role exists, no userRoles ref, no groupRoles ref
    const db = mockDb({ selectSeq: [[roleRow()], [], []] })
    await rbacService.deleteRole(TENANT_ID, ROLE_ID, db as any)
    expect(db.delete).toHaveBeenCalledOnce()
  })

  it('throws 404 when the role does not exist', async () => {
    const db = mockDb({ selectSeq: [[]] })
    await expect(
      rbacService.deleteRole(TENANT_ID, ROLE_ID, db as any),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('throws 400 when the role is built-in', async () => {
    const db = mockDb({ selectSeq: [[roleRow({ isBuiltin: true })]] })
    await expect(
      rbacService.deleteRole(TENANT_ID, ROLE_ID, db as any),
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(db.delete).not.toHaveBeenCalled()
  })

  it('throws 409 when the role is assigned to a user', async () => {
    // selectSeq: role found, then userRoles ref found
    const db = mockDb({ selectSeq: [[roleRow()], [{ userId: USER_ID }]] })
    await expect(
      rbacService.deleteRole(TENANT_ID, ROLE_ID, db as any),
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(db.delete).not.toHaveBeenCalled()
  })

  it('throws 409 when the role is assigned to a group', async () => {
    // selectSeq: role found, no userRoles ref, groupRoles ref found
    const db = mockDb({ selectSeq: [[roleRow()], [], [{ groupId: GROUP_ID }]] })
    await expect(
      rbacService.deleteRole(TENANT_ID, ROLE_ID, db as any),
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(db.delete).not.toHaveBeenCalled()
  })
})

// ─── listGroups ───────────────────────────────────────────────────────────────

describe('rbacService.listGroups', () => {
  it('returns an empty array when the tenant has no groups', async () => {
    const db = mockDb({ selectSeq: [[]] })
    const result = await rbacService.listGroups(TENANT_ID, db as any)
    expect(result).toEqual([])
    expect(db.select).toHaveBeenCalledOnce()
  })

  it('returns groups with their assigned roles', async () => {
    const group = groupRow()
    const role = roleRow()
    // selectSeq[0]: groups, selectSeq[1]: groupRoles joined with roles
    const db = mockDb({ selectSeq: [[group], [{ groupId: GROUP_ID, role }]] })
    const result = await rbacService.listGroups(TENANT_ID, db as any)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(GROUP_ID)
    expect(result[0].name).toBe('developers')
    expect(result[0].roles).toHaveLength(1)
    expect(result[0].roles[0].id).toBe(ROLE_ID)
  })

  it('returns groups with an empty roles array when none are assigned', async () => {
    const group = groupRow()
    const db = mockDb({ selectSeq: [[group], []] })
    const result = await rbacService.listGroups(TENANT_ID, db as any)
    expect(result[0].roles).toEqual([])
  })
})

// ─── createGroup ──────────────────────────────────────────────────────────────

describe('rbacService.createGroup', () => {
  it('inserts a group with no roles', async () => {
    const group = groupRow({ name: 'new-group' })
    // selectSeq[0]: no name conflict
    const db = mockDb({ selectSeq: [[]], insertReturn: [group] })
    const result = await rbacService.createGroup(
      TENANT_ID, { name: 'new-group', roleIds: [] }, db as any,
    )
    expect(db.insert).toHaveBeenCalledOnce()
    expect(result.name).toBe('new-group')
    expect(result.roles).toEqual([])
  })

  it('inserts a group and its group_roles rows, then returns the roles', async () => {
    const group = groupRow()
    const role = roleRow()
    // selectSeq[0]: validate roleIds (found), selectSeq[1]: no name conflict, selectSeq[2]: role rows
    const db = mockDb({
      selectSeq: [[{ id: ROLE_ID }], [], [role]],
      insertReturn: [group],
    })
    const result = await rbacService.createGroup(
      TENANT_ID, { name: 'developers', roleIds: [ROLE_ID] }, db as any,
    )
    expect(db.insert).toHaveBeenCalledTimes(2)
    expect(result.roles).toHaveLength(1)
    expect(result.roles[0].id).toBe(ROLE_ID)
  })

  it('throws 409 when the group name already exists in the tenant', async () => {
    // selectSeq[0]: all roleIds found (empty), selectSeq[1] (no roles): name conflict
    // With empty roleIds, the roleIds check is skipped, so selectSeq[0] is the name check
    const db = mockDb({ selectSeq: [[{ id: GROUP_ID }]] })
    await expect(
      rbacService.createGroup(TENANT_ID, { name: 'developers', roleIds: [] }, db as any),
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(db.insert).not.toHaveBeenCalled()
  })

  it('throws 400 when a roleId does not belong to the tenant', async () => {
    // selectSeq[0]: validation returns fewer roles than requested
    const db = mockDb({ selectSeq: [[]] })
    await expect(
      rbacService.createGroup(TENANT_ID, { name: 'dev', roleIds: [ROLE_ID] }, db as any),
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(db.insert).not.toHaveBeenCalled()
  })
})

// ─── addGroupMember ───────────────────────────────────────────────────────────

describe('rbacService.addGroupMember', () => {
  it('inserts the user into the group', async () => {
    // selectSeq[0]: group found, selectSeq[1]: user found
    const db = mockDb({ selectSeq: [[{ id: GROUP_ID }], [{ id: USER_ID }]] })
    await rbacService.addGroupMember(TENANT_ID, GROUP_ID, USER_ID, db as any)
    expect(db.insert).toHaveBeenCalledOnce()
  })

  it('throws 404 when the group does not exist', async () => {
    const db = mockDb({ selectSeq: [[]] })
    await expect(
      rbacService.addGroupMember(TENANT_ID, GROUP_ID, USER_ID, db as any),
    ).rejects.toMatchObject({ statusCode: 404, message: 'Group not found' })
    expect(db.insert).not.toHaveBeenCalled()
  })

  it('throws 404 when the user does not exist in the tenant', async () => {
    // selectSeq[0]: group found, selectSeq[1]: user NOT found
    const db = mockDb({ selectSeq: [[{ id: GROUP_ID }], []] })
    await expect(
      rbacService.addGroupMember(TENANT_ID, GROUP_ID, USER_ID, db as any),
    ).rejects.toMatchObject({ statusCode: 404, message: 'User not found' })
    expect(db.insert).not.toHaveBeenCalled()
  })
})

// ─── removeGroupMember ────────────────────────────────────────────────────────

describe('rbacService.removeGroupMember', () => {
  it('deletes the user_groups row', async () => {
    const db = mockDb({ selectSeq: [[{ id: GROUP_ID }]] })
    await rbacService.removeGroupMember(TENANT_ID, GROUP_ID, USER_ID, db as any)
    expect(db.delete).toHaveBeenCalledOnce()
  })

  it('throws 404 when the group does not exist', async () => {
    const db = mockDb({ selectSeq: [[]] })
    await expect(
      rbacService.removeGroupMember(TENANT_ID, GROUP_ID, USER_ID, db as any),
    ).rejects.toMatchObject({ statusCode: 404 })
    expect(db.delete).not.toHaveBeenCalled()
  })
})

// ─── deleteGroup ──────────────────────────────────────────────────────────────

describe('rbacService.deleteGroup', () => {
  it('deletes group_roles, user_groups, then the group itself', async () => {
    const db = mockDb({ selectSeq: [[{ id: GROUP_ID }]] })
    await rbacService.deleteGroup(TENANT_ID, GROUP_ID, db as any)
    expect(db.delete).toHaveBeenCalledTimes(3)
  })

  it('throws 404 when the group does not exist', async () => {
    const db = mockDb({ selectSeq: [[]] })
    await expect(
      rbacService.deleteGroup(TENANT_ID, GROUP_ID, db as any),
    ).rejects.toMatchObject({ statusCode: 404 })
    expect(db.delete).not.toHaveBeenCalled()
  })
})

// ─── getUserRoles ─────────────────────────────────────────────────────────────

describe('rbacService.getUserRoles', () => {
  it('returns empty arrays when user has no roles', async () => {
    const db = mockDb({ selectSeq: [[], []] })
    const result = await rbacService.getUserRoles(TENANT_ID, USER_ID, db as any)
    expect(result.direct).toEqual([])
    expect(result.fromGroups).toEqual([])
  })

  it('returns direct and fromGroups separately', async () => {
    const direct = roleRow()
    const fromGroup = roleRow({ id: ROLE_ID_2, name: 'viewer' })
    // selectSeq[0]: direct roles query, selectSeq[1]: group-derived roles query
    const db = mockDb({ selectSeq: [[direct], [fromGroup]] })
    const result = await rbacService.getUserRoles(TENANT_ID, USER_ID, db as any)
    expect(result.direct).toHaveLength(1)
    expect(result.direct[0].id).toBe(ROLE_ID)
    expect(result.fromGroups).toHaveLength(1)
    expect(result.fromGroups[0].id).toBe(ROLE_ID_2)
  })

  it('deduplicates roles that appear in multiple group assignments', async () => {
    const role = roleRow()
    // Role appears twice in group-derived (user is in two groups with the same role)
    const db = mockDb({ selectSeq: [[], [role, role]] })
    const result = await rbacService.getUserRoles(TENANT_ID, USER_ID, db as any)
    expect(result.fromGroups).toHaveLength(1)
  })
})

// ─── assignRoles ─────────────────────────────────────────────────────────────

describe('rbacService.assignRoles', () => {
  it('inserts user_roles rows for every roleId', async () => {
    const db = mockDb({ selectSeq: [[{ id: ROLE_ID }]] })
    await rbacService.assignRoles(TENANT_ID, USER_ID, [ROLE_ID], db as any)
    expect(db.insert).toHaveBeenCalledOnce()
  })

  it('is a no-op when roleIds is empty', async () => {
    const db = mockDb()
    await rbacService.assignRoles(TENANT_ID, USER_ID, [], db as any)
    expect(db.select).not.toHaveBeenCalled()
    expect(db.insert).not.toHaveBeenCalled()
  })

  it('throws 400 when a roleId does not belong to the tenant', async () => {
    const db = mockDb({ selectSeq: [[]] })
    await expect(
      rbacService.assignRoles(TENANT_ID, USER_ID, [ROLE_ID], db as any),
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(db.insert).not.toHaveBeenCalled()
  })

  it('throws 400 when only some roleIds are valid', async () => {
    // 2 requested, 1 found
    const db = mockDb({ selectSeq: [[{ id: ROLE_ID }]] })
    await expect(
      rbacService.assignRoles(TENANT_ID, USER_ID, [ROLE_ID, ROLE_ID_2], db as any),
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})

// ─── revokeRole ───────────────────────────────────────────────────────────────

describe('rbacService.revokeRole', () => {
  it('deletes the user_roles row when another direct role remains', async () => {
    // directRoles: [ROLE_ID, ROLE_ID_2], groupRoles: []
    const db = mockDb({
      selectSeq: [
        [{ roleId: ROLE_ID }, { roleId: ROLE_ID_2 }],
        [],
      ],
    })
    await rbacService.revokeRole(TENANT_ID, USER_ID, ROLE_ID, db as any)
    expect(db.delete).toHaveBeenCalledOnce()
  })

  it('deletes the last direct role when group-derived roles still exist', async () => {
    // directRoles: [ROLE_ID only], groupRoles: [something]
    const db = mockDb({
      selectSeq: [
        [{ roleId: ROLE_ID }],
        [{ groupId: GROUP_ID }],
      ],
    })
    await rbacService.revokeRole(TENANT_ID, USER_ID, ROLE_ID, db as any)
    expect(db.delete).toHaveBeenCalledOnce()
  })

  it('throws 400 when revoking would leave the user with zero roles', async () => {
    // directRoles: [ROLE_ID only], groupRoles: []
    const db = mockDb({
      selectSeq: [
        [{ roleId: ROLE_ID }],
        [],
      ],
    })
    await expect(
      rbacService.revokeRole(TENANT_ID, USER_ID, ROLE_ID, db as any),
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(db.delete).not.toHaveBeenCalled()
  })

  it('does not throw when user has no direct roles at all but revoking a non-assigned role', async () => {
    // directRoles: [], so remaining after revoke is still 0 with no group roles → 400
    const db = mockDb({
      selectSeq: [[], []],
    })
    await expect(
      rbacService.revokeRole(TENANT_ID, USER_ID, ROLE_ID, db as any),
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})
