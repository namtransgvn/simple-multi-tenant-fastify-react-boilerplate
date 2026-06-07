import Anthropic from "@anthropic-ai/sdk";
import type { AIProvider, ChatMessage, StreamOptions } from "./interface.js";

export class AnthropicProvider implements AIProvider {
  readonly providerType = "anthropic";
  readonly supportedModels = ["claude-sonnet-4-5"];

  async *streamChat(
    apiKey: string,
    messages: ChatMessage[],
    systemPrompt: string,
    model: string,
    options?: StreamOptions
  ): AsyncIterable<string> {
    const client = new Anthropic({ apiKey });
    const stream = client.messages.stream({
      model,
      system: systemPrompt,
      messages,
      max_tokens: options?.maxTokens ?? 8192,
      ...(options?.temperature !== undefined && {
        temperature: options.temperature,
      }),
    });

    try {
      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          yield event.delta.text;
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      throw err;
    }
  }
}
