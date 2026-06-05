# CLAUDE.md — AI Chatbot Platform

This file describes the full technology stack, architecture decisions, project structure, and development conventions for this platform. Read it before writing any code.

---

## Monorepo layout

```
/
├── apps/
│   ├── frontend/          # React + TypeScript SPA
│   └── backend/           # Fastify + TypeScript API
├── packages/
│   └── shared/            # Shared TypeScript types, Zod schemas, constants
├── docker-compose.yml     # Local dev: PostgreSQL
├── .env.example           # Required environment variables (no values)
└── CLAUDE.md              # This file
```

Package manager: **pnpm** with workspaces. All scripts are run from the root unless noted.

| Script | What it does |
|---|---|
| `pnpm install` | Install all workspace dependencies |
| `pnpm dev` | Start frontend + backend concurrently with hot reload |
| `pnpm build` | Production build for both apps |
| `pnpm test` | Unit tests across all packages |
| `pnpm test:integration` | Integration tests (requires running DB) |
| `pnpm db:migrate` | Apply pending Drizzle migrations |
| `pnpm db:seed` | Seed master tenant and default admin user |
| `pnpm lint` | ESLint across all packages |

---

## Backend

### Runtime & framework

- **Runtime:** Node.js (LTS)
- **Framework:** [Fastify](https://fastify.dev/) — chosen for its schema-first validation, plugin architecture, and Pino logger integration
- **Language:** TypeScript with `strict: true`

### Fastify plugins (registered globally)

| Plugin | Purpose |
|---|---|
| `@fastify/jwt` | JWT signing and verification; `request.user` populated on every authenticated route |
| `@fastify/cors` | CORS with explicit `origin` allowlist from env |
| `@fastify/multipart` | File upload handling (`multipart/form-data`) |
| `@fastify/sensible` | Typed HTTP error helpers (`reply.notFound()`, etc.) |
| `@fastify/rate-limit` | Per-IP rate limiting on `/auth/*` routes |

### Route organisation

Routes live under `src/routes/`, one file per domain. Each route file is a Fastify plugin registered with a prefix:

```
src/routes/
├── auth.ts          # /auth/*  — SSO callbacks, token refresh, logout
├── projects.ts      # /api/projects/*
├── documents.ts     # /api/projects/:projectId/documents/*
├── chat.ts          # /api/chat  — SSE streaming endpoint
├── providers.ts     # /api/providers  — available AI providers and models
├── admin/
│   ├── roles.ts     # /api/admin/roles/*
│   ├── groups.ts    # /api/admin/groups/*
│   └── users.ts     # /api/admin/users/*
└── master/
    └── tenants.ts   # /api/master/tenants/*  — master-tenant only
```

Every route declares its JSON Schema (or Zod schema via `fastify-type-provider-zod`) inline. Validation errors return 400 automatically.

### Middleware / hooks execution order

```
onRequest  →  preValidation  →  preHandler  →  handler  →  onSend
   │               │               │
authenticate    validate        tenant-guard
(JWT check)    (schema)        (attach tenantId,
                               check permissions)
```

1. **`authenticate` hook** — verifies JWT on every route except `/health` and `/auth/*`. Attaches `request.user = { userId, tenantId, roles, permissions }`.
2. **`tenantGuard` hook** — extracts `tenantId` from `request.user` and attaches it to `request.tenantId`. All service calls receive this value explicitly; never trust `tenantId` from the request body.
3. **`permissionGuard(permission)` decorator** — wraps admin routes; throws 403 if `request.user.permissions` does not include the required permission string.

### Service layer

Business logic lives in `src/services/`, not in route handlers. Route handlers call services; services call repositories (Drizzle queries). This keeps routes thin and services testable.

```
src/
├── routes/          # HTTP interface — thin, delegates to services
├── services/        # Business logic — all tenant-scoped
├── db/
│   ├── schema/      # Drizzle table definitions
│   ├── migrations/  # Generated migration files (do not edit manually)
│   └── index.ts     # DB connection export
├── providers/
│   ├── ai/          # AI provider implementations
│   └── auth/        # SSO provider implementations
├── plugins/         # Fastify plugin registrations
├── hooks/           # Reusable Fastify hooks
└── config.ts        # Env var validation and typed config object
```

### Error handling

All errors flow through a global `setErrorHandler`. Every error response has this shape:

```json
{
  "statusCode": 404,
  "error": "Not Found",
  "message": "Project not found",
  "errorId": "err_01j..."
}
```

`errorId` is a ULID generated per error, logged alongside the full stack trace for correlation. Never expose stack traces or internal error details in responses.

### Logging

Fastify's built-in **Pino** logger. Every request log includes:

```
requestId, tenantId, userId, method, url, statusCode, responseTime
```

AI provider calls additionally log: `provider`, `model`, `latencyMs`, `error` (on failure). API keys are never logged. Log level is set by `LOG_LEVEL` env var (default: `info`).

---

## Database

### Engine and ORM

- **Database:** PostgreSQL 16+
- **ORM:** [Drizzle ORM](https://orm.drizzle.team/) — type-safe queries, no query builder magic, SQL-close syntax
- **Migrations:** Drizzle Kit (`drizzle-kit generate` then `pnpm db:migrate`)

### Schema conventions

- All primary keys: `uuid` generated with `gen_random_uuid()`
- All tables (except `tenants`): `tenant_id uuid NOT NULL REFERENCES tenants(id)` — indexed
- Timestamps: `created_at timestamptz DEFAULT now() NOT NULL`, `updated_at timestamptz DEFAULT now() NOT NULL`
- Soft deletes where applicable: `deleted_at timestamptz` (null = active)
- Schema files live in `src/db/schema/`, one file per domain

### Core tables

```
tenants          id, name, slug, created_at
users            id, tenant_id, email, display_name, sso_provider, sso_subject, created_at
sso_providers    id, tenant_id (nullable), provider_type, client_id, issuer_url, enabled
projects         id, tenant_id, owner_id, name, description, deleted_at, timestamps
documents        id, tenant_id, project_id, filename, mime_type, size_bytes, content_text, timestamps
messages         id, tenant_id, project_id, session_id, role, content, provider, model, timestamps
roles            id, tenant_id, name, permissions (text[]), is_builtin
groups           id, tenant_id, name
group_roles      group_id, role_id
user_roles       user_id, role_id, tenant_id
user_groups      user_id, group_id, tenant_id
refresh_tokens   id, user_id, tenant_id, token_hash, expires_at, revoked_at
```

### Multi-tenancy rule

Every Drizzle query in `src/services/` **must** include `.where(eq(table.tenantId, tenantId))`. There is no ORM-level row-level security — enforcement is in the service layer. Integration tests verify cross-tenant isolation.

---

## Authentication & SSO

### Abstraction

Every SSO provider implements the `AuthProvider` interface:

```typescript
interface AuthProvider {
  getAuthorizationUrl(state: string): string
  exchangeCodeForToken(code: string): Promise<TokenSet>
  getUserProfile(tokenSet: TokenSet): Promise<UserProfile>
}
```

Implementations live in `src/providers/auth/`:

```
src/providers/auth/
├── interface.ts        # AuthProvider interface + UserProfile type
├── factory.ts          # AuthProviderFactory — resolves by provider_type string
├── google.ts           # Google OAuth2
├── amazon-cognito.ts   # Amazon Cognito
└── keycloak.ts         # Keycloak OIDC
```

Active providers are loaded at startup from the `sso_providers` table (or fallback config file). Adding a new provider = implement the interface + insert a row; no route handler changes.

### Session flow

1. Frontend redirects user to `GET /auth/sso/:provider/authorize` → backend redirects to provider consent screen.
2. Provider redirects to `GET /auth/sso/:provider/callback?code=...` → backend exchanges code, fetches profile, upserts user row, issues tokens.
3. **Access token** (JWT, 24 h): returned in response body. Frontend stores in Zustand memory only (never `localStorage`).
4. **Refresh token** (7 days): stored in `HttpOnly; Secure; SameSite=Strict` cookie. `POST /auth/refresh` issues a new access token silently.
5. `POST /auth/logout` hashes and revokes the refresh token in the `refresh_tokens` table.

### JWT payload

```typescript
{
  userId: string       // users.id
  tenantId: string     // tenants.id
  roles: string[]      // role names
  permissions: string[] // flattened union of all role permissions
  iat: number
  exp: number
}
```

Permissions are the union of: direct user roles + all group-derived roles. Recomputed on every token refresh.

---

## AI provider integration

### Abstraction

Every AI provider implements:

```typescript
interface AIProvider {
  readonly name: string
  readonly models: string[]
  streamChat(
    messages: ChatMessage[],
    systemPrompt: string,
    model: string,
    options?: StreamOptions
  ): AsyncIterable<string>
}
```

Implementations live in `src/providers/ai/`:

```
src/providers/ai/
├── interface.ts        # AIProvider interface + ChatMessage type
├── factory.ts          # AIProviderFactory
├── anthropic.ts        # Claude (Anthropic SDK)
├── openai.ts           # GPT models (OpenAI SDK)
└── gemini.ts           # Gemini (Google AI SDK)
```

Each implementation maps the generic `ChatMessage[]` format to its own API internally.

### Secret key management

Keys are read **only** from environment variables. The app throws at startup if a configured provider's key is absent.

| Variable | Provider |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic Claude |
| `OPENAI_API_KEY` | OpenAI GPT |
| `GOOGLE_AI_API_KEY` | Google Gemini |

Keys are never logged, never returned in API responses, never interpolated into error strings. For production, inject via HashiCorp Vault or AWS Secrets Manager using the `SecretsProvider` interface stub in `src/config/secrets.ts`.

### Streaming chat endpoint

`POST /api/chat` — requires authentication, enforces tenant isolation.

Request body:
```typescript
{
  projectId: string
  messages: { role: "user" | "assistant", content: string }[]
  provider: "anthropic" | "openai" | "gemini"
  model: string
}
```

Flow:
1. Validate project belongs to `request.tenantId`.
2. Fetch all `documents.content_text` for the project; concatenate into a system prompt.
3. Resolve provider via `AIProviderFactory`.
4. Set response headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`.
5. Iterate `AsyncIterable<string>` from provider; emit each chunk as `data: {"delta":"..."}\n\n`.
6. On completion, emit `data: [DONE]\n\n`, persist the full assembled message to `messages` table.
7. On provider error, emit `data: {"error":"..."}\n\n` and close the stream.

---

## Frontend

### Stack

| Library | Version constraint | Purpose |
|---|---|---|
| React | 19+ | UI rendering |
| TypeScript | 5+ strict | Type safety |
| Vite | 6+ | Build tool and dev server |
| TanStack Router | v1 | File-based, type-safe routing |
| TanStack Query | v5 | Server state, caching, background refetch |
| Zustand | v5 | Client state (auth session, chat history) |
| Tailwind CSS | v4 | Utility-first styling |
| shadcn/ui | latest | Pre-built accessible component primitives |
| Zod | v3 | Runtime validation (shared with backend via `packages/shared`) |

### Directory structure

```
apps/frontend/src/
├── routes/                  # TanStack Router route files
│   ├── __root.tsx           # Root layout (sidebar + header)
│   ├── login.tsx
│   ├── projects/
│   │   ├── index.tsx        # /projects — project list
│   │   └── $projectId/
│   │       └── chat.tsx     # /projects/:projectId/chat
│   └── admin/
│       ├── roles.tsx
│       ├── groups.tsx
│       └── users.tsx
├── components/
│   ├── ui/                  # shadcn primitives (do not edit manually)
│   ├── chat/                # ChatMessage, ChatInput, StreamingBubble
│   ├── projects/            # ProjectCard, ProjectModal, DocumentPanel
│   └── layout/              # Sidebar, Header, AuthGuard
├── stores/                  # Zustand stores (one file per domain)
│   ├── authStore.ts
│   ├── projectStore.ts
│   ├── chatStore.ts
│   └── tenantStore.ts
├── hooks/                   # Custom React hooks
│   ├── useStreamingChat.ts  # SSE stream management
│   └── usePermission.ts     # Permission check helper
├── lib/
│   ├── api.ts               # Fetch wrapper with auth interceptor + silent refresh
│   ├── queryClient.ts       # TanStack QueryClient configuration
│   └── utils.ts             # shadcn cn() helper + misc
└── main.tsx
```

### State management

**Zustand** manages client-only state that does not belong in the server-state cache:

| Store | Holds |
|---|---|
| `authStore` | Decoded JWT payload, `isAuthenticated`, `logout()` action |
| `projectStore` | Currently selected project ID |
| `chatStore` | Active chat session messages, streaming status, selected provider/model |
| `tenantStore` | Current tenant metadata |

**TanStack Query** manages all server state (projects list, documents, providers). Query keys are namespaced: `['projects', tenantId]`, `['documents', projectId]`, etc.

### Routing and auth

Routes are defined in `routes/` as TanStack Router file-based route files. `__root.tsx` wraps all routes in `<AuthGuard>`, which reads `authStore.isAuthenticated` and redirects to `/login` if false.

The `/login` route is the only public route; it renders SSO provider buttons resolved from `GET /api/providers/sso`.

### API client

`src/lib/api.ts` exports a typed fetch wrapper that:

1. Attaches `Authorization: Bearer <token>` from `authStore`.
2. On 401 response: calls `POST /auth/refresh` once silently, retries the original request.
3. On second 401: calls `authStore.logout()` and navigates to `/login`.
4. Returns typed responses using schemas from `packages/shared`.

### Streaming chat

`useStreamingChat` hook manages the SSE connection:

1. Opens a `fetch()` POST to `/api/chat` (not `EventSource` — POST body required).
2. Reads the response body as a `ReadableStream`; parses `data: ...` chunks.
3. Appends delta tokens to the current assistant message in `chatStore`.
4. On `[DONE]`, marks streaming complete.
5. On network error or stream close before `[DONE]`, sets an error state enabling the Retry button.

### Component conventions

- All components are function components with typed props interfaces.
- shadcn primitives (`Button`, `Dialog`, `Input`, etc.) are imported from `@/components/ui/`.
- Custom components are composed from shadcn primitives + Tailwind utilities.
- No inline styles; no CSS modules — Tailwind classes only.
- Loading states use shadcn `Skeleton`; error states use shadcn `Alert`.

---

## Shared package

`packages/shared/` contains:

- **Zod schemas** for all API request/response shapes (imported by both frontend and backend)
- **TypeScript types** derived from those schemas (`z.infer<typeof schema>`)
- **Permission enum** — the canonical list of permission strings (`project:create`, `chat:use`, etc.)
- **Constants** — pagination defaults, file size limits, supported MIME types

Do not put runtime code that depends on Node.js or browser APIs in this package.

---

## Security conventions

- `tenant_id` is **always** sourced from the verified JWT, never from request body or query params.
- All Drizzle queries include `tenant_id` in the `WHERE` clause — enforced by code review.
- No raw SQL string interpolation anywhere.
- File uploads: MIME type verified server-side against an allowlist; stored outside the web root.
- API keys: read from env vars only; fail-fast at startup if missing; never logged.
- CORS: explicit `CORS_ORIGIN` env var allowlist; `*` is rejected in non-development builds.
- Security headers applied globally via a Fastify `onSend` hook: `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, `Content-Security-Policy`.

---

## Environment variables

All variables are validated at startup in `src/config.ts` (backend) and via Vite's `env.d.ts` (frontend).

### Backend (`.env`)

```bash
# Server
NODE_ENV=development
PORT=3000
LOG_LEVEL=info

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/chatbot

# JWT
JWT_SECRET=<min 32 chars>
JWT_EXPIRES_IN=24h
REFRESH_TOKEN_EXPIRES_IN=7d

# CORS
CORS_ORIGIN=http://localhost:5173

# AI providers (at least one required)
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GOOGLE_AI_API_KEY=

# SSO (per provider — can also be stored in DB)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
AMAZON_COGNITO_CLIENT_ID=
AMAZON_COGNITO_CLIENT_SECRET=
AMAZON_COGNITO_ISSUER_URL=
KEYCLOAK_CLIENT_ID=
KEYCLOAK_CLIENT_SECRET=
KEYCLOAK_ISSUER_URL=

# File uploads
MAX_FILE_SIZE_BYTES=10485760
UPLOAD_DIR=./uploads

# Rate limiting
AUTH_RATE_LIMIT_MAX=10
AUTH_RATE_LIMIT_WINDOW_MS=60000
```

### Frontend (`.env`)

```bash
VITE_API_BASE_URL=http://localhost:3000
```

---

## Adding a new AI provider

1. Create `apps/backend/src/providers/ai/<name>.ts` implementing `AIProvider`.
2. Register it in `AIProviderFactory` in `factory.ts`.
3. Add the corresponding API key env var to `.env.example` and `src/config.ts`.
4. The provider appears automatically in `GET /api/providers` and becomes selectable in the chat UI.

## Adding a new SSO provider

1. Create `apps/backend/src/providers/auth/<name>.ts` implementing `AuthProvider`.
2. Register it in `AuthProviderFactory` in `factory.ts`.
3. Insert a row into `sso_providers` (or add a config entry) with `provider_type: "<name>"` and the client credentials.
4. The provider button appears automatically on the login screen.
