import { describe, it, expect } from 'vitest'
import {
  CreateProjectRequestSchema,
  ProjectResponseSchema,
  ProjectListResponseSchema,
} from '@repo/shared'

const validProject = {
  id: '00000000-0000-0000-0000-000000000001',
  tenantId: '00000000-0000-0000-0000-000000000002',
  ownerId: '00000000-0000-0000-0000-000000000003',
  name: 'My project',
  description: null,
  documentCount: 0,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
}

describe('CreateProjectRequestSchema', () => {
  it('accepts a name-only request', () => {
    const result = CreateProjectRequestSchema.safeParse({ name: 'My project' })
    expect(result.success).toBe(true)
  })

  it('accepts name + description', () => {
    const result = CreateProjectRequestSchema.safeParse({
      name: 'My project',
      description: 'A description',
    })
    expect(result.success).toBe(true)
  })

  it('treats description as optional', () => {
    const result = CreateProjectRequestSchema.safeParse({ name: 'x' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.description).toBeUndefined()
  })

  it('rejects an empty name', () => {
    const result = CreateProjectRequestSchema.safeParse({ name: '' })
    expect(result.success).toBe(false)
  })

  it('rejects a name longer than 100 characters', () => {
    const result = CreateProjectRequestSchema.safeParse({ name: 'a'.repeat(101) })
    expect(result.success).toBe(false)
  })

  it('accepts a name of exactly 100 characters', () => {
    const result = CreateProjectRequestSchema.safeParse({ name: 'a'.repeat(100) })
    expect(result.success).toBe(true)
  })

  it('rejects missing name', () => {
    const result = CreateProjectRequestSchema.safeParse({})
    expect(result.success).toBe(false)
  })
})

describe('ProjectResponseSchema', () => {
  it('parses a valid project response', () => {
    const result = ProjectResponseSchema.safeParse(validProject)
    expect(result.success).toBe(true)
  })

  it('accepts a non-null description', () => {
    const result = ProjectResponseSchema.safeParse({
      ...validProject,
      description: 'Some description',
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.description).toBe('Some description')
  })

  it('rejects a response missing required fields', () => {
    const { id: _id, ...withoutId } = validProject
    const result = ProjectResponseSchema.safeParse(withoutId)
    expect(result.success).toBe(false)
  })

  it('rejects a negative documentCount', () => {
    const result = ProjectResponseSchema.safeParse({ ...validProject, documentCount: -1 })
    expect(result.success).toBe(false)
  })

  it('rejects a non-uuid id', () => {
    const result = ProjectResponseSchema.safeParse({ ...validProject, id: 'not-a-uuid' })
    expect(result.success).toBe(false)
  })
})

describe('ProjectListResponseSchema', () => {
  it('parses a valid list response', () => {
    const result = ProjectListResponseSchema.safeParse({
      items: [validProject],
      total: 1,
      page: 1,
      limit: 12,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.items).toHaveLength(1)
      expect(result.data.total).toBe(1)
    }
  })

  it('parses an empty items array', () => {
    const result = ProjectListResponseSchema.safeParse({
      items: [],
      total: 0,
      page: 1,
      limit: 12,
    })
    expect(result.success).toBe(true)
  })

  it('rejects a non-positive page number', () => {
    const result = ProjectListResponseSchema.safeParse({
      items: [],
      total: 0,
      page: 0,
      limit: 12,
    })
    expect(result.success).toBe(false)
  })

  it('rejects a non-positive limit', () => {
    const result = ProjectListResponseSchema.safeParse({
      items: [],
      total: 0,
      page: 1,
      limit: 0,
    })
    expect(result.success).toBe(false)
  })

  it('rejects a negative total', () => {
    const result = ProjectListResponseSchema.safeParse({
      items: [],
      total: -1,
      page: 1,
      limit: 12,
    })
    expect(result.success).toBe(false)
  })
})
