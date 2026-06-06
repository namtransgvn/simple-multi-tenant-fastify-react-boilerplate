import { and, eq, inArray } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../db/schema/index.js'
import {
  Permission,
  type CreateRoleRequest,
  type UpdateRoleRequest,
  type RoleResponse,
  type CreateGroupRequest,
  type GroupResponse,
  type UserRolesResponse,
} from '@repo/shared'

type Db = PostgresJsDatabase<typeof schema>

function toRoleResponse(role: typeof schema.roles.$inferSelect): RoleResponse {
  return {
    id: role.id,
    tenantId: role.tenantId,
    name: role.name,
    permissions: role.permissions,
    isBuiltin: role.isBuiltin,
  }
}

// ── Role methods ─────────────────────────────────────────────────────────────

async function listRoles(tenantId: string, db: Db): Promise<RoleResponse[]> {
  const rows = await db
    .select()
    .from(schema.roles)
    .where(eq(schema.roles.tenantId, tenantId))
  return rows.map(toRoleResponse)
}

async function getRole(tenantId: string, roleId: string, db: Db): Promise<RoleResponse> {
  const [role] = await db
    .select()
    .from(schema.roles)
    .where(and(eq(schema.roles.tenantId, tenantId), eq(schema.roles.id, roleId)))
    .limit(1)
  if (!role) {
    throw Object.assign(new Error('Role not found'), { statusCode: 404 })
  }
  return toRoleResponse(role)
}

async function createRole(tenantId: string, data: CreateRoleRequest, db: Db): Promise<RoleResponse> {
  const validPermissions = Object.values(Permission) as string[]
  for (const p of data.permissions) {
    if (!validPermissions.includes(p)) {
      throw Object.assign(new Error(`Invalid permission: ${p}`), { statusCode: 400 })
    }
  }

  const [existing] = await db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(and(eq(schema.roles.tenantId, tenantId), eq(schema.roles.name, data.name)))
    .limit(1)
  if (existing) {
    throw Object.assign(new Error('Role name already exists in this tenant'), { statusCode: 409 })
  }

  const [role] = await db
    .insert(schema.roles)
    .values({ tenantId, name: data.name, permissions: data.permissions })
    .returning()

  return toRoleResponse(role!)
}

async function updateRole(
  tenantId: string,
  roleId: string,
  data: UpdateRoleRequest,
  db: Db,
): Promise<RoleResponse> {
  const [role] = await db
    .select()
    .from(schema.roles)
    .where(and(eq(schema.roles.tenantId, tenantId), eq(schema.roles.id, roleId)))
    .limit(1)
  if (!role) {
    throw Object.assign(new Error('Role not found'), { statusCode: 404 })
  }
  if (role.isBuiltin) {
    throw Object.assign(new Error('Cannot modify a built-in role'), { statusCode: 400 })
  }

  const [updated] = await db
    .update(schema.roles)
    .set({
      ...(data.name !== undefined && { name: data.name }),
      ...(data.permissions !== undefined && { permissions: data.permissions }),
      updatedAt: new Date(),
    })
    .where(eq(schema.roles.id, roleId))
    .returning()

  return toRoleResponse(updated!)
}

async function deleteRole(tenantId: string, roleId: string, db: Db): Promise<void> {
  const [role] = await db
    .select()
    .from(schema.roles)
    .where(and(eq(schema.roles.tenantId, tenantId), eq(schema.roles.id, roleId)))
    .limit(1)
  if (!role) {
    throw Object.assign(new Error('Role not found'), { statusCode: 404 })
  }
  if (role.isBuiltin) {
    throw Object.assign(new Error('Cannot delete a built-in role'), { statusCode: 400 })
  }

  const [userRoleRef] = await db
    .select({ userId: schema.userRoles.userId })
    .from(schema.userRoles)
    .where(eq(schema.userRoles.roleId, roleId))
    .limit(1)
  if (userRoleRef) {
    throw Object.assign(new Error('Role is still assigned to one or more users'), { statusCode: 409 })
  }

  const [groupRoleRef] = await db
    .select({ groupId: schema.groupRoles.groupId })
    .from(schema.groupRoles)
    .where(eq(schema.groupRoles.roleId, roleId))
    .limit(1)
  if (groupRoleRef) {
    throw Object.assign(new Error('Role is still assigned to one or more groups'), { statusCode: 409 })
  }

  await db.delete(schema.roles).where(eq(schema.roles.id, roleId))
}

// ── Group methods ─────────────────────────────────────────────────────────────

async function listGroups(tenantId: string, db: Db): Promise<GroupResponse[]> {
  const groupRows = await db
    .select()
    .from(schema.groups)
    .where(eq(schema.groups.tenantId, tenantId))

  if (groupRows.length === 0) return []

  const groupIds = groupRows.map((g) => g.id)
  const groupRoleRows = await db
    .select({ groupId: schema.groupRoles.groupId, role: schema.roles })
    .from(schema.groupRoles)
    .innerJoin(schema.roles, eq(schema.groupRoles.roleId, schema.roles.id))
    .where(inArray(schema.groupRoles.groupId, groupIds))

  const rolesByGroupId = new Map<string, typeof schema.roles.$inferSelect[]>()
  for (const { groupId, role } of groupRoleRows) {
    const existing = rolesByGroupId.get(groupId) ?? []
    existing.push(role)
    rolesByGroupId.set(groupId, existing)
  }

  return groupRows.map((g) => ({
    id: g.id,
    tenantId: g.tenantId,
    name: g.name,
    roles: (rolesByGroupId.get(g.id) ?? []).map(toRoleResponse),
  }))
}

async function createGroup(tenantId: string, data: CreateGroupRequest, db: Db): Promise<GroupResponse> {
  if (data.roleIds.length > 0) {
    const found = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(and(eq(schema.roles.tenantId, tenantId), inArray(schema.roles.id, data.roleIds)))
    if (found.length !== data.roleIds.length) {
      throw Object.assign(new Error('One or more role IDs not found in this tenant'), { statusCode: 400 })
    }
  }

  const [existing] = await db
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .where(and(eq(schema.groups.tenantId, tenantId), eq(schema.groups.name, data.name)))
    .limit(1)
  if (existing) {
    throw Object.assign(new Error('Group name already exists in this tenant'), { statusCode: 409 })
  }

  const [group] = await db
    .insert(schema.groups)
    .values({ tenantId, name: data.name })
    .returning()

  const roles: typeof schema.roles.$inferSelect[] = []
  if (data.roleIds.length > 0) {
    await db
      .insert(schema.groupRoles)
      .values(data.roleIds.map((roleId) => ({ groupId: group!.id, roleId })))

    const roleRows = await db
      .select()
      .from(schema.roles)
      .where(inArray(schema.roles.id, data.roleIds))
    roles.push(...roleRows)
  }

  return {
    id: group!.id,
    tenantId: group!.tenantId,
    name: group!.name,
    roles: roles.map(toRoleResponse),
  }
}

async function addGroupMember(tenantId: string, groupId: string, userId: string, db: Db): Promise<void> {
  const [group] = await db
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .where(and(eq(schema.groups.tenantId, tenantId), eq(schema.groups.id, groupId)))
    .limit(1)
  if (!group) {
    throw Object.assign(new Error('Group not found'), { statusCode: 404 })
  }

  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.id, userId)))
    .limit(1)
  if (!user) {
    throw Object.assign(new Error('User not found'), { statusCode: 404 })
  }

  await db
    .insert(schema.userGroups)
    .values({ userId, groupId, tenantId })
    .onConflictDoNothing()
}

async function removeGroupMember(tenantId: string, groupId: string, userId: string, db: Db): Promise<void> {
  const [group] = await db
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .where(and(eq(schema.groups.tenantId, tenantId), eq(schema.groups.id, groupId)))
    .limit(1)
  if (!group) {
    throw Object.assign(new Error('Group not found'), { statusCode: 404 })
  }

  await db
    .delete(schema.userGroups)
    .where(
      and(
        eq(schema.userGroups.userId, userId),
        eq(schema.userGroups.groupId, groupId),
        eq(schema.userGroups.tenantId, tenantId),
      ),
    )
}

async function deleteGroup(tenantId: string, groupId: string, db: Db): Promise<void> {
  const [group] = await db
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .where(and(eq(schema.groups.tenantId, tenantId), eq(schema.groups.id, groupId)))
    .limit(1)
  if (!group) {
    throw Object.assign(new Error('Group not found'), { statusCode: 404 })
  }

  await db.delete(schema.groupRoles).where(eq(schema.groupRoles.groupId, groupId))
  await db.delete(schema.userGroups).where(eq(schema.userGroups.groupId, groupId))
  await db.delete(schema.groups).where(eq(schema.groups.id, groupId))
}

// ── User-role assignment ──────────────────────────────────────────────────────

async function getUserRoles(tenantId: string, userId: string, db: Db): Promise<UserRolesResponse> {
  const roleColumns = {
    id: schema.roles.id,
    tenantId: schema.roles.tenantId,
    name: schema.roles.name,
    permissions: schema.roles.permissions,
    isBuiltin: schema.roles.isBuiltin,
  }

  const [direct, fromGroupRows] = await Promise.all([
    db
      .select(roleColumns)
      .from(schema.userRoles)
      .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
      .where(and(eq(schema.userRoles.userId, userId), eq(schema.userRoles.tenantId, tenantId))),
    db
      .select(roleColumns)
      .from(schema.userGroups)
      .innerJoin(schema.groupRoles, eq(schema.userGroups.groupId, schema.groupRoles.groupId))
      .innerJoin(schema.roles, eq(schema.groupRoles.roleId, schema.roles.id))
      .where(and(eq(schema.userGroups.userId, userId), eq(schema.userGroups.tenantId, tenantId))),
  ])

  const seenIds = new Set<string>()
  const fromGroups: RoleResponse[] = []
  for (const role of fromGroupRows) {
    if (!seenIds.has(role.id)) {
      seenIds.add(role.id)
      fromGroups.push(role)
    }
  }

  return { direct, fromGroups }
}

async function assignRoles(tenantId: string, userId: string, roleIds: string[], db: Db): Promise<void> {
  if (roleIds.length === 0) return

  const found = await db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(and(eq(schema.roles.tenantId, tenantId), inArray(schema.roles.id, roleIds)))
  if (found.length !== roleIds.length) {
    throw Object.assign(new Error('One or more role IDs not found in this tenant'), { statusCode: 400 })
  }

  await db
    .insert(schema.userRoles)
    .values(roleIds.map((roleId) => ({ userId, roleId, tenantId })))
    .onConflictDoNothing()
}

async function revokeRole(tenantId: string, userId: string, roleId: string, db: Db): Promise<void> {
  const [directRoles, groupRoles] = await Promise.all([
    db
      .select({ roleId: schema.userRoles.roleId })
      .from(schema.userRoles)
      .where(and(eq(schema.userRoles.userId, userId), eq(schema.userRoles.tenantId, tenantId))),
    db
      .select({ groupId: schema.groupRoles.groupId })
      .from(schema.userGroups)
      .innerJoin(schema.groupRoles, eq(schema.userGroups.groupId, schema.groupRoles.groupId))
      .where(and(eq(schema.userGroups.userId, userId), eq(schema.userGroups.tenantId, tenantId))),
  ])

  const remainingDirect = directRoles.filter((r) => r.roleId !== roleId)
  if (remainingDirect.length === 0 && groupRoles.length === 0) {
    throw Object.assign(
      new Error('Cannot revoke: user must retain at least one role'),
      { statusCode: 400 },
    )
  }

  await db
    .delete(schema.userRoles)
    .where(
      and(
        eq(schema.userRoles.userId, userId),
        eq(schema.userRoles.roleId, roleId),
        eq(schema.userRoles.tenantId, tenantId),
      ),
    )
}

export const rbacService = {
  listRoles,
  getRole,
  createRole,
  updateRole,
  deleteRole,
  listGroups,
  createGroup,
  addGroupMember,
  removeGroupMember,
  deleteGroup,
  getUserRoles,
  assignRoles,
  revokeRole,
}
