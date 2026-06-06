import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── SDK mock ────────────────────────────────────────────────────────────────

const mockGenerateContentStream = vi.fn()
const mockGetGenerativeModel = vi.fn().mockReturnValue({
  generateContentStream: mockGenerateContentStream,
})

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
}))

import { GoogleGenerativeAI } from '@google/generative-ai'
import { GeminiProvider } from './gemini.js'

// ─── helpers ─────────────────────────────────────────────────────────────────

async function* asyncChunks(texts: string[]): AsyncIterable<{ text(): string }> {
  for (const t of texts) yield { text: () => t }
}

async function collect(gen: AsyncIterable<string>): Promise<string[]> {
  const chunks: string[] = []
  for await (const c of gen) chunks.push(c)
  return chunks
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('GeminiProvider', () => {
  const provider = new GeminiProvider()
  const key = 'AIza-test-key'
  const messages = [{ role: 'user' as const, content: 'Hello' }]
  const system = 'You are a test assistant.'

  beforeEach(() => {
    vi.mocked(GoogleGenerativeAI).mockClear()
    mockGetGenerativeModel.mockClear()
    mockGenerateContentStream.mockClear()
    // restore default model mock after each test
    mockGetGenerativeModel.mockReturnValue({
      generateContentStream: mockGenerateContentStream,
    })
  })

  it('has providerType "gemini"', () => {
    expect(provider.providerType).toBe('gemini')
  })

  it('declares supported models', () => {
    expect(provider.supportedModels).toEqual([
      'gemini-2.0-flash',
      'gemini-1.5-pro',
      'gemini-1.5-flash',
    ])
  })

  it('yields text chunks from the stream', async () => {
    mockGenerateContentStream.mockResolvedValue({
      stream: asyncChunks(['Hello', ', ', 'world!']),
    })

    const chunks = await collect(
      provider.streamChat(key, messages, system, 'gemini-2.0-flash')
    )

    expect(chunks).toEqual(['Hello', ', ', 'world!'])
  })

  it('skips empty text chunks', async () => {
    mockGenerateContentStream.mockResolvedValue({
      stream: asyncChunks(['real', '', ' text', '']),
    })

    const chunks = await collect(
      provider.streamChat(key, messages, system, 'gemini-2.0-flash')
    )

    expect(chunks).toEqual(['real', ' text'])
  })

  it('constructs GoogleGenerativeAI with the provided apiKey', async () => {
    mockGenerateContentStream.mockResolvedValue({ stream: asyncChunks([]) })

    await collect(provider.streamChat('my-api-key', messages, system, 'gemini-2.0-flash'))

    expect(GoogleGenerativeAI).toHaveBeenCalledWith('my-api-key')
  })

  it('calls getGenerativeModel with the model name and systemInstruction', async () => {
    mockGenerateContentStream.mockResolvedValue({ stream: asyncChunks([]) })

    await collect(provider.streamChat(key, messages, system, 'gemini-1.5-pro'))

    expect(mockGetGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-1.5-pro',
        systemInstruction: system,
      })
    )
  })

  it('maps "user" role to "user" in contents', async () => {
    mockGenerateContentStream.mockResolvedValue({ stream: asyncChunks([]) })

    await collect(
      provider.streamChat(key, [{ role: 'user', content: 'Q' }], system, 'gemini-2.0-flash')
    )

    const contents = mockGenerateContentStream.mock.calls[0][0].contents
    expect(contents[0].role).toBe('user')
    expect(contents[0].parts[0].text).toBe('Q')
  })

  it('maps "assistant" role to "model" in contents', async () => {
    mockGenerateContentStream.mockResolvedValue({ stream: asyncChunks([]) })

    await collect(
      provider.streamChat(
        key,
        [{ role: 'assistant', content: 'Answer' }],
        system,
        'gemini-2.0-flash'
      )
    )

    const contents = mockGenerateContentStream.mock.calls[0][0].contents
    expect(contents[0].role).toBe('model')
    expect(contents[0].parts[0].text).toBe('Answer')
  })

  it('preserves ordering and role mapping for mixed message arrays', async () => {
    mockGenerateContentStream.mockResolvedValue({ stream: asyncChunks([]) })

    const mixed = [
      { role: 'user' as const, content: 'Q1' },
      { role: 'assistant' as const, content: 'A1' },
      { role: 'user' as const, content: 'Q2' },
    ]
    await collect(provider.streamChat(key, mixed, system, 'gemini-1.5-flash'))

    const contents = mockGenerateContentStream.mock.calls[0][0].contents
    expect(contents).toHaveLength(3)
    expect(contents[0]).toEqual({ role: 'user', parts: [{ text: 'Q1' }] })
    expect(contents[1]).toEqual({ role: 'model', parts: [{ text: 'A1' }] })
    expect(contents[2]).toEqual({ role: 'user', parts: [{ text: 'Q2' }] })
  })

  it('passes maxTokens as maxOutputTokens in generationConfig', async () => {
    mockGenerateContentStream.mockResolvedValue({ stream: asyncChunks([]) })

    await collect(
      provider.streamChat(key, messages, system, 'gemini-2.0-flash', { maxTokens: 2048 })
    )

    expect(mockGetGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({
        generationConfig: expect.objectContaining({ maxOutputTokens: 2048 }),
      })
    )
  })

  it('passes temperature in generationConfig when provided', async () => {
    mockGenerateContentStream.mockResolvedValue({ stream: asyncChunks([]) })

    await collect(
      provider.streamChat(key, messages, system, 'gemini-2.0-flash', { temperature: 0.7 })
    )

    expect(mockGetGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({
        generationConfig: expect.objectContaining({ temperature: 0.7 }),
      })
    )
  })
})
