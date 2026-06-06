import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── SDK mock ────────────────────────────────────────────────────────────────

const mockCreate = vi.fn()

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}))

import OpenAI from 'openai'
import { OpenAIProvider } from './openai.js'

// ─── helpers ─────────────────────────────────────────────────────────────────

async function* asyncChunks(deltas: (string | null)[]): AsyncIterable<object> {
  for (const d of deltas) {
    yield { choices: [{ delta: { content: d } }] }
  }
}

async function collect(gen: AsyncIterable<string>): Promise<string[]> {
  const chunks: string[] = []
  for await (const c of gen) chunks.push(c)
  return chunks
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('OpenAIProvider', () => {
  const provider = new OpenAIProvider()
  const key = 'sk-openai-test'
  const messages = [{ role: 'user' as const, content: 'Hi' }]
  const system = 'You are a test assistant.'

  beforeEach(() => {
    vi.mocked(OpenAI).mockClear()
    mockCreate.mockClear()
  })

  it('has providerType "openai"', () => {
    expect(provider.providerType).toBe('openai')
  })

  it('declares supported models', () => {
    expect(provider.supportedModels).toEqual(['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'])
  })

  it('yields content deltas from stream chunks', async () => {
    mockCreate.mockResolvedValue(asyncChunks(['Hello', ', ', 'world!']))

    const chunks = await collect(
      provider.streamChat(key, messages, system, 'gpt-4o')
    )

    expect(chunks).toEqual(['Hello', ', ', 'world!'])
  })

  it('skips chunks with null or undefined delta content', async () => {
    mockCreate.mockResolvedValue(asyncChunks([null, 'real', null, ' text', undefined as any]))

    const chunks = await collect(
      provider.streamChat(key, messages, system, 'gpt-4o')
    )

    expect(chunks).toEqual(['real', ' text'])
  })

  it('constructs a new OpenAI client with the provided apiKey', async () => {
    mockCreate.mockResolvedValue(asyncChunks([]))

    await collect(provider.streamChat('my-key', messages, system, 'gpt-4o'))

    expect(OpenAI).toHaveBeenCalledWith({ apiKey: 'my-key' })
  })

  it('prepends a system message before user messages', async () => {
    mockCreate.mockResolvedValue(asyncChunks([]))

    await collect(provider.streamChat(key, messages, system, 'gpt-4o'))

    const callMessages = mockCreate.mock.calls[0][0].messages
    expect(callMessages[0]).toEqual({ role: 'system', content: system })
    expect(callMessages[1]).toEqual(messages[0])
  })

  it('passes model and stream: true to create()', async () => {
    mockCreate.mockResolvedValue(asyncChunks([]))

    await collect(provider.streamChat(key, messages, system, 'gpt-4o-mini'))

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o-mini', stream: true })
    )
  })

  it('passes max_tokens when provided in options', async () => {
    mockCreate.mockResolvedValue(asyncChunks([]))

    await collect(
      provider.streamChat(key, messages, system, 'gpt-4o', { maxTokens: 512 })
    )

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 512 })
    )
  })

  it('passes temperature when provided in options', async () => {
    mockCreate.mockResolvedValue(asyncChunks([]))

    await collect(
      provider.streamChat(key, messages, system, 'gpt-4o', { temperature: 0.2 })
    )

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0.2 })
    )
  })

  it('preserves ordering of multiple messages', async () => {
    const multi = [
      { role: 'user' as const, content: 'Q1' },
      { role: 'assistant' as const, content: 'A1' },
      { role: 'user' as const, content: 'Q2' },
    ]
    mockCreate.mockResolvedValue(asyncChunks([]))

    await collect(provider.streamChat(key, multi, system, 'gpt-4o'))

    const callMessages = mockCreate.mock.calls[0][0].messages
    expect(callMessages).toHaveLength(4)
    expect(callMessages[0].role).toBe('system')
    expect(callMessages[1].content).toBe('Q1')
    expect(callMessages[2].content).toBe('A1')
    expect(callMessages[3].content).toBe('Q2')
  })
})
