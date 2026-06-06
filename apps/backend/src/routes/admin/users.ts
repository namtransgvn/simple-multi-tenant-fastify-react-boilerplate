import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { db } from '../../db/index.js'
import { rbacService } from '../../services/rbac.service.js'
import { requirePermission } from '../../hooks/permission-guard.js'
import { Permission } from '@repo/shared'

const AssignRolesBodySchema = z.object({
  roleIds: z.array(z.string().uuid()).min(1),
})

async function adminUsersRoutes(fastify: FastifyInstance): Promise<void> {
  const guard = { preHandler: [requirePermission(Permission.ADMIN_MANAGE)] }

  fastify.get<{ Params: { userId: string } }>(
    '/:userId/roles',
    guard,
    async (request) => {
      return rbacService.getUserRoles(request.tenantId!, request.params.userId, db)
    },
  )

  fastify.post<{ Params: { userId: string }; Body: unknown }>(
    '/:userId/roles',
    guard,
    async (request, reply) => {
      const parsed = AssignRolesBodySchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.badRequest(parsed.error.errors[0]?.message ?? 'Invalid request body')
      }
      await rbacService.assignRoles(request.tenantId!, request.params.userId, parsed.data.roleIds, db)
      return reply.status(204).send()
    },
  )

  fastify.delete<{ Params: { userId: string; roleId: string } }>(
    '/:userId/roles/:roleId',
    guard,
    async (request, reply) => {
      await rbacService.revokeRole(
        request.tenantId!,
        request.params.userId,
        request.params.roleId,
        db,
      )
      return reply.status(204).send()
    },
  )
}

export default adminUsersRoutes
