import { z } from "zod";
import { Permission } from "../permissions.js";

const PermissionSchema = z.nativeEnum(Permission);

export const CreateRoleRequestSchema = z.object({
  name: z.string().min(1),
  permissions: z.array(PermissionSchema),
});
export type CreateRoleRequest = z.infer<typeof CreateRoleRequestSchema>;

export const UpdateRoleRequestSchema = z.object({
  name: z.string().min(1).optional(),
  permissions: z.array(PermissionSchema).optional(),
});
export type UpdateRoleRequest = z.infer<typeof UpdateRoleRequestSchema>;

export const RoleResponseSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  permissions: z.array(z.string()),
  isBuiltin: z.boolean(),
});
export type RoleResponse = z.infer<typeof RoleResponseSchema>;
