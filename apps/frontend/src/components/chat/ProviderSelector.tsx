import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useChatStore } from '@/stores/chatStore'
import type { ProvidersResponse, AiProvider } from '@repo/shared'

export function ProviderSelector() {
  const isStreaming = useChatStore((s) => s.isStreaming)
  const selectedProvider = useChatStore((s) => s.selectedProvider)
  const selectedModel = useChatStore((s) => s.selectedModel)
  const setProvider = useChatStore((s) => s.setProvider)
  const setModel = useChatStore((s) => s.setModel)

  const { data } = useQuery({
    queryKey: ['providers'],
    queryFn: () => api.get<ProvidersResponse>('/api/providers'),
  })

  const providers = data?.providers ?? []
  const currentInfo = providers.find((p) => p.provider === selectedProvider)
  const models = currentInfo?.models ?? []

  useEffect(() => {
    if (providers.length === 0) return

    if (!currentInfo && providers[0]) {
      setProvider(providers[0].provider as AiProvider)
      setModel(providers[0].models[0] ?? '')
      return
    }

    if (models.length > 0 && !models.includes(selectedModel)) {
      setModel(models[0])
    }
  }, [providers, currentInfo, models, selectedModel, setProvider, setModel])

  if (providers.length === 0) return null

  const selectClass =
    'h-8 rounded-md border border-input bg-background px-2 text-xs ' +
    'focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 cursor-pointer'

  return (
    <div className="flex items-center gap-2">
      <select
        value={selectedProvider}
        disabled={isStreaming}
        onChange={(e) => {
          const p = e.target.value as AiProvider
          setProvider(p)
          const info = providers.find((x) => x.provider === p)
          setModel(info?.models[0] ?? '')
        }}
        className={selectClass}
      >
        {providers.map((p) => (
          <option key={p.provider} value={p.provider}>
            {p.provider}
          </option>
        ))}
      </select>

      <select
        value={selectedModel}
        disabled={isStreaming || models.length === 0}
        onChange={(e) => setModel(e.target.value)}
        className={`${selectClass} max-w-[180px]`}
      >
        {models.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </div>
  )
}
