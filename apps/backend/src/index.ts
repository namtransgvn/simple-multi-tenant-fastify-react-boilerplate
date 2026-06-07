import { buildApp } from './app.js'
import { config } from './config.js'
import { db } from './db/index.js'
import { initAuthProviders } from './providers/auth/factory.js'

const fastify = await buildApp()

await initAuthProviders(db)

try {
  await fastify.listen({ port: config.port, host: '0.0.0.0' })
  fastify.log.info(`Server listening on port ${config.port}`)
} catch (err) {
  fastify.log.error(err)
  process.exit(1)
}
