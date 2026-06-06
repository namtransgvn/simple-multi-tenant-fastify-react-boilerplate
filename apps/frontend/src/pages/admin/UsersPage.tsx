import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

interface UserItem {
  id: string
  displayName: string
  email: string
}

export function UsersPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => api.get<{ items: UserItem[] }>('/api/admin/users'),
  })

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">Users</h1>
      {isLoading ? (
        <div className="h-32 rounded-md bg-muted animate-pulse" />
      ) : (
        <div className="space-y-2">
          {data?.items.map((user) => (
            <div
              key={user.id}
              className="flex items-center justify-between p-4 border border-border rounded-md"
            >
              <div>
                <div className="font-medium">{user.displayName}</div>
                <div className="text-sm text-muted-foreground">{user.email}</div>
              </div>
            </div>
          ))}
          {data?.items.length === 0 && (
            <p className="text-sm text-muted-foreground">No users yet.</p>
          )}
        </div>
      )}
    </div>
  )
}
