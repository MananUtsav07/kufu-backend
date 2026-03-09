# Backend Deployment

## 1) Pre-deploy quality gates

Run before release:

```bash
npm run typecheck
npm run test
npm run build
npm run verify-schema
```

If CI or local checks cannot reach Supabase, run offline sanity:

```bash
npm run verify-schema:offline
```

Optional API smoke test:

```bash
npm run smoke-test
```

## 2) Database migrations

Apply SQL files from canonical path only:

`supabase/migrations`

Run in strict numeric order (`001` to latest, currently `008`).

## 3) Environment configuration

Set these in Render:

- `NODE_ENV=production`
- `PORT`
- `FRONTEND_URL`
- `BACKEND_BASE_URL`
- `ALLOWED_ORIGINS` (comma-separated explicit origins)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET`
- `BREVO_API_KEY`
- `EMAIL_FROM`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `WHATSAPP_GRAPH_API_VERSION`
- `META_APP_ID`
- `META_APP_SECRET`
- `META_VERIFY_TOKEN`
- `META_GRAPH_API_VERSION`
- `META_REDIRECT_URI`
- `META_EMBEDDED_SIGNUP_CONFIG_ID`

Optional:

- `DEMO_LEAD_NOTIFY_EMAIL`
- `CONTACT_LEAD_NOTIFY_EMAIL`
- `DEFAULT_WIDGET_LOGO_PATH`
- `DEFAULT_WIDGET_LOGO_URL`
- `DATA_DIR`
- `ENABLE_PLAYWRIGHT`
- `RAG_JS_RENDER_TIMEOUT_MS`
- `JINA_API_KEY`
- `WHATSAPP_WEBHOOK_ALLOWED_IPS`

## 4) CORS policy

- Use explicit origins in `ALLOWED_ORIGINS`.
- Do not use wildcard origins in production.
- Include exact frontend production URLs and required staging URLs.

Example:

`ALLOWED_ORIGINS=https://kufu-frontend.vercel.app,https://staging-kufu-frontend.vercel.app`

## 5) CI requirements

Backend CI (`.github/workflows/ci.yml`) must be green before deploy:

- typecheck
- tests
- build
- schema verify offline

Optional online schema verify runs when these GitHub secrets are present:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## 6) Post-deploy validation

1. `GET /api/health`
2. `POST /api/auth/login`
3. `GET /api/auth/me` with token
4. `POST /api/chat`
5. `GET /api/dashboard/summary`
6. `GET /api/whatsapp/webhook` verification query

## 7) Release safety links

- `docs/PRE_DEPLOY_CHECKLIST.md`
- `docs/ROLLBACK_PLAN.md`
