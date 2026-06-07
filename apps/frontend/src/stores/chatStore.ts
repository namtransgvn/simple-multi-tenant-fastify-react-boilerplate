import { create } from 'zustand'
import type { AiProvider } from '@repo/shared'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
}

interface ChatState {
  messages: ChatMessage[]
  isStreaming: boolean
  streamError: string | null
  selectedProvider: AiProvider
  selectedModel: string
  sessionId: string
  addUserMessage: (content: string) => void
  startAssistantMessage: () => string
  appendDelta: (id: string, delta: string) => void
  finalizeMessage: (id: string) => void
  setStreamError: (err: string) => void
  clearError: () => void
  newSession: () => void
  setProvider: (provider: AiProvider) => void
  setModel: (model: string) => void
}

export const useChatStore = create<ChatState>()((set) => ({
  messages: [],
  isStreaming: false,
  streamError: null,
  selectedProvider: 'anthropic',
  selectedModel: '',
  sessionId: crypto.randomUUID(),

  addUserMessage(content) {
    set((state) => ({
      messages: [...state.messages, { id: crypto.randomUUID(), role: 'user', content }],
    }))
  },

  startAssistantMessage() {
    const id = crypto.randomUUID()
    set((state) => ({
      messages: [
        ...state.messages,
        { id, role: 'assistant', content: '', isStreaming: true },
      ],
      isStreaming: true,
    }))
    return id
  },

  appendDelta(id, delta) {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, content: m.content + delta } : m,
      ),
    }))
  },

  finalizeMessage(id) {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, isStreaming: false } : m,
      ),
      isStreaming: false,
    }))
  },

  setStreamError(err) {
    set((state) => ({
      streamError: err,
      isStreaming: false,
      messages: state.messages.map((m) =>
        m.isStreaming ? { ...m, isStreaming: false } : m,
      ),
    }))
  },

  clearError: () => set({ streamError: null }),

  newSession: () =>
    set({ messages: [], isStreaming: false, streamError: null, sessionId: crypto.randomUUID() }),

  setProvider: (provider) => set({ selectedProvider: provider }),

  setModel: (model) => set({ selectedModel: model }),
}))
