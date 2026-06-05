import { z } from "zod";
import { AI_PROVIDERS } from "../constants.js";

export const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatRequestSchema = z.object({
  projectId: z.string().uuid(),
  messages: z.array(ChatMessageSchema),
  provider: z.enum(AI_PROVIDERS),
  model: z.string().min(1),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const ChatStreamChunkSchema = z.object({
  delta: z.string().optional(),
  error: z.string().optional(),
  done: z.boolean().optional(),
});
export type ChatStreamChunk = z.infer<typeof ChatStreamChunkSchema>;

export const ModelInfoSchema = z.object({
  provider: z.string(),
  models: z.array(z.string()),
});
export type ModelInfo = z.infer<typeof ModelInfoSchema>;

export const ProvidersResponseSchema = z.object({
  providers: z.array(ModelInfoSchema),
});
export type ProvidersResponse = z.infer<typeof ProvidersResponseSchema>;
