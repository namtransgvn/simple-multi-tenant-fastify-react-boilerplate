import { create } from 'zustand'
import type { TenantResponse } from '@repo/shared'

interface TenantState {
  tenant: TenantResponse | null
  setTenant: (t: TenantResponse) => void
}

export const useTenantStore = create<TenantState>()((set) => ({
  tenant: null,
  setTenant: (t) => set({ tenant: t }),
}))
