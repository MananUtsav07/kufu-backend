# Pre-Deploy Checklist

Use this checklist before every production release.

## 1) Environment and Secrets

- [ ] Backend `NODE_ENV` is set to `production`.
- [ ] Backend `FRONTEND_URL`, `BACKEND_BASE_URL`, and `ALLOWED_ORIGINS` are correct for production.
- [ ] Backend database/auth/env secrets are present:
  - [ ] `SUPABASE_URL`
  - [ ] `SUPABASE_SERVICE_ROLE_KEY`
  - [ ] `JWT_SECRET`
- [ ] Backend email/OpenAI/WhatsApp secrets are present (as used by this release).
- [ ] Frontend `VITE_API_BASE_URL` points to the production backend.
- [ ] No secrets are committed in git.

## 2) Database and Migrations

- [ ] Migrations from `supabase/migrations` were applied in order.
- [ ] `npm run verify-schema` passes against the target environment (or `npm run verify-schema:offline` for local CI safety checks).
- [ ] Recent DB backup/snapshot exists before migration rollout.

## 3) Quality Gates

Backend:
- [ ] `npm run typecheck`
- [ ] `npm run test`
- [ ] `npm run build`

Frontend:
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run test`
- [ ] `npm run build`

CI:
- [ ] GitHub Actions checks are green for frontend and backend.

## 4) Staging/Smoke Validation

- [ ] Auth flow works (register/login/me/logout).
- [ ] Dashboard and admin protected routes enforce role checks.
- [ ] Chat endpoint works and returns safe error envelopes on failures.
- [ ] Lead/demo/contact forms submit successfully.
- [ ] WhatsApp webhook verification and callbacks pass basic sanity checks (if enabled).

## 5) Runtime and Monitoring

- [ ] Render deploy health checks pass (`/api/health`).
- [ ] Request logs include `requestId` and expected metadata.
- [ ] Alerts/monitoring are enabled for 5xx rates and latency spikes.
- [ ] Team on-call owner is assigned for release window.

## 6) Post-Deploy Verification

- [ ] Validate key user journeys from production UI.
- [ ] Confirm no immediate increase in auth/chat/dashboard error rates.
- [ ] Confirm no migration/schema errors in backend logs.
