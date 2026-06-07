# Simple Multi-Tenant Fastify + React Boilerplate

A production-ready monorepo boilerplate for building multi-tenant AI chatbot platforms. Ships with SSO authentication, role-based access control, multi-provider AI streaming (Anthropic, OpenAI, Gemini), and a React SPA — all enforcing strict tenant isolation at every layer.

---

## Prerequisites

- [Node.js LTS](https://nodejs.org/)
- [pnpm 9+](https://pnpm.io/installation)
- [Docker + Docker Compose](https://docs.docker.com/get-docker/)

---

## Quick start

```bash
git clone <repo-url>
cd simple-multi-tenant-fastify-react-boilerplate
cp .env.example .env          # then open .env and fill in JWT_SECRET + at least one AI key
docker compose up -d
pnpm install
pnpm db:migrate && pnpm db:seed
pnpm dev
```

**Minimum required `.env` values before starting:**

- `JWT_SECRET` — any random string of at least 32 characters
- At least one AI provider key: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GOOGLE_AI_API_KEY`
- At least one SSO provider's client credentials (e.g. `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`)

Once running:

| App | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:3000 |
| Health check | http://localhost:3000/health |

---

## Environment variable reference

### Backend (`.env`)

| Variable | Required | Description | Example |
|---|---|---|---|
| `NODE_ENV` | Yes | Runtime environment | `development` |
| `PORT` | Yes | Port the backend listens on | `3000` |
| `LOG_LEVEL` | No | Pino log level | `info` |
| `DATABASE_URL` | Yes | PostgreSQL connection string | `postgresql://user:password@localhost:5432/chatbot` |
| `JWT_SECRET` | Yes | Secret for signing JWTs (min 32 chars) | `supersecretkey...` |
| `JWT_EXPIRES_IN` | Yes | Access token lifetime | `24h` |
| `REFRESH_TOKEN_EXPIRES_IN` | Yes | Refresh token lifetime | `7d` |
| `CORS_ORIGIN` | Yes | Exact frontend origin for CORS allowlist | `http://localhost:5173` |
| `ANTHROPIC_API_KEY` | One AI key required | Anthropic Claude API key | `sk-ant-...` |
| `OPENAI_API_KEY` | One AI key required | OpenAI API key | `sk-...` |
| `GOOGLE_AI_API_KEY` | One AI key required | Google Gemini API key | `AIza...` |
| `GOOGLE_CLIENT_ID` | If using Google SSO | Google OAuth2 client ID | |
| `GOOGLE_CLIENT_SECRET` | If using Google SSO | Google OAuth2 client secret | |
| `AMAZON_COGNITO_CLIENT_ID` | If using Cognito SSO | Amazon Cognito client ID | |
| `AMAZON_COGNITO_CLIENT_SECRET` | If using Cognito SSO | Amazon Cognito client secret | |
| `AMAZON_COGNITO_ISSUER_URL` | If using Cognito SSO | Cognito issuer URL | |
| `KEYCLOAK_CLIENT_ID` | If using Keycloak SSO | Keycloak client ID | |
| `KEYCLOAK_CLIENT_SECRET` | If using Keycloak SSO | Keycloak client secret | |
| `KEYCLOAK_ISSUER_URL` | If using Keycloak SSO | Keycloak issuer URL | |
| `MAX_FILE_SIZE_BYTES` | No | Maximum upload file size in bytes | `10485760` |
| `UPLOAD_DIR` | No | Directory for uploaded files | `./uploads` |
| `AUTH_RATE_LIMIT_MAX` | No | Max auth requests per window | `10` |
| `AUTH_RATE_LIMIT_WINDOW_MS` | No | Rate limit window in milliseconds | `60000` |

### Frontend (`apps/frontend/.env`)

| Variable | Required | Description | Example |
|---|---|---|---|
| `VITE_API_BASE_URL` | Yes | Backend API base URL | `http://localhost:3000` |

---

## Available scripts

Run all scripts from the repository root unless noted.

| Script | What it does |
|---|---|
| `pnpm install` | Install all workspace dependencies |
| `pnpm dev` | Start frontend + backend concurrently with hot reload |
| `pnpm build` | Production build for both apps |
| `pnpm test` | Unit tests across all packages |
| `pnpm test:integration` | Integration tests (requires a running database) |
| `pnpm db:migrate` | Apply pending Drizzle migrations |
| `pnpm db:seed` | Seed master tenant and default admin user |
| `pnpm lint` | ESLint across all packages |

---

## Project structure

```
/
├── apps/
│   ├── frontend/          # React 19 + TypeScript SPA
│   └── backend/           # Fastify + TypeScript API
├── packages/
│   └── shared/            # Shared Zod schemas, TypeScript types, and constants
├── docker-compose.yml     # Local dev: PostgreSQL 16
├── .env.example           # Required environment variables (no values)
└── pnpm-workspace.yaml
```

- **`apps/frontend`** — Single-page application built with Vite, TanStack Router, TanStack Query, Zustand, Tailwind CSS v4, and shadcn/ui. Handles SSO login, project management, document uploads, and streaming AI chat. Auth tokens live in Zustand memory only — never `localStorage`.
- **`apps/backend`** — REST + SSE API. Multi-tenant isolation is enforced in the service layer: every database query is scoped to a `tenant_id` sourced from the verified JWT, never from the request body. Routes are thin wrappers around `src/services/`.
- **`packages/shared`** — Framework-agnostic package imported by both apps. Contains the canonical permission strings, Zod request/response schemas, pagination defaults, and file-upload constants. No Node.js or browser API dependencies.

---

## Adding a new AI provider

1. Create `apps/backend/src/providers/ai/<name>.ts` implementing the `AIProvider` interface.
2. Register it in `AIProviderFactory` in `apps/backend/src/providers/ai/factory.ts`.
3. Add the corresponding API key environment variable to `.env.example` and `apps/backend/src/config.ts`.
4. The provider appears automatically in `GET /api/providers` and becomes selectable in the chat UI.

---

## Adding a new SSO provider

1. Create `apps/backend/src/providers/auth/<name>.ts` implementing the `AuthProvider` interface.
2. Register it in `AuthProviderFactory` in `apps/backend/src/providers/auth/factory.ts`.
3. Insert a row into the `sso_providers` table (or add a config entry) with `provider_type: "<name>"` and the client credentials.
4. The provider button appears automatically on the login screen.

---

## Deployment notes

- Set `NODE_ENV=production`.
- Use a secrets manager (e.g. HashiCorp Vault, AWS Secrets Manager) for all API keys and `JWT_SECRET` — never commit secrets to the repository.
- `CORS_ORIGIN` must be set to the **exact** frontend origin (e.g. `https://app.example.com`). A wildcard (`*`) is rejected in non-development builds.
- Run `pnpm db:migrate` before starting the backend in your CI/CD pipeline to ensure the schema is up to date.
- The `UPLOAD_DIR` directory (default `./uploads`) must be on **persistent storage** — files will not survive container restarts if backed by ephemeral disk.

---

## License

MIT
