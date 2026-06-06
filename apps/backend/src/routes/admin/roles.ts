import type { FastifyInstance } from 'fastify'
import { db } from '../../db/index.js'
import { rbacService } from '../../services/rbac.service.js'
import { requirePermission } from '../../hooks/permission-guard.js'
import { Permission, CreateRoleRequestSchema, UpdateRoleRequestSchema } from '@repo/shared'

async function adminRolesRoutes(fastify: FastifyInstance): Promise<void> {
  const guard = { preHandler: [requirePermission(Permission.ADMIN_MANAGE)] }

  fastify.get('/', guard, async (request) => {
    return rbacService.listRoles(request.tenantId!, db)
  })

  fastify.post<{ Body: unknown }>('/', guard, async (request, reply) => {
    const parsed = CreateRoleRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.badRequest(parsed.error.errors[0]?.message ?? 'Invalid request body')
    }
    const role = await rbacService.createRole(request.tenantId!, parsed.data, db)
    return reply.status(201).send(role)
  })

  fastify.put<{ Params: { roleId: string }; Body: unknown }>(
    '/:roleId',
    guard,
    async (request, reply) => {
      const parsed = UpdateRoleRequestSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.badRequest(parsed.error.errors[0]?.message ?? 'Invalid request body')
      }
      const role = await rbacService.updateRole(request.tenantId!, request.params.roleId, parsed.data, db)
      return reply.send(role)
    },
  )

  fastify.delete<{ Params: { roleId: string } }>(
    '/:roleId',
    guard,
    async (request, reply) => {
      await rbacService.deleteRole(request.tenantId!, request.params.roleId, db)
      return reply.status(204).send()
    },
  )
}

export default adminRolesRoutes
