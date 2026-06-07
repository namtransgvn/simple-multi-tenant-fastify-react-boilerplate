import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { TenantAiProviderResponse } from '@repo/shared'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AlertDialog } from '@/components/ui/alert-dialog'
import { AiProviderModal } from './AiProviderModal'

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
}

interface AiProviderCardProps {
  providerType: string
  config: TenantAiProviderResponse | null
}

export function AiProviderCard({ providerType, config }: AiProviderCardProps) {
  const queryClient = useQueryClient()
  const [modalOpen, setModalOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const toggleMutation = useMutation({
    mutationFn: () =>
      api.patch(`/api/admin/ai-providers/${providerType}`, { enabled: !config?.enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'ai-providers'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/api/admin/ai-providers/${providerType}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'ai-providers'] })
      queryClient.invalidateQueries({ queryKey: ['providers'] })
      setConfirmDelete(false)
    },
  })

  const label = PROVIDER_LABELS[providerType] ?? providerType

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <h3 className="text-base font-semibold">{label}</h3>
          {config ? (
            <Badge className="bg-green-100 text-green-800 border-green-200">Configured</Badge>
          ) : (
            <Badge variant="secondary">Not configured</Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {config ? (
            <>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  role="switch"
                  aria-checked={config.enabled}
                  onClick={() => toggleMutation.mutate()}
                  disabled={toggleMutation.isPending}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
                    config.enabled ? 'bg-primary' : 'bg-muted-foreground/30'
                  }`}
                >
                  <span
                    className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                      config.enabled ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>
                <span className="text-sm text-muted-foreground">
                  {config.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Allowed models</p>
                {config.allowedModels.length === 0 ? (
                  <span className="text-sm text-muted-foreground">All models</span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {config.allowedModels.map((m) => (
                      <Badge key={m} variant="outline" className="text-xs">
                        {m}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={() => setModalOpen(true)}>
                  Edit key
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:bg-destructive hover:text-destructive-foreground"
                  onClick={() => setConfirmDelete(true)}
                >
                  Remove
                </Button>
              </div>
            </>
          ) : (
            <Button size="sm" onClick={() => setModalOpen(true)}>
              Add API key
            </Button>
          )}
        </CardContent>
      </Card>

      <AiProviderModal
        providerType={providerType}
        existing={config}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      />

      <AlertDialog
        open={confirmDelete}
        title="Remove provider"
        description={`Are you sure you want to remove the ${label} API key? This cannot be undone.`}
        confirmLabel="Remove"
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  )
}
