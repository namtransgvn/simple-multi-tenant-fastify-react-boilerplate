import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/authStore'
import type { Permission } from '@repo/shared'

export function usePermission(permission: Permission): boolean {
  const user = useAuthStore((s) => s.user)
  return user?.permissions.includes(permission) ?? false
}

export function useRequirePermission(permission: Permission): void {
  const hasPermission = usePermission(permission)
  const navigate = useNavigate()

  useEffect(() => {
    if (!hasPermission) {
      navigate({ to: '/projects' }).catch(() => {})
    }
  }, [hasPermission, navigate])
}
