import { z } from "zod";

export const CreateTenantRequestSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  adminEmail: z.string().email(),
});
export type CreateTenantRequest = z.infer<typeof CreateTenantRequestSchema>;

export const TenantResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  createdAt: z.string().datetime(),
});
export type TenantResponse = z.infer<typeof TenantResponseSchema>;

export const PublicTenantSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  ssoProviders: z.array(z.string()),
});
export type PublicTenant = z.infer<typeof PublicTenantSchema>;

export const PublicTenantsResponseSchema = z.object({
  tenants: z.array(PublicTenantSchema),
});
export type PublicTenantsResponse = z.infer<typeof PublicTenantsResponseSchema>;
