# Supabase Migrations

Canonical migration path for the backend is:

`supabase/migrations`

Apply migrations in numeric order:

1. `001_plans_subscriptions.sql`
2. `002_rag.sql`
3. `003_uploads_and_admin_plans.sql`
4. `004_chat_history_analytics_settings.sql`
5. `005_custom_quote_monthly_messages.sql`
6. `006_whatsapp_automation.sql`
7. `007_whatsapp_embedded_signup.sql`
8. `008_performance_indexes.sql`
9. `009_backfill_chatbot_client_id.sql`
10. `010_website_integrations.sql`

Before every deploy run:

```bash
npm run verify-schema
```

This verifies all required tables/columns and required storage buckets used by the current codebase.
