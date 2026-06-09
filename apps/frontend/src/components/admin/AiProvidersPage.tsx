import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Permission, AI_PROVIDERS } from '@repo/shared'
import type { TenantAiProviderResponse } from '@repo/shared'
import { useAuthStore } from '@/stores/authStore'
import { AdminLayout } from './shared/AdminLayout'
import { AiProviderCard } from './AiProviderCard'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useRequirePermission } from '@/hooks/usePermission'

export function AiProvidersPage() {
  useRequirePermission(Permission.ADMIN_MANAGE)

  const tenantId = useAuthStore((s) => s.user?.tenantId)

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'ai-providers', tenantId],
    queryFn: () => api.get<TenantAiProviderResponse[]>('/api/admin/ai-providers'),
    enabled: !!tenantId,
  })

  function getConfig(providerType: string): TenantAiProviderResponse | null {
    return data?.find((item) => item.providerType === providerType) ?? null
  }

  return (
    <AdminLayout>
      <div className="p-6 space-y-4">
        <div>
          <h2 className="text-base font-medium">AI Providers</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Configure API keys for each provider your team will use. Keys are encrypted and stored
            securely.
          </p>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[1, 2, 3].map((n) => (
              <Skeleton key={n} className="h-48 w-full" />
            ))}
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertDescription>{(error as Error).message}</AlertDescription>
          </Alert>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {AI_PROVIDERS.map((providerType) => (
              <AiProviderCard
                key={providerType}
                providerType={providerType}
                config={getConfig(providerType)}
              />
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
