import { describe, it, expect } from 'vitest'
import { AIProviderFactory, aiProviderFactory } from './factory.js'
import type { AIProvider } from './interface.js'

function fakeProvider(type: string, models: string[]): AIProvider {
  return {
    providerType: type,
    supportedModels: models,
    async *streamChat() {},
  }
}

describe('AIProviderFactory', () => {
  describe('resolve', () => {
    it('returns the provider that was registered', () => {
      const factory = new AIProviderFactory()
      const p = fakeProvider('test', [])
      factory.register(p)
      expect(factory.resolve('test')).toBe(p)
    })

    it('throws with statusCode 400 for an unknown provider type', () => {
      const factory = new AIProviderFactory()
      expect(() => factory.resolve('unknown')).toThrow()
      try {
        factory.resolve('unknown')
      } catch (err: any) {
        expect(err.statusCode).toBe(400)
        expect(err.message).toMatch(/unsupported provider type/i)
      }
    })

    it('allows overwriting a registered provider', () => {
      const factory = new AIProviderFactory()
      const p1 = fakeProvider('x', ['m1'])
      const p2 = fakeProvider('x', ['m2'])
      factory.register(p1)
      factory.register(p2)
      expect(factory.resolve('x')).toBe(p2)
    })
  })

  describe('getSupportedModels', () => {
    it('returns the model list declared by the provider', () => {
      const factory = new AIProviderFactory()
      factory.register(fakeProvider('p', ['a', 'b', 'c']))
      expect(factory.getSupportedModels('p')).toEqual(['a', 'b', 'c'])
    })

    it('throws 400 for an unknown provider type', () => {
      const factory = new AIProviderFactory()
      expect(() => factory.getSupportedModels('missing')).toThrow()
      try {
        factory.getSupportedModels('missing')
      } catch (err: any) {
        expect(err.statusCode).toBe(400)
      }
    })
  })

  describe('singleton aiProviderFactory', () => {
    it('has anthropic registered', () => {
      const p = aiProviderFactory.resolve('anthropic')
      expect(p.providerType).toBe('anthropic')
      expect(p.supportedModels.length).toBeGreaterThan(0)
    })

    it('has openai registered', () => {
      const p = aiProviderFactory.resolve('openai')
      expect(p.providerType).toBe('openai')
    })

    it('has gemini registered', () => {
      const p = aiProviderFactory.resolve('gemini')
      expect(p.providerType).toBe('gemini')
    })
  })
})
