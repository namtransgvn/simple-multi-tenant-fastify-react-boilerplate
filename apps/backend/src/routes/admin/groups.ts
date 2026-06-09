import type { FastifyInstance } from 'fastify'
import { db } from '../../db/index.js'
import { rbacService } from '../../services/rbac.service.js'
import { requirePermission } from '../../hooks/permission-guard.js'
import { Permission, CreateGroupRequestSchema, AddGroupMemberRequestSchema } from '@repo/shared'

async function adminGroupsRoutes(fastify: FastifyInstance): Promise<void> {
  const guard = { preHandler: [requirePermission(Permission.ADMIN_MANAGE)] }

  fastify.get('/', guard, async (request) => {
    return rbacService.listGroups(request.tenantId!, db)
  })

  fastify.post<{ Body: unknown }>('/', guard, async (request, reply) => {
    const parsed = CreateGroupRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.badRequest(parsed.error.errors[0]?.message ?? 'Invalid request body')
    }
    const group = await rbacService.createGroup(request.tenantId!, parsed.data, db)
    return reply.status(201).send(group)
  })

  fastify.get<{ Params: { groupId: string } }>(
    '/:groupId/members',
    guard,
    async (request) => {
      return rbacService.listGroupMembers(request.tenantId!, request.params.groupId, db)
    },
  )

  fastify.post<{ Params: { groupId: string }; Body: unknown }>(
    '/:groupId/members',
    guard,
    async (request, reply) => {
      const parsed = AddGroupMemberRequestSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.badRequest(parsed.error.errors[0]?.message ?? 'Invalid request body')
      }
      await rbacService.addGroupMember(request.tenantId!, request.params.groupId, parsed.data.userId, db)
      return reply.status(204).send()
    },
  )

  fastify.delete<{ Params: { groupId: string; userId: string } }>(
    '/:groupId/members/:userId',
    guard,
    async (request, reply) => {
      await rbacService.removeGroupMember(
        request.tenantId!,
        request.params.groupId,
        request.params.userId,
        db,
      )
      return reply.status(204).send()
    },
  )

  fastify.delete<{ Params: { groupId: string } }>(
    '/:groupId',
    guard,
    async (request, reply) => {
      await rbacService.deleteGroup(request.tenantId!, request.params.groupId, db)
      return reply.status(204).send()
    },
  )
}

export default adminGroupsRoutes
