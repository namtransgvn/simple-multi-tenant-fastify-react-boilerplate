import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Permission } from '@repo/shared'

export function requirePermission(permission: Permission) {
  return async function permissionGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.user?.permissions.includes(permission)) {
      return reply.forbidden(`Missing required permission: ${permission}`)
    }
  }
}
