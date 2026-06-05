import { buildApp } from './app.js'
import { config } from './config.js'

const fastify = await buildApp()

try {
  await fastify.listen({ port: config.port, host: '0.0.0.0' })
  fastify.log.info(`Server listening on port ${config.port}`)
} catch (err) {
  fastify.log.error(err)
  process.exit(1)
}
