import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/authStore'
import type { SsoProvidersResponse } from '@repo/shared'

export function LoginPage() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  const { data, isLoading } = useQuery({
    queryKey: ['sso-providers'],
    queryFn: () => api.get<SsoProvidersResponse>('/api/providers/sso'),
    enabled: !isAuthenticated,
  })

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6 p-8 border border-border rounded-lg">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold">Sign in</h1>
          <p className="text-sm text-muted-foreground">
            Choose your identity provider to continue
          </p>
        </div>
        <div className="space-y-3">
          {isLoading && (
            <div className="h-10 rounded-md bg-muted animate-pulse" />
          )}
          {data?.providers.map((provider) => (
            <a
              key={provider.providerType}
              href={provider.authorizationUrl}
              className="flex items-center justify-center w-full h-10 px-4 border border-border rounded-md text-sm font-medium hover:bg-accent transition-colors"
            >
              Sign in with {provider.name}
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}
