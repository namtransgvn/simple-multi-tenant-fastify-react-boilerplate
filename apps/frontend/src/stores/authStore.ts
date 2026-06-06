import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { JwtPayload } from '@repo/shared'

const BASE_URL = import.meta.env.VITE_API_BASE_URL

function decodeJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = parts[1]
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    return JSON.parse(atob(padded)) as JwtPayload
  } catch {
    return null
  }
}

interface AuthState {
  accessToken: string | null
  user: JwtPayload | null
  isAuthenticated: boolean
  setToken: (token: string) => void
  logout: () => void
  silentRefresh: () => Promise<boolean>
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      user: null,
      isAuthenticated: false,

      setToken(token) {
        const user = decodeJwt(token)
        set({ accessToken: token, user, isAuthenticated: user !== null })
      },

      logout() {
        set({ accessToken: null, user: null, isAuthenticated: false })
        window.location.href = '/login'
      },

      async silentRefresh() {
        try {
          const response = await fetch(`${BASE_URL}/auth/refresh`, {
            method: 'POST',
            credentials: 'include',
          })
          if (!response.ok) return false
          const data = (await response.json()) as { accessToken: string }
          get().setToken(data.accessToken)
          return true
        } catch {
          return false
        }
      },
    }),
    {
      name: 'auth-session',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ accessToken: state.accessToken }),
      onRehydrateStorage: () => (rehydratedState) => {
        if (rehydratedState?.accessToken) {
          rehydratedState.setToken(rehydratedState.accessToken)
        }
      },
    },
  ),
)
