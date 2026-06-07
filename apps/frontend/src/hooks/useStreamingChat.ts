import { useCallback, useEffect, useRef } from 'react'
import { streamChat } from '@/lib/api'
import { useChatStore } from '@/stores/chatStore'
import { useProjectStore } from '@/stores/projectStore'

export function useStreamingChat() {
  const abortRef = useRef<AbortController | null>(null)
  const currentMsgIdRef = useRef<string | null>(null)

  const isStreaming = useChatStore((s) => s.isStreaming)
  const streamError = useChatStore((s) => s.streamError)
  const projectId = useProjectStore((s) => s.selectedProjectId)
  const provider = useChatStore((s) => s.selectedProvider)
  const model = useChatStore((s) => s.selectedModel)

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const sendMessage = useCallback(
    async (content: string) => {
      if (!projectId || !provider || !model) return

      // Abort any in-flight stream and finalize the placeholder message
      abortRef.current?.abort()
      if (currentMsgIdRef.current) {
        useChatStore.getState().finalizeMessage(currentMsgIdRef.current)
        currentMsgIdRef.current = null
      }

      const controller = new AbortController()
      abortRef.current = controller

      useChatStore.getState().clearError()
      useChatStore.getState().addUserMessage(content)

      // Snapshot messages for the API call before the assistant placeholder is added
      const apiMessages = useChatStore
        .getState()
        .messages.map(({ role, content: c }) => ({ role, content: c }))

      const msgId = useChatStore.getState().startAssistantMessage()
      currentMsgIdRef.current = msgId

      try {
        for await (const chunk of streamChat(
          { projectId, messages: apiMessages, provider, model },
          controller.signal,
        )) {
          if (chunk.delta) useChatStore.getState().appendDelta(msgId, chunk.delta)
          if (chunk.error) {
            useChatStore.getState().setStreamError(chunk.error)
            currentMsgIdRef.current = null
            return
          }
        }
        if (!controller.signal.aborted) {
          useChatStore.getState().finalizeMessage(msgId)
        }
      } catch (err) {
        if ((err as DOMException).name === 'AbortError') return
        useChatStore
          .getState()
          .setStreamError(err instanceof Error ? err.message : 'Stream failed')
      } finally {
        if (!controller.signal.aborted) currentMsgIdRef.current = null
      }
    },
    [projectId, provider, model],
  )

  const retry = useCallback(() => {
    const msgs = useChatStore.getState().messages
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user')
    if (lastUser) void sendMessage(lastUser.content)
  }, [sendMessage])

  const canSend = !!projectId && !!provider && !!model

  return { sendMessage, isStreaming, canSend, error: streamError, retry }
}
