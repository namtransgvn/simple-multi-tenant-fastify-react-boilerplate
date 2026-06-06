export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface StreamOptions {
  maxTokens?: number;
  temperature?: number;
}

export interface AIProvider {
  readonly providerType: string;
  readonly supportedModels: string[];
  streamChat(
    apiKey: string,
    messages: ChatMessage[],
    systemPrompt: string,
    model: string,
    options?: StreamOptions
  ): AsyncIterable<string>;
}
