-- 008_performance_indexes.sql
-- Query-path indexes for dashboard/admin/chat performance.

-- Dashboard summary and user ticket views frequently filter by user and status.
create index if not exists tickets_user_status_created_idx
  on public.tickets (user_id, status, created_at desc);

-- Dashboard lead lists filter by client and optional status, sorted by created_at.
create index if not exists leads_client_status_created_idx
  on public.leads (client_id, status, created_at desc);

create index if not exists leads_client_created_idx
  on public.leads (client_id, created_at desc);

-- Admin and dashboard message lists filter by user/chatbot and sort by created_at.
create index if not exists chatbot_messages_user_created_idx
  on public.chatbot_messages (user_id, created_at desc);

create index if not exists chatbot_messages_chatbot_created_idx
  on public.chatbot_messages (chatbot_id, created_at desc);

-- Chat history filters often include lead flag plus created_at sorting.
create index if not exists chat_messages_chatbot_lead_created_idx
  on public.chat_messages (chatbot_id, lead_captured, created_at desc);

-- Admin quote list filtering by status and recency.
create index if not exists custom_quotes_status_created_idx
  on public.custom_quotes (status, created_at desc);

-- Admin user list sorted by account creation date.
create index if not exists users_created_at_desc_idx
  on public.users (created_at desc);
