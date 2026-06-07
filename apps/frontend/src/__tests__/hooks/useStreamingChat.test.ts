import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useStreamingChat } from '@/hooks/useStreamingChat'
import { useChatStore } from '@/stores/chatStore'
import { useProjectStore } from '@/stores/projectStore'
import type { ChatStreamChunk } from '@repo/shared'

vi.mock('@/lib/api', () => ({
  streamChat: vi.fn(),
}))

import { streamChat } from '@/lib/api'

describe('useStreamingChat', () => {
  beforeEach(() => {
    useChatStore.setState({
      messages: [],
      isStreaming: false,
      streamError: null,
      sessionId: 'test-session',
      selectedProvider: 'anthropic',
      selectedModel: 'claude-3-5-sonnet-20241022',
    })
    useProjectStore.setState({ selectedProjectId: 'project-uuid-1234' })
    vi.clearAllMocks()
  })

  it('sends user message and streams assistant response', async () => {
    vi.mocked(streamChat).mockImplementation(async function* (): AsyncGenerator<ChatStreamChunk> {
      yield { delta: 'Hello' }
      yield { delta: ' World' }
    })

    const { result } = renderHook(() => useStreamingChat())

    await act(async () => {
      await result.current.sendMessage('Test message')
    })

    await waitFor(() => {
      const messages = useChatStore.getState().messages
      expect(messages).toHaveLength(2)
      expect(messages[0]).toMatchObject({ role: 'user', content: 'Test message' })
      expect(messages[1]).toMatchObject({ role: 'assistant', content: 'Hello World', isStreaming: false })
    })
  })

  it('sets streamError when stream yields an error chunk', async () => {
    vi.mocked(streamChat).mockImplementation(async function* (): AsyncGenerator<ChatStreamChunk> {
      yield { error: 'Provider unavailable' }
    })

    const { result } = renderHook(() => useStreamingChat())

    await act(async () => {
      await result.current.sendMessage('Test message')
    })

    await waitFor(() => {
      expect(useChatStore.getState().streamError).toBe('Provider unavailable')
      expect(useChatStore.getState().isStreaming).toBe(false)
    })
  })

  it('canSend is false when no project is selected', () => {
    useProjectStore.setState({ selectedProjectId: null })

    const { result } = renderHook(() => useStreamingChat())

    expect(result.current.canSend).toBe(false)
  })
})
