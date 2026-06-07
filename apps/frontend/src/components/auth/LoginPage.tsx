import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { SsoProvidersResponse, PublicTenantsResponse } from '@repo/shared'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { SsoButton } from './SsoButton'

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

async function fetchPublicTenants(): Promise<PublicTenantsResponse> {
  const res = await fetch(`${BASE_URL}/auth/tenants`)
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json() as Promise<PublicTenantsResponse>
}

async function fetchSsoProviders(tenantId: string): Promise<SsoProvidersResponse> {
  const res = await fetch(`${BASE_URL}/auth/sso?tenantId=${encodeURIComponent(tenantId)}`)
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json() as Promise<SsoProvidersResponse>
}

export function LoginPage() {
  const [selectedTenantId, setSelectedTenantId] = useState<string | undefined>(undefined)

  const {
    data: tenantsData,
    isLoading: tenantsLoading,
    isError: tenantsError,
  } = useQuery({
    queryKey: ['public-tenants'],
    queryFn: fetchPublicTenants,
    retry: false,
  })

  const masterTenant = tenantsData?.tenants.find((t) => t.slug === 'master') ?? tenantsData?.tenants[0]
  const effectiveTenantId = selectedTenantId ?? masterTenant?.id
  const selectedTenant = tenantsData?.tenants.find((t) => t.id === effectiveTenantId) ?? masterTenant

  const {
    data: providersData,
    isLoading: providersLoading,
    isError: providersError,
  } = useQuery({
    queryKey: ['sso-providers', effectiveTenantId],
    queryFn: () => fetchSsoProviders(effectiveTenantId!),
    enabled: !!effectiveTenantId,
    retry: false,
  })

  const providers = providersData?.providers ?? []
  const tenants = tenantsData?.tenants ?? []
  const isLoading = tenantsLoading || (!!effectiveTenantId && providersLoading)

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center space-y-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <span className="text-xl font-bold text-primary-foreground">A</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">AI Chat Platform</h1>
          <p className="text-sm text-muted-foreground">Sign in to continue</p>
        </CardHeader>

        <CardContent className="space-y-4">
          {tenantsError && (
            <Alert variant="destructive">
              <AlertDescription>
                Failed to load sign-in options. Please refresh and try again.
              </AlertDescription>
            </Alert>
          )}

          {!tenantsError && tenants.length > 1 && (
            <div className="space-y-1">
              <label htmlFor="tenant-select" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Workspace
              </label>
              <select
                id="tenant-select"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={effectiveTenantId ?? ''}
                onChange={(e) => setSelectedTenantId(e.target.value)}
              >
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {!tenantsError && tenants.length === 1 && selectedTenant && (
            <p className="text-center text-sm text-muted-foreground">
              Workspace: <span className="font-medium text-foreground">{selectedTenant.name}</span>
            </p>
          )}

          {isLoading && (
            <div className="space-y-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          )}

          {!isLoading && providersError && (
            <Alert variant="destructive">
              <AlertDescription>
                Failed to load sign-in methods. Please refresh and try again.
              </AlertDescription>
            </Alert>
          )}

          {!isLoading && !providersError && effectiveTenantId && providers.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No login providers configured for this workspace.
            </p>
          )}

          {!isLoading && !providersError && providers.map((provider, i) => (
            <SsoButton key={provider.providerType ?? String(i)} provider={provider} />
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
