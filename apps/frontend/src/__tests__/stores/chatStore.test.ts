import { describe, it, expect, beforeEach } from 'vitest'
import { useChatStore } from '@/stores/chatStore'

describe('chatStore', () => {
  beforeEach(() => {
    useChatStore.setState({
      messages: [],
      isStreaming: false,
      streamError: null,
      sessionId: 'test-session-id',
      selectedProvider: 'anthropic',
      selectedModel: '',
    })
  })

  it('addUserMessage appends to messages', () => {
    useChatStore.getState().addUserMessage('Hello there')

    const { messages } = useChatStore.getState()
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ role: 'user', content: 'Hello there' })
    expect(messages[0].id).toBeTruthy()
  })

  it('startAssistantMessage + appendDelta builds streaming message', () => {
    const msgId = useChatStore.getState().startAssistantMessage()

    expect(useChatStore.getState().isStreaming).toBe(true)
    expect(useChatStore.getState().messages).toHaveLength(1)
    expect(useChatStore.getState().messages[0]).toMatchObject({
      id: msgId,
      role: 'assistant',
      content: '',
      isStreaming: true,
    })

    useChatStore.getState().appendDelta(msgId, 'Hello')
    useChatStore.getState().appendDelta(msgId, ' World')

    expect(useChatStore.getState().messages[0].content).toBe('Hello World')
  })

  it('finalizeMessage clears isStreaming on that message', () => {
    const msgId = useChatStore.getState().startAssistantMessage()
    useChatStore.getState().appendDelta(msgId, 'Done')

    useChatStore.getState().finalizeMessage(msgId)

    const { messages, isStreaming } = useChatStore.getState()
    expect(isStreaming).toBe(false)
    expect(messages[0].isStreaming).toBe(false)
    expect(messages[0].content).toBe('Done')
  })

  it('newSession resets messages and generates new sessionId', () => {
    useChatStore.getState().addUserMessage('Old message')
    const oldSessionId = useChatStore.getState().sessionId

    useChatStore.getState().newSession()

    const { messages, isStreaming, streamError, sessionId } = useChatStore.getState()
    expect(messages).toHaveLength(0)
    expect(isStreaming).toBe(false)
    expect(streamError).toBeNull()
    expect(sessionId).not.toBe(oldSessionId)
    expect(sessionId).toBeTruthy()
  })
})
