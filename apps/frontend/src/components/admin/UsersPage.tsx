import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Permission } from '@repo/shared'
import type { UserRolesResponse, RoleResponse } from '@repo/shared'
import { AdminLayout } from './shared/AdminLayout'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useRequirePermission } from '@/hooks/usePermission'
import { useAuthStore } from '@/stores/authStore'

export function UsersPage() {
  useRequirePermission(Permission.ADMIN_MANAGE)

  const queryClient = useQueryClient()
  const userId = useAuthStore((s) => s.user?.userId)
  const [addingRoleId, setAddingRoleId] = useState('')

  const { data: rolesData } = useQuery({
    queryKey: ['admin', 'roles'],
    queryFn: () => api.get<{ items: RoleResponse[] }>('/api/admin/roles'),
    enabled: !!userId,
  })

  const { data: userRoles, isLoading } = useQuery({
    queryKey: ['admin', 'users', userId, 'roles'],
    queryFn: () => api.get<UserRolesResponse>(`/api/admin/users/${userId}/roles`),
    enabled: !!userId,
  })

  const assignMutation = useMutation({
    mutationFn: (roleId: string) =>
      api.post(`/api/admin/users/${userId}/roles`, { roleId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users', userId, 'roles'] })
      setAddingRoleId('')
    },
  })

  const revokeMutation = useMutation({
    mutationFn: (roleId: string) =>
      api.delete(`/api/admin/users/${userId}/roles/${roleId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users', userId, 'roles'] })
    },
  })

  const directRoleIds = new Set(userRoles?.direct.map((r) => r.id) ?? [])
  const fromGroupIds = new Set(userRoles?.fromGroups.map((r) => r.id) ?? [])
  const availableToAdd =
    rolesData?.items.filter((r) => !directRoleIds.has(r.id) && !fromGroupIds.has(r.id)) ?? []

  return (
    <AdminLayout>
      <div className="p-6 space-y-6 max-w-xl">
        <h2 className="text-base font-medium">My Roles</h2>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <>
            <section className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">Direct roles</h3>
              {userRoles?.direct.length === 0 ? (
                <p className="text-sm text-muted-foreground">No direct roles assigned.</p>
              ) : (
                <div className="space-y-1">
                  {userRoles?.direct.map((role) => (
                    <div
                      key={role.id}
                      className="flex items-center justify-between p-2 rounded-md border border-border"
                    >
                      <div>
                        <span className="text-sm font-medium">{role.name}</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {role.permissions.slice(0, 3).map((p) => (
                            <Badge key={p} variant="outline">
                              {p}
                            </Badge>
                          ))}
                          {role.permissions.length > 3 && (
                            <Badge variant="secondary">+{role.permissions.length - 3}</Badge>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:bg-destructive/10"
                        onClick={() => revokeMutation.mutate(role.id)}
                        disabled={revokeMutation.isPending}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {availableToAdd.length > 0 && (
                <div className="flex items-center gap-2 mt-2">
                  <select
                    value={addingRoleId}
                    onChange={(e) => setAddingRoleId(e.target.value)}
                    className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Select a role to add…</option>
                    {availableToAdd.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    disabled={!addingRoleId || assignMutation.isPending}
                    onClick={() => addingRoleId && assignMutation.mutate(addingRoleId)}
                  >
                    Assign
                  </Button>
                </div>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">Via groups</h3>
              {userRoles?.fromGroups.length === 0 ? (
                <p className="text-sm text-muted-foreground">No group-inherited roles.</p>
              ) : (
                <div className="space-y-1">
                  {userRoles?.fromGroups.map((role) => (
                    <div
                      key={role.id}
                      className="flex items-center justify-between p-2 rounded-md border border-border bg-muted/20"
                    >
                      <div>
                        <span className="text-sm font-medium">{role.name}</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {role.permissions.slice(0, 3).map((p) => (
                            <Badge key={p} variant="outline">
                              {p}
                            </Badge>
                          ))}
                          {role.permissions.length > 3 && (
                            <Badge variant="secondary">+{role.permissions.length - 3}</Badge>
                          )}
                        </div>
                      </div>
                      <Badge variant="secondary">via group</Badge>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </AdminLayout>
  )
}
