export const PAGINATION_DEFAULT_LIMIT = 20;
export const PAGINATION_MAX_LIMIT = 100;

export const MAX_FILE_SIZE_BYTES = 10_485_760;

export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export const ALLOWED_EXTENSIONS = [".pdf", ".txt", ".md", ".docx"] as const;

export const AI_PROVIDERS = ["anthropic", "openai", "gemini"] as const;

export type AiProvider = (typeof AI_PROVIDERS)[number];
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];
export type AllowedExtension = (typeof ALLOWED_EXTENSIONS)[number];
