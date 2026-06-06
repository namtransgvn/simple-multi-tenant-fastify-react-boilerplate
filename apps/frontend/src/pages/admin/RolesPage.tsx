import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { RoleResponse } from '@repo/shared'

export function RolesPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'roles'],
    queryFn: () => api.get<{ items: RoleResponse[] }>('/api/admin/roles'),
  })

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">Roles</h1>
      {isLoading ? (
        <div className="h-32 rounded-md bg-muted animate-pulse" />
      ) : (
        <div className="space-y-2">
          {data?.items.map((role) => (
            <div
              key={role.id}
              className="flex items-center justify-between p-4 border border-border rounded-md"
            >
              <div>
                <div className="font-medium">{role.name}</div>
                <div className="text-sm text-muted-foreground">
                  {role.permissions.join(', ')}
                </div>
              </div>
              {role.isBuiltin && (
                <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">
                  Built-in
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
