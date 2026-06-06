import { useAuthStore } from '@/stores/authStore'
import type { Permission } from '@repo/shared'

export function usePermission(permission: Permission): boolean {
  const user = useAuthStore((s) => s.user)
  return user?.permissions.includes(permission) ?? false
}
