import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../app.js'

describe('smoke', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('GET /health → 200 { status: "ok" }', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: 'ok' })
  })

  it('GET /api/projects without JWT → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects' })
    expect(res.statusCode).toBe(401)
  })

  it('GET /api/providers → 200 with providers array', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/providers' })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ providers: unknown[] }>()
    expect(Array.isArray(body.providers)).toBe(true)
  })
})
