# Performance Notes

This document summarizes Phase 3 performance and scale-readiness changes.

## Frontend

### Route-level code splitting

Updated `src/App.tsx` to lazy-load large routes with `React.lazy` + `Suspense`:

- Dashboard routes/pages
- Admin routes/pages
- Auth and secondary marketing pages
- Widget page
- Floating chat component

Home route remains eagerly loaded for fastest first paint.

### Request deduplication (GET)

Updated `src/lib/api.ts` to deduplicate in-flight identical GET requests using an in-memory pending map keyed by URL and auth context. This reduces duplicate fetches from nested mounts and rapid route transitions.

## Backend

### Low-churn endpoint caching

Added `src/lib/cache.ts` (TTL cache with in-flight promise dedupe).

Applied caching in `src/routes/widget.ts`:

- `GET /api/widget/config?key=...`
  - in-memory TTL cache: 2 minutes
  - HTTP header: `Cache-Control: public, max-age=60, stale-while-revalidate=120`
- `GET /widget/kufu.js?key=...`
  - in-memory TTL cache: 5 minutes
  - HTTP header: `Cache-Control: public, max-age=300, stale-while-revalidate=300`

### Hot-path service optimization

Updated `src/services/subscriptionService.ts`:

- Added plan metadata caching (`loadPlanByCode`) with 5-minute TTL.
- Removed redundant period-roll calls after `ensureSubscription` in usage checks.

Updated `src/routes/chat.ts`:

- Removed duplicate plan-limit checks in the same request path.
- Removed redundant plan reload after usage increment.

### Pagination hardening for heavy admin lists

Updated `src/routes/admin.ts` and `src/schemas/admin.ts`:

- `GET /api/admin/users` now supports `limit`/`offset`
- `GET /api/admin/tickets` now supports `limit`/`offset`/`status`
- `GET /api/admin/quotes` now supports `limit`/`offset`/`status`

Frontend admin pages were updated to consume paginated responses.

## Database

Added index migration:

- `supabase/migrations/008_performance_indexes.sql`

See `docs/DB_INDEX_AUDIT.md` for detailed rationale.

## Operational guidance

- Apply migration `008_performance_indexes.sql` before high-traffic rollout.
- Monitor cache hit rate and response latency on widget routes.
- Keep TTLs short for widget config/script to balance freshness and load.
- For very large exports/analytics, consider async jobs and pre-aggregation in a future phase.
