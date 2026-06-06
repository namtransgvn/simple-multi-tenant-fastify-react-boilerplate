import type { AIProvider } from "./interface.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAIProvider } from "./openai.js";
import { GeminiProvider } from "./gemini.js";

export class AIProviderFactory {
  private readonly providers = new Map<string, AIProvider>();

  register(provider: AIProvider): void {
    this.providers.set(provider.providerType, provider);
  }

  resolve(providerType: string): AIProvider {
    const provider = this.providers.get(providerType);
    if (!provider) {
      const err = new Error(`Unsupported provider type: ${providerType}`);
      (err as NodeJS.ErrnoException & { statusCode?: number }).statusCode = 400;
      throw err;
    }
    return provider;
  }

  getSupportedModels(providerType: string): string[] {
    return this.resolve(providerType).supportedModels;
  }
}

export const aiProviderFactory = new AIProviderFactory();
aiProviderFactory.register(new AnthropicProvider());
aiProviderFactory.register(new OpenAIProvider());
aiProviderFactory.register(new GeminiProvider());
