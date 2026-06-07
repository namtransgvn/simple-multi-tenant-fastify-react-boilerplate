import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useAuthStore } from '@/stores/authStore'

function base64url(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function makeMockJwt(payload: object): string {
  return `mock-header.${base64url(JSON.stringify(payload))}.mock-sig`
}

const MOCK_PAYLOAD = {
  userId: '00000000-0000-0000-0000-000000000001',
  tenantId: '00000000-0000-0000-0000-000000000002',
  roles: ['user'],
  permissions: ['project:read', 'chat:use'],
  iat: 1000000,
  exp: 9999999999,
}

describe('authStore', () => {
  beforeEach(() => {
    useAuthStore.setState({ accessToken: null, user: null, isAuthenticated: false })
    sessionStorage.clear()
    vi.stubGlobal('location', { href: 'http://localhost/' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('setToken decodes JWT and sets user', () => {
    const token = makeMockJwt(MOCK_PAYLOAD)
    useAuthStore.getState().setToken(token)

    const { accessToken, user, isAuthenticated } = useAuthStore.getState()
    expect(accessToken).toBe(token)
    expect(user).toMatchObject({
      userId: MOCK_PAYLOAD.userId,
      tenantId: MOCK_PAYLOAD.tenantId,
      roles: MOCK_PAYLOAD.roles,
      permissions: MOCK_PAYLOAD.permissions,
    })
    expect(isAuthenticated).toBe(true)
  })

  it('logout clears token and user', () => {
    useAuthStore.getState().setToken(makeMockJwt(MOCK_PAYLOAD))
    expect(useAuthStore.getState().isAuthenticated).toBe(true)

    useAuthStore.getState().logout()

    const { accessToken, user, isAuthenticated } = useAuthStore.getState()
    expect(accessToken).toBeNull()
    expect(user).toBeNull()
    expect(isAuthenticated).toBe(false)
  })

  it('isAuthenticated is true when token is present', () => {
    expect(useAuthStore.getState().isAuthenticated).toBe(false)

    useAuthStore.getState().setToken(makeMockJwt(MOCK_PAYLOAD))

    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  it('setToken with malformed JWT sets isAuthenticated to false', () => {
    useAuthStore.getState().setToken('not-a-valid-jwt')

    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(useAuthStore.getState().user).toBeNull()
  })
})
