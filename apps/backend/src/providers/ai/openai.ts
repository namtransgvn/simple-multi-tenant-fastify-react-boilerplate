import OpenAI from "openai";
import type { AIProvider, ChatMessage, StreamOptions } from "./interface.js";

export class OpenAIProvider implements AIProvider {
  readonly providerType = "openai";
  readonly supportedModels = ["gpt-5-mini"];

  async *streamChat(
    apiKey: string,
    messages: ChatMessage[],
    systemPrompt: string,
    model: string,
    options?: StreamOptions
  ): AsyncIterable<string> {
    const client = new OpenAI({ apiKey });
    const stream = await client.chat.completions.create({
      model,
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
      max_tokens: options?.maxTokens,
      ...(options?.temperature !== undefined && {
        temperature: options.temperature,
      }),
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        yield delta;
      }
    }
  }
}
