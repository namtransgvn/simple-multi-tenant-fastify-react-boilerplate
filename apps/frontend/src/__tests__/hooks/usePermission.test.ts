import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePermission } from '@/hooks/usePermission'
import { useAuthStore } from '@/stores/authStore'
import type { JwtPayload } from '@repo/shared'

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return { ...actual, useNavigate: vi.fn(() => vi.fn()) }
})

const MOCK_USER: JwtPayload = {
  userId: '00000000-0000-0000-0000-000000000001',
  tenantId: '00000000-0000-0000-0000-000000000002',
  roles: ['user'],
  permissions: ['project:read', 'chat:use'],
  iat: 1000000,
  exp: 9999999999,
}

describe('usePermission', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: MOCK_USER, accessToken: 'token', isAuthenticated: true })
  })

  it('returns true when permission is in user.permissions', () => {
    const { result } = renderHook(() => usePermission('project:read'))
    expect(result.current).toBe(true)
  })

  it('returns false when permission is missing', () => {
    const { result } = renderHook(() => usePermission('admin:manage'))
    expect(result.current).toBe(false)
  })

  it('returns false when user is null', () => {
    useAuthStore.setState({ user: null, accessToken: null, isAuthenticated: false })

    const { result } = renderHook(() => usePermission('project:read'))
    expect(result.current).toBe(false)
  })
})
