export const Permission = {
  PROJECT_CREATE: "project:create",
  PROJECT_READ: "project:read",
  PROJECT_UPDATE: "project:update",
  PROJECT_DELETE: "project:delete",
  DOCUMENT_MANAGE: "document:manage",
  CHAT_USE: "chat:use",
  ADMIN_MANAGE: "admin:manage",
  TENANT_MANAGE: "tenant:manage",
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];
