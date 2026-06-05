# Simple Multi-Tenant Fastify + React Boilerplate

A production-ready monorepo boilerplate for building multi-tenant AI chatbot platforms. Ships with SSO authentication, role-based access control, multi-provider AI streaming (Anthropic, OpenAI, Gemini), and a React SPA — all enforcing strict tenant isolation at every layer.

## Stack

| Layer | Technology |
|---|---|
| Backend | Fastify + TypeScript, Drizzle ORM, PostgreSQL 16 |
| Frontend | React 19, Vite 6, TanStack Router/Query, Zustand, Tailwind CSS v4 |
| Auth | JWT + HttpOnly refresh tokens, Google / Amazon Cognito / Keycloak SSO |
| AI | Anthropic Claude, OpenAI GPT, Google Gemini (streaming SSE) |
| Shared | Zod schemas and TypeScript types in `packages/shared` |

## Prerequisites

- Node.js LTS
- pnpm 9+
- Docker (for the local PostgreSQL instance)

## Quick start

### 1. Clone and install

```bash
git clone <repo-url>
cd simple-multi-tenant-fastify-react-boilerplate
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in the required values:

- `JWT_SECRET` — at least 32 random characters
- At least one AI provider key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GOOGLE_AI_API_KEY`)
- At least one SSO provider's client ID, secret, and issuer URL

### 3. Start the database

```bash
docker compose up -d
```

### 4. Run migrations and seed

```bash
pnpm db:migrate   # apply all Drizzle migrations
pnpm db:seed      # create master tenant + default admin user
```

### 5. Start development servers

```bash
pnpm dev
```

This starts both apps concurrently with hot reload:

| App | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:3000 |

## Running apps individually

### Backend only

```bash
pnpm --filter backend dev
```

The API server starts on the port defined by `PORT` (default `3000`). Health check: `GET /health`.

### Frontend only

```bash
pnpm --filter frontend dev
```

The Vite dev server starts on port `5173`. Set `VITE_API_BASE_URL` in `apps/frontend/.env` if the backend runs on a different port.

## Other scripts

| Command | What it does |
|---|---|
| `pnpm build` | Production build for backend and frontend |
| `pnpm test` | Unit tests across all packages |
| `pnpm test:integration` | Integration tests (requires a running database) |
| `pnpm lint` | ESLint across all packages |
| `pnpm db:migrate` | Apply pending Drizzle migrations |
| `pnpm db:seed` | Seed master tenant and default admin user |

## Project structure

```
/
├── apps/
│   ├── backend/       # Fastify API — routes, services, DB, AI/SSO providers
│   └── frontend/      # React SPA — TanStack Router, Zustand, shadcn/ui
├── packages/
│   └── shared/        # Zod schemas, TypeScript types, permission enums
├── docker-compose.yml
├── .env.example
└── pnpm-workspace.yaml
```

## Multi-tenancy model

Every database row (except `tenants`) carries a `tenant_id` foreign key. The backend enforces isolation in the service layer: `tenant_id` is always sourced from the verified JWT, never from the request body. Integration tests verify cross-tenant data leakage is impossible.

## Adding providers

**New AI provider** — implement `AIProvider` in `apps/backend/src/providers/ai/`, register in `factory.ts`, add the API key env var. It appears automatically in the chat UI.

**New SSO provider** — implement `AuthProvider` in `apps/backend/src/providers/auth/`, register in `factory.ts`, insert a row in `sso_providers`. It appears automatically on the login screen.

## License

MIT
