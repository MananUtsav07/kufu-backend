# Required Schema Checklist

This checklist reflects schema objects currently queried by `src/` code.
Use it with `npm run verify-schema` before deploys.

## Core auth and tenant data

- `users`
  - `id`, `email`, `password_hash`, `is_verified`, `role`, `created_at`
- `clients`
  - `id`, `user_id`, `business_name`, `website_url`, `plan`, `knowledge_base_text`
- `email_verification_tokens`
  - `id`, `user_id`, `email`, `token`, `expires_at`, `created_at`

## Plans and usage

- `plans`
  - `id`, `code`, `name`, `monthly_message_cap`, `chatbot_limit`, `price_inr`, `is_active`
- `subscriptions`
  - `id`, `user_id`, `plan_code`, `status`, `current_period_start`, `current_period_end`, `message_count_in_period`, `total_message_count`, `updated_at`

## Chatbot and messaging

- `chatbots`
  - `id`, `user_id`, `client_id`, `name`, `website_url`, `allowed_domains`, `widget_public_key`, `logo_path`, `is_active`, `created_at`, `updated_at`
- `chatbot_messages`
  - `id`, `user_id`, `chatbot_id`, `session_id`, `role`, `content`, `tokens_estimate`, `created_at`
- `chat_messages` (history analytics table)
  - `id`, `chatbot_id`, `visitor_id`, `user_message`, `bot_response`, `lead_captured`, `created_at`
- `chatbot_settings`
  - `id`, `chatbot_id`, `bot_name`, `greeting_message`, `primary_color`, `updated_at`

## Knowledge and RAG

- `client_knowledge`
  - `id`, `client_id`, `services_text`, `pricing_text`, `faqs_json`, `hours_text`, `contact_text`, `updated_at`
- `rag_pages`
  - `id`, `chatbot_id`, `url`, `title`, `content_text`, `content_hash`, `status`, `http_status`, `updated_at`
- `rag_chunks`
  - `id`, `chatbot_id`, `page_id`, `chunk_index`, `chunk_text`, `embedding`, `token_estimate`, `created_at`
- `rag_ingestion_runs`
  - `id`, `chatbot_id`, `status`, `pages_found`, `pages_crawled`, `chunks_written`, `cancel_requested`, `started_at`, `finished_at`, `updated_at`

## Leads and dashboard support

- `leads`
  - `id`, `client_id`, `name`, `email`, `phone`, `need`, `status`, `source`, `created_at`
- `tickets`
  - `id`, `user_id`, `subject`, `message`, `admin_response`, `status`, `created_at`, `updated_at`
- `custom_quotes`
  - `id`, `user_id`, `requested_plan`, `requested_chatbots`, `requested_monthly_messages`, `requested_unlimited_messages`, `notes`, `status`, `admin_response`, `created_at`, `updated_at`
- `audit_logs`
  - `id`, `actor_user_id`, `action`, `metadata`, `created_at`

## Upload metadata

- `kb_files`
  - `id`, `chatbot_id`, `user_id`, `filename`, `mime_type`, `storage_path`, `file_size`, `created_at`

## WhatsApp automation

- `whatsapp_integrations`
  - `id`, `user_id`, `client_id`, `chatbot_id`, `phone_number_id`, `access_token`, `verify_token`, `is_active`, `status`, `webhook_subscribed`, `updated_at`
- `whatsapp_onboarding_logs`
  - `id`, `integration_id`, `user_id`, `client_id`, `chatbot_id`, `event_type`, `payload`, `created_at`

## Storage buckets

- `kufu-logos` (private)
- `kufu-kb-docs` (private)

## Canonical migration path

- `supabase/migrations`

Do not run SQL from `server/supabase/migrations` (deprecated snapshot path).
