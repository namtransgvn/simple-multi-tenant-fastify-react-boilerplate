import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AIProvider, ChatMessage, StreamOptions } from "./interface.js";

export class GeminiProvider implements AIProvider {
  readonly providerType = "gemini";
  readonly supportedModels = ["gemini-2.5-flash"];

  async *streamChat(
    apiKey: string,
    messages: ChatMessage[],
    systemPrompt: string,
    model: string,
    options?: StreamOptions
  ): AsyncIterable<string> {
    const client = new GoogleGenerativeAI(apiKey);
    const genModel = client.getGenerativeModel({
      model,
      systemInstruction: systemPrompt,
      generationConfig: {
        maxOutputTokens: options?.maxTokens,
        temperature: options?.temperature,
      },
    });

    const contents = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const result = await genModel.generateContentStream({ contents });

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        yield text;
      }
    }
  }
}
