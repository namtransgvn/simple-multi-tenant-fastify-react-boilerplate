import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { TenantAiProviderResponse } from '@repo/shared'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogContent,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'

const PROVIDER_MODELS: Record<string, string[]> = {
  anthropic: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  gemini: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-pro'],
}

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
}

interface AiProviderModalProps {
  providerType: string
  existing: TenantAiProviderResponse | null
  open: boolean
  onClose: () => void
}

export function AiProviderModal({ providerType, existing, open, onClose }: AiProviderModalProps) {
  const queryClient = useQueryClient()
  const isEdit = existing != null
  const [apiKey, setApiKey] = useState('')
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set())

  const models = PROVIDER_MODELS[providerType] ?? []
  const label = PROVIDER_LABELS[providerType] ?? providerType

  useEffect(() => {
    if (open) {
      setApiKey('')
      setSelectedModels(new Set(existing?.allowedModels ?? []))
    }
  }, [open, existing])

  const mutation = useMutation({
    mutationFn: () => {
      const allowedModels = Array.from(selectedModels)
      if (isEdit) {
        const body: Record<string, unknown> = { allowedModels }
        if (apiKey.trim()) body.apiKey = apiKey.trim()
        return api.put(`/api/admin/ai-providers/${providerType}`, body)
      }
      return api.post('/api/admin/ai-providers', {
        providerType,
        apiKey: apiKey.trim(),
        allowedModels,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'ai-providers'] })
      queryClient.invalidateQueries({ queryKey: ['providers'] })
      onClose()
    },
  })

  function toggleModel(model: string) {
    setSelectedModels((prev) => {
      const next = new Set(prev)
      if (next.has(model)) next.delete(model)
      else next.add(model)
      return next
    })
  }

  const canSubmit = !mutation.isPending && (isEdit || apiKey.trim().length > 0)

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>{isEdit ? `Edit ${label} API Key` : `Add ${label} API Key`}</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <Alert>
            <AlertDescription>
              Your API key is encrypted before storage and is never returned by the API.
            </AlertDescription>
          </Alert>
          <div>
            <label className="block text-sm font-medium mb-1">API key</label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={isEdit ? 'Leave blank to keep existing key' : 'Enter API key'}
            />
          </div>
          {models.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-1">Allowed models</label>
              <p className="text-xs text-muted-foreground mb-2">
                Leave all unchecked to allow all models.
              </p>
              <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto pr-1">
                {models.map((model) => (
                  <label key={model} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedModels.has(model)}
                      onChange={() => toggleModel(model)}
                      className="rounded border-border"
                    />
                    {model}
                  </label>
                ))}
              </div>
            </div>
          )}
          {mutation.error && (
            <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>
          )}
        </div>
      </DialogContent>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => mutation.mutate()} disabled={!canSubmit}>
          {mutation.isPending ? 'Saving…' : 'Save'}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
