# Rollback Plan

Use this procedure when a production release causes user-facing breakage.

## 1) Rollback Triggers

Trigger rollback when one or more of these happens after deploy:
- sustained 5xx errors on auth/chat/dashboard/admin routes
- severe login failures or token validation failures
- migration-related runtime errors
- critical frontend route crashes on key pages

## 2) Frontend Rollback (Vercel)

1. Open Vercel project deployments.
2. Promote the previous known-good deployment.
3. Re-check:
   - `/login`
   - `/dashboard`
   - `/admin` (admin account)
   - `/demo` and `/contact`

## 3) Backend Rollback (Render)

1. Open Render service deploy history.
2. Roll back to previous known-good deploy.
3. Verify:
   - `/api/health`
   - `/api/auth/login`
   - `/api/auth/me`
   - `/api/dashboard/summary`
   - `/api/chat`

## 4) Database Rollback Strategy

Prefer **forward-fix** migrations for schema issues. If rollback is required:

1. Stop/write-protect critical paths (temporary feature flag or route guard) if possible.
2. Restore database backup/snapshot taken pre-deploy.
3. Re-deploy backend version compatible with restored schema.
4. Run `npm run verify-schema` against restored DB.

## 5) Fast Feature Kill Switches

If full rollback is not needed:
- Disable webhook ingestion routes at edge/firewall if webhook storm is the issue.
- Temporarily disable optional integrations by env/config (e.g. WhatsApp/onboarding) while keeping core auth/dashboard online.
- Keep chat endpoint online with reduced dependency mode (safe fallback response) if OpenAI/provider errors spike.

## 6) After Rollback

- Confirm key journeys pass on production.
- Confirm error rates return to baseline.
- Document incident timeline and root cause.
- Prepare hotfix and validate in staging before re-release.
