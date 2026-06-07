import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Permission } from '@repo/shared'
import type { RoleResponse } from '@repo/shared'
import { AdminLayout } from './shared/AdminLayout'
import { RoleModal } from './RoleModal'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AlertDialog } from '@/components/ui/alert-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useRequirePermission } from '@/hooks/usePermission'

export function RolesPage() {
  useRequirePermission(Permission.ADMIN_MANAGE)

  const queryClient = useQueryClient()
  const [modalOpen, setModalOpen] = useState(false)
  const [editingRole, setEditingRole] = useState<RoleResponse | null>(null)
  const [deletingRole, setDeletingRole] = useState<RoleResponse | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'roles'],
    queryFn: () => api.get<{ items: RoleResponse[] }>('/api/admin/roles'),
  })

  const deleteMutation = useMutation({
    mutationFn: (roleId: string) => api.delete(`/api/admin/roles/${roleId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'roles'] })
      setDeletingRole(null)
    },
  })

  function openCreate() {
    setEditingRole(null)
    setModalOpen(true)
  }

  function openEdit(role: RoleResponse) {
    setEditingRole(role)
    setModalOpen(true)
  }

  return (
    <AdminLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-medium">Roles</h2>
          <Button size="sm" onClick={openCreate}>
            New role
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((n) => (
              <Skeleton key={n} className="h-14 w-full" />
            ))}
          </div>
        ) : (
          <div className="border border-border rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-2 font-medium">Name</th>
                  <th className="text-left px-4 py-2 font-medium">Permissions</th>
                  <th className="text-left px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {data?.items.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-sm text-muted-foreground">
                      No roles yet.
                    </td>
                  </tr>
                )}
                {data?.items.map((role) => (
                  <tr
                    key={role.id}
                    className="border-b border-border last:border-0 hover:bg-muted/30"
                  >
                    <td className="px-4 py-3 font-medium">{role.name}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {role.permissions.slice(0, 3).map((p) => (
                          <Badge key={p} variant="outline">
                            {p}
                          </Badge>
                        ))}
                        {role.permissions.length > 3 && (
                          <Badge variant="secondary">+{role.permissions.length - 3} more</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {role.isBuiltin && <Badge variant="secondary">Built-in</Badge>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={role.isBuiltin}
                          onClick={() => openEdit(role)}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={role.isBuiltin}
                          className="text-destructive hover:bg-destructive hover:text-destructive-foreground"
                          onClick={() => setDeletingRole(role)}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <RoleModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        role={editingRole}
      />

      <AlertDialog
        open={deletingRole != null}
        title="Delete role"
        description={`Are you sure you want to delete "${deletingRole?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={() => deletingRole && deleteMutation.mutate(deletingRole.id)}
        onCancel={() => setDeletingRole(null)}
      />
    </AdminLayout>
  )
}
