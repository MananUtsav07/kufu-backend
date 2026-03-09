# DB Index Audit

This document tracks index additions from Phase 3 (performance and scale readiness).

## Query hotspots reviewed

- `GET /api/dashboard/summary`
  - `tickets` filtered by `user_id` + `status`.
- `GET /api/dashboard/leads`
  - `leads` filtered by `client_id` and optional `status`, ordered by `created_at desc`.
- `GET /api/admin/messages`
  - `chatbot_messages` filtered by `user_id` or `chatbot_id`, ordered by `created_at desc`.
- `GET /api/dashboard/chat-history/:chatbotId`
  - `chat_messages` filtered by `chatbot_id` + optional `lead_captured`, ordered by `created_at desc`.
- `GET /api/admin/quotes`
  - `custom_quotes` filtered by optional `status`, ordered by `created_at desc`.
- `GET /api/admin/users`
  - `users` ordered by `created_at desc`.

## Index migration

Applied in:
- `supabase/migrations/008_performance_indexes.sql`

Indexes added:

- `tickets_user_status_created_idx` on `(user_id, status, created_at desc)`
- `leads_client_status_created_idx` on `(client_id, status, created_at desc)`
- `leads_client_created_idx` on `(client_id, created_at desc)`
- `chatbot_messages_user_created_idx` on `(user_id, created_at desc)`
- `chatbot_messages_chatbot_created_idx` on `(chatbot_id, created_at desc)`
- `chat_messages_chatbot_lead_created_idx` on `(chatbot_id, lead_captured, created_at desc)`
- `custom_quotes_status_created_idx` on `(status, created_at desc)`
- `users_created_at_desc_idx` on `(created_at desc)`

## Remaining potential hotspots

- Text-heavy `ILIKE` search on chat history can still degrade at very large scale. If needed, move to full-text search/trigram strategy per workload profile.
- Message export endpoint (`/api/admin/messages/export`) is capped but still can be expensive on very large datasets.
- Any analytics endpoints that aggregate over long unbounded windows should be monitored and potentially pre-aggregated later.
