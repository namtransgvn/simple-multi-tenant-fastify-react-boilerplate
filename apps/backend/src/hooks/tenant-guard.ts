import type { FastifyReply, FastifyRequest } from 'fastify'

export async function tenantGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (request.routeOptions.config?.public) return

  const tenantId = request.user?.tenantId
  if (!tenantId) {
    return reply.unauthorized('Missing tenant context')
  }
  request.tenantId = tenantId
}
