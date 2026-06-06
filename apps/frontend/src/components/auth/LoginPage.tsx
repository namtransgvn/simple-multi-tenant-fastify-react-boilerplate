import { useQuery } from '@tanstack/react-query'
import type { SsoProvidersResponse } from '@repo/shared'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { SsoButton } from './SsoButton'

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

async function fetchSsoProviders(): Promise<SsoProvidersResponse> {
  const res = await fetch(`${BASE_URL}/api/providers/sso`)
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json() as Promise<SsoProvidersResponse>
}

export function LoginPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['sso-providers'],
    queryFn: fetchSsoProviders,
    retry: false,
  })

  const providers = data?.providers ?? []

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

        <CardContent className="space-y-3">
          {isLoading && (
            <>
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </>
          )}

          {isError && (
            <Alert variant="destructive">
              <AlertDescription>
                Failed to load sign-in options. Please refresh and try again.
              </AlertDescription>
            </Alert>
          )}

          {!isLoading && !isError && providers.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No login providers configured.
            </p>
          )}

          {providers.map((provider, i) => (
            <SsoButton key={provider.providerType ?? String(i)} provider={provider} />
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
