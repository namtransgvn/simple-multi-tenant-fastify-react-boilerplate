import type { FastifyReply, FastifyRequest } from 'fastify'

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (request.routeOptions.config?.public) return

  try {
    await request.jwtVerify()
  } catch {
    return reply.unauthorized('Invalid or expired token')
  }
}
