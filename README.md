# Kufu Backend

Express + TypeScript API for Kufu.

Primary responsibilities:

- custom JWT auth
- dashboard and admin APIs
- chat and lead capture
- RAG ingestion and retrieval
- WhatsApp onboarding and webhooks
- email notifications (Brevo)

## Tech

- Node.js, Express 5, TypeScript
- Supabase Postgres (`@supabase/supabase-js`, service role on server only)
- OpenAI SDK
- Zod validation
- Helmet, CORS allowlist, rate limiting
- Vitest + Supertest integration tests

## Canonical migration path

Use only:

`supabase/migrations`

Do not execute SQL from `server/supabase/migrations` (deprecated snapshot path).

## Scripts

- `npm run dev` - watch mode (`src/index.ts`)
- `npm run typecheck` - TypeScript check
- `npm run test` - backend integration tests
- `npm run test:watch` - test watch mode
- `npm run build` - compile TypeScript
- `npm run start` - run compiled app
- `npm run verify-schema` - online schema and bucket verification
- `npm run verify-schema:offline` - migration file sanity check for CI
- `npm run smoke-test` - script-level API smoke run

## Setup

1. `npm install`
2. copy `.env.example` to `.env` and fill values
3. apply SQL migrations from `supabase/migrations` in numeric order
4. run `npm run verify-schema` (or `npm run verify-schema:offline` in CI without DB access)
5. start server with `npm run dev`

## Environment variables

See `.env.example` for the full list.

Groups:

- runtime: `NODE_ENV`, `PORT`, `DATA_DIR`, `DEV_BYPASS_EMAIL_VERIFY`
- CORS and URLs: `FRONTEND_URL`, `BACKEND_BASE_URL`, `ALLOWED_ORIGINS`
- database: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- auth: `JWT_SECRET`
- email: `BREVO_API_KEY`, `EMAIL_FROM`, `DEMO_LEAD_NOTIFY_EMAIL`, `CONTACT_LEAD_NOTIFY_EMAIL`
- OpenAI: `OPENAI_API_KEY`, `OPENAI_MODEL`
- WhatsApp and Meta: `WHATSAPP_GRAPH_API_VERSION`, `META_*`
- optional crawler tuning: `ENABLE_PLAYWRIGHT`, `RAG_JS_RENDER_TIMEOUT_MS`, `JINA_API_KEY`

## API route groups

Mounted under `/api`:

- `/health`
- `/auth/*`
- `/dashboard/*`
- `/admin/*`
- `/chat`, `/chat/log`
- `/widget/*`
- `/chatbot/*`
- `/rag/*`
- `/whatsapp/*`
- `/leads/demo`, `/leads/contact`

Full request and response examples: `docs/API_ROUTES.md`.

## CI gates

GitHub Actions (`.github/workflows/ci.yml`) runs on push and PR:

- typecheck
- tests
- build
- `verify-schema:offline`
- optional `verify-schema` online when Supabase secrets are configured

## Docs

- `docs/API_ROUTES.md`
- `docs/DEPLOYMENT.md`
- `docs/REQUIRED_SCHEMA.md`
- `docs/PRE_DEPLOY_CHECKLIST.md`
- `docs/ROLLBACK_PLAN.md`
- `supabase/migrations/README.md`
