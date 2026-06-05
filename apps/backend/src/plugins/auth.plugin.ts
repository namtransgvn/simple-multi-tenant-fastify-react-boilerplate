import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'
import { authenticate } from '../hooks/authenticate.js'
import { tenantGuard } from '../hooks/tenant-guard.js'

async function authPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorateRequest('tenantId', null)
  fastify.addHook('onRequest', authenticate)
  fastify.addHook('onRequest', tenantGuard)
}

export default fp(authPlugin, {
  name: 'auth-plugin',
  dependencies: ['@fastify/jwt', '@fastify/sensible'],
})
