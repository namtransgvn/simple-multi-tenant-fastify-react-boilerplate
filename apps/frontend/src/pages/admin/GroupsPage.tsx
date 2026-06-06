import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { GroupResponse } from '@repo/shared'

export function GroupsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'groups'],
    queryFn: () => api.get<{ items: GroupResponse[] }>('/api/admin/groups'),
  })

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">Groups</h1>
      {isLoading ? (
        <div className="h-32 rounded-md bg-muted animate-pulse" />
      ) : (
        <div className="space-y-2">
          {data?.items.map((group) => (
            <div
              key={group.id}
              className="p-4 border border-border rounded-md font-medium"
            >
              {group.name}
            </div>
          ))}
          {data?.items.length === 0 && (
            <p className="text-sm text-muted-foreground">No groups yet.</p>
          )}
        </div>
      )}
    </div>
  )
}
