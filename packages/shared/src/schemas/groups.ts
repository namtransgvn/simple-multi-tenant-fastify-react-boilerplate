import { z } from "zod";
import { RoleResponseSchema } from "./roles.js";

export const CreateGroupRequestSchema = z.object({
  name: z.string().min(1),
  roleIds: z.array(z.string().uuid()),
});
export type CreateGroupRequest = z.infer<typeof CreateGroupRequestSchema>;

export const AddGroupMemberRequestSchema = z.object({
  userId: z.string().uuid(),
});
export type AddGroupMemberRequest = z.infer<typeof AddGroupMemberRequestSchema>;

export const GroupResponseSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  roles: z.array(RoleResponseSchema),
});
export type GroupResponse = z.infer<typeof GroupResponseSchema>;

export const UserRolesResponseSchema = z.object({
  direct: z.array(RoleResponseSchema),
  fromGroups: z.array(RoleResponseSchema),
});
export type UserRolesResponse = z.infer<typeof UserRolesResponseSchema>;
