import type { JwtPayload } from '@repo/shared'

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload
    user: JwtPayload | null
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    tenantId: string | null
  }

  interface FastifyContextConfig {
    public?: boolean
  }
}
