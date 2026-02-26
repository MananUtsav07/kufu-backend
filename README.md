# Kufu Backend Architecture

This repository is the Express + TypeScript backend for Kufu.

It provides:
- Custom JWT auth (not Supabase Auth user sessions)
- Multi-tenant dashboard APIs (scoped by `client_id`)
- Chat endpoint with OpenAI + client knowledge injection
- Lead capture and JSONL audit logging

## Stack

- Node.js + Express + TypeScript
- Supabase Postgres via service role key
- Zod validation
- JSON Web Tokens
- Nodemailer (Gmail app password SMTP)
- OpenAI SDK

## Run

1. Install:
   `npm install`
2. Configure env:
   create `.env` from `.env.example`
3. Start dev:
   `npm run dev` (default `http://localhost:8787`)
4. Build:
   `npm run build`
5. Start compiled server:
   `npm run start`

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `PORT` | No | HTTP port, default `8787`. |
| `NODE_ENV` | No | Runtime mode (`development`/`production`). |
| `OPENAI_API_KEY` | Yes for AI chat | OpenAI key used by `/api/chat`. |
| `OPENAI_MODEL` | No | Chat model, default `gpt-4o-mini`. |
| `SUPABASE_URL` | Yes | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service key for DB reads/writes. |
| `JWT_SECRET` | Yes | Signs and verifies app JWT tokens. |
| `EMAIL_USER` | Yes for verification emails | SMTP sender account. |
| `EMAIL_PASS` | Yes for verification emails | Gmail app password. |
| `APP_BASE_URL` | Yes (recommended) | Frontend base URL for verify links, default `http://localhost:5173`. |
| `ALLOWED_ORIGINS` | Yes (recommended) | Comma-separated CORS allowlist. |
| `DATA_DIR` | No | JSONL output folder, default `data` locally and `/tmp/kufu-data` on Vercel. |

## How The Backend Works

### 1) Startup flow

- `src/config/runtime.ts` loads env values and creates shared clients.
- `src/index.ts` creates the Express app, middleware stack, and route mounts.
- Data store is initialized (`data` directory + knowledge file preload).
- App logs runtime health (env, key presence, CORS origins, knowledge length).

### 2) Middleware flow

- `express.json` + `express.urlencoded` parse request bodies.
- `cookie-parser` enables cookie reads for session fallback.
- Request logger prints `/api/*` status lines on response finish.
- `cors` validates origin against configured allowlist.
- Global error handler catches uncaught route errors.

### 3) Route composition

- `src/routes/api.ts` is the main router mounted at `/api`.
- It composes:
  - `/api/auth/*` from `src/routes/auth.ts`
  - `/api/dashboard/*` from `src/routes/dashboard.ts`
  - public endpoints (`/health`, `/widget/config`, `/chat`, `/chat/log`, `/leads/*`)

### 4) Auth flow (custom users table)

- Register:
  - validates payload with Zod
  - hashes password with bcrypt
  - upserts user and creates/updates a linked client row
  - rotates verification token
  - sends verification email via Nodemailer
- Verify:
  - validates token and expiry
  - marks `users.is_verified = true`
  - deletes used token
- Login:
  - validates credentials
  - checks verified user + linked client
  - signs JWT with `{ sub, email, client_id }`
  - returns token plus user/client profile
  - sets `kufu_session` cookie (httpOnly)
- Me:
  - validates JWT (bearer or cookie)
  - returns user + client record

### 5) Dashboard flow (multi-tenant)

- All `/api/dashboard/*` routes require auth middleware.
- Middleware extracts JWT and attaches `req.user`:
  - `userId`
  - `email`
  - `clientId`
- Each route does an ownership check:
  - `clients.id == req.user.clientId`
  - `clients.user_id == req.user.userId`
- Leads and knowledge operations always filter by that `client_id`.

### 6) Chat flow

- `/api/chat` validates body via Zod.
- Messages are sanitized to only `user`/`assistant` roles and max length.
- Optional `client_id` is resolved from:
  - body `client_id`
  - `metadata.client_id`
  - query `client_id`
- Base knowledge (`data/kufu_knowledge.md`) + client knowledge (from `client_knowledge`) are merged into system prompt.
- OpenAI completion is generated and returned.
- Chat turn is logged to `chats_ai.jsonl`.
- Heuristic lead detection extracts email/phone/demo intent and upserts into `leads`.

### 7) Data and logging

- JSONL append-only files are used for lead/chat audit logs.
- `createDataStore` handles directory creation and line append writes.
- Knowledge file is loaded once on startup for prompt usage.

## File Map (What Each File Does)

### Root files

| Path | Purpose |
|---|---|
| `package.json` | Backend scripts and dependency definitions. |
| `tsconfig.json` | TypeScript compiler config. |
| `.env.example` | Required env variable template. |
| `.gitignore` | Ignore rules for build/env data. |
| `vercel.json` | Vercel backend/serverless routing config. |
| `supabase.sql` | Schema + indexes + RLS helper functions + policies. |
| `api/index.ts` | Vercel serverless entrypoint that imports Express app. |
| `README.md` | This architecture and usage guide. |

### Runtime and config

| Path | Purpose |
|---|---|
| `src/index.ts` | App bootstrap, middleware wiring, `/api` mount, global error handler, server start. |
| `src/config/runtime.ts` | Env loading, runtime flags, OpenAI client, Supabase admin client, CORS origins. |

### Route modules

| Path | Purpose |
|---|---|
| `src/routes/api.ts` | Main API router composition and chat/leads endpoints. |
| `src/routes/auth.ts` | Register, verify, login, me, logout endpoints with rate limiting. |
| `src/routes/dashboard.ts` | Protected metrics/leads/knowledge/widget routes with tenant checks. |

### Library modules

| Path | Purpose |
|---|---|
| `src/lib/supabase.ts` | Creates Supabase admin client from URL/service key. |
| `src/lib/jwt.ts` | JWT sign/verify helpers for app session tokens. |
| `src/lib/auth-middleware.ts` | Bearer/cookie token parsing and authenticated request population. |
| `src/lib/authSession.ts` | Session cookie utilities and token extraction helpers (legacy-compatible utility module). |
| `src/lib/mailer.ts` | Nodemailer transporter and verification email sender. |
| `src/lib/corsOrigins.ts` | CORS wildcard-aware origin allowlist checker and handler factory. |
| `src/lib/validation.ts` | Shared validators and normalization helpers. |
| `src/lib/http.ts` | Request IP, timestamp, hashing, and Zod validation error response helpers. |
| `src/lib/knowledge.ts` | Loads markdown knowledge file from known paths. |
| `src/lib/systemPrompt.ts` | Builds final system prompt with policy + knowledge text. |
| `src/lib/sanitizeMessages.ts` | Cleans and role-filters chat messages before OpenAI call. |
| `src/lib/dataStore.ts` | Ensures data directory, appends JSONL rows, caches knowledge text. |

### Validation schemas

| Path | Purpose |
|---|---|
| `src/schemas/auth.ts` | Zod schemas for auth register/login/verify payloads. |
| `src/schemas/dashboard.ts` | Zod schemas for dashboard query/body payloads. |
| `src/schemas/api.ts` | Zod schemas for leads/contact/chat/chat-log payloads. |

### Data files

| Path | Purpose |
|---|---|
| `data/kufu_knowledge.md` | Base AI knowledge injected into prompt. |
| `data/leads_demo.jsonl` | Demo form submission audit log (append-only). |
| `data/leads_contact.jsonl` | Contact form submission audit log (append-only). |
| `data/chats.jsonl` | Chat transcript logs (append-only). |
| `data/chats_ai.jsonl` | AI chat completion logs including metadata/model (append-only). |

## API Surface

### Health

- `GET /api/health`

### Auth

- `POST /api/auth/register`
- `POST /api/auth/verify-email`
- `GET /api/auth/verify`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`

### Dashboard (requires Bearer token)

- `GET /api/dashboard/metrics`
- `GET /api/dashboard/leads`
- `PATCH /api/dashboard/leads/:id`
- `GET /api/dashboard/knowledge`
- `POST /api/dashboard/knowledge`

### Widget

- `GET /api/widget/config`

### Chat and leads

- `POST /api/chat`
- `POST /api/chat/log`
- `POST /api/leads/demo`
- `POST /api/leads/contact`

## Database Schema Requirements

Run `supabase.sql` in Supabase SQL Editor.

Important columns used by code:
- `clients.plan` is required by auth/dashboard/widget responses.
- `client_knowledge.client_id` must be unique for knowledge upsert conflict target.

If schema drift happens, re-run `supabase.sql` or apply equivalent migrations.

## Security Model Notes

- Service role key stays server-side only.
- Authenticated dashboard routes enforce ownership in backend even with service-role privileges.
- RLS policies are included in `supabase.sql` for defense in depth.
- Auth endpoints include basic in-memory rate limiting (sufficient for MVP/dev; use Redis-based limiter in production).
