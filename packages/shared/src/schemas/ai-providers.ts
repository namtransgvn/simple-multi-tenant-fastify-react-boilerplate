import { z } from "zod";
import { AI_PROVIDERS } from "../constants.js";

export const TenantAiProviderResponseSchema = z.object({
  id: z.string().uuid(),
  providerType: z.string(),
  enabled: z.boolean(),
  allowedModels: z.array(z.string()),
  hasKey: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TenantAiProviderResponse = z.infer<typeof TenantAiProviderResponseSchema>;

export const UpsertAiProviderRequestSchema = z.object({
  providerType: z.enum(AI_PROVIDERS),
  apiKey: z.string().min(1),
  allowedModels: z.array(z.string()).optional(),
});
export type UpsertAiProviderRequest = z.infer<typeof UpsertAiProviderRequestSchema>;

export const UpdateAiProviderRequestSchema = z.object({
  apiKey: z.string().optional(),
  allowedModels: z.array(z.string()).optional(),
});
export type UpdateAiProviderRequest = z.infer<typeof UpdateAiProviderRequestSchema>;
