import { z } from "zod";

export const DocumentResponseSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DocumentResponse = z.infer<typeof DocumentResponseSchema>;

export const DocumentListResponseSchema = z.object({
  items: z.array(DocumentResponseSchema),
});
export type DocumentListResponse = z.infer<typeof DocumentListResponseSchema>;
