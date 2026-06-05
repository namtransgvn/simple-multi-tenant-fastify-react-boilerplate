import { index, pgTable, primaryKey, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core'
import { tenants } from './tenants.js'
import { users } from './users.js'
import { roles } from './roles.js'

export const groups = pgTable(
  'groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    name: varchar('name', { length: 100 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('groups_tenant_id_idx').on(t.tenantId),
    unique('groups_tenant_name_uniq').on(t.tenantId, t.name),
  ],
)

export const groupRoles = pgTable(
  'group_roles',
  {
    groupId: uuid('group_id').notNull().references(() => groups.id),
    roleId: uuid('role_id').notNull().references(() => roles.id),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.roleId] })],
)

export const userGroups = pgTable(
  'user_groups',
  {
    userId: uuid('user_id').notNull().references(() => users.id),
    groupId: uuid('group_id').notNull().references(() => groups.id),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.groupId] }),
    index('user_groups_tenant_id_idx').on(t.tenantId),
  ],
)
