import { Fragment, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Permission } from '@repo/shared'
import type { GroupResponse } from '@repo/shared'
import { AdminLayout } from './shared/AdminLayout'
import { GroupModal } from './GroupModal'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AlertDialog } from '@/components/ui/alert-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useRequirePermission } from '@/hooks/usePermission'

interface GroupMember {
  id: string
  displayName: string
  email: string
}

function GroupMembersRow({ groupId }: { groupId: string }) {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'groups', groupId, 'members'],
    queryFn: () => api.get<GroupMember[]>(`/api/admin/groups/${groupId}/members`),
  })

  const removeMutation = useMutation({
    mutationFn: (userId: string) =>
      api.delete(`/api/admin/groups/${groupId}/members/${userId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'groups', groupId, 'members'] })
    },
  })

  return (
    <tr className="bg-muted/20">
      <td colSpan={3} className="px-8 py-3">
        {isLoading ? (
          <Skeleton className="h-8 w-48" />
        ) : data?.length === 0 ? (
          <p className="text-sm text-muted-foreground">No members in this group.</p>
        ) : (
          <div className="space-y-1">
            {data?.map((member) => (
              <div key={member.id} className="flex items-center justify-between text-sm">
                <span>
                  {member.displayName}{' '}
                  <span className="text-muted-foreground">({member.email})</span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs text-destructive hover:bg-destructive/10"
                  onClick={() => removeMutation.mutate(member.id)}
                  disabled={removeMutation.isPending}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
      </td>
    </tr>
  )
}

export function GroupsPage() {
  useRequirePermission(Permission.ADMIN_MANAGE)

  const queryClient = useQueryClient()
  const [modalOpen, setModalOpen] = useState(false)
  const [deletingGroup, setDeletingGroup] = useState<GroupResponse | null>(null)
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'groups'],
    queryFn: () => api.get<GroupResponse[]>('/api/admin/groups'),
  })

  const deleteMutation = useMutation({
    mutationFn: (groupId: string) => api.delete(`/api/admin/groups/${groupId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'groups'] })
      setDeletingGroup(null)
    },
  })

  function toggleExpand(groupId: string) {
    setExpandedGroupId((prev) => (prev === groupId ? null : groupId))
  }

  return (
    <AdminLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-medium">Groups</h2>
          <Button size="sm" onClick={() => setModalOpen(true)}>
            New group
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
                  <th className="text-left px-4 py-2 font-medium">Roles</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {data?.length === 0 && (
                  <tr>
                    <td
                      colSpan={3}
                      className="px-4 py-6 text-center text-sm text-muted-foreground"
                    >
                      No groups yet.
                    </td>
                  </tr>
                )}
                {data?.map((group) => (
                  <Fragment key={group.id}>
                    <tr
                      className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer"
                      onClick={() => toggleExpand(group.id)}
                    >
                      <td className="px-4 py-3 font-medium">
                        <span className="mr-2 text-muted-foreground text-xs">
                          {expandedGroupId === group.id ? '▾' : '▸'}
                        </span>
                        {group.name}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {group.roles.slice(0, 3).map((r) => (
                            <Badge key={r.id} variant="outline">
                              {r.name}
                            </Badge>
                          ))}
                          {group.roles.length > 3 && (
                            <Badge variant="secondary">+{group.roles.length - 3} more</Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div
                          className="flex justify-end"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive hover:bg-destructive hover:text-destructive-foreground"
                            onClick={() => setDeletingGroup(group)}
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {expandedGroupId === group.id && (
                      <GroupMembersRow groupId={group.id} />
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <GroupModal open={modalOpen} onClose={() => setModalOpen(false)} />

      <AlertDialog
        open={deletingGroup != null}
        title="Delete group"
        description={`Are you sure you want to delete "${deletingGroup?.name}"?`}
        confirmLabel="Delete"
        onConfirm={() => deletingGroup && deleteMutation.mutate(deletingGroup.id)}
        onCancel={() => setDeletingGroup(null)}
      />
    </AdminLayout>
  )
}
