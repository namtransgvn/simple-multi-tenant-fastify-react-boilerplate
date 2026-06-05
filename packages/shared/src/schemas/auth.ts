import { z } from "zod";

export const JwtPayloadSchema = z.object({
  userId: z.string().uuid(),
  tenantId: z.string().uuid(),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
  iat: z.number(),
  exp: z.number(),
});
export type JwtPayload = z.infer<typeof JwtPayloadSchema>;

export const TokenResponseSchema = z.object({
  accessToken: z.string(),
});
export type TokenResponse = z.infer<typeof TokenResponseSchema>;

export const RefreshRequestSchema = z.object({});
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

export const SsoProviderSchema = z.object({
  providerType: z.string(),
  name: z.string(),
  authorizationUrl: z.string().url(),
});
export type SsoProvider = z.infer<typeof SsoProviderSchema>;

export const SsoProvidersResponseSchema = z.object({
  providers: z.array(SsoProviderSchema),
});
export type SsoProvidersResponse = z.infer<typeof SsoProvidersResponseSchema>;
