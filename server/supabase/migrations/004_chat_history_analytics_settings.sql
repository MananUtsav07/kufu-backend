-- 004_chat_history_analytics_settings.sql
-- Run in Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  chatbot_id uuid not null references public.chatbots(id) on delete cascade,
  visitor_id text not null,
  user_message text not null,
  bot_response text not null,
  lead_captured boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_chatbot_created_idx
  on public.chat_messages (chatbot_id, created_at desc);

create index if not exists chat_messages_chatbot_visitor_idx
  on public.chat_messages (chatbot_id, visitor_id);

create index if not exists chat_messages_chatbot_lead_idx
  on public.chat_messages (chatbot_id, lead_captured);

create index if not exists chat_messages_text_search_idx
  on public.chat_messages
  using gin (
    to_tsvector(
      'simple',
      coalesce(user_message, '') || ' ' || coalesce(bot_response, '')
    )
  );

create table if not exists public.chatbot_settings (
  id uuid primary key default gen_random_uuid(),
  chatbot_id uuid not null unique references public.chatbots(id) on delete cascade,
  bot_name text not null,
  greeting_message text not null,
  primary_color text not null,
  updated_at timestamptz not null default now()
);

create index if not exists chatbot_settings_chatbot_idx
  on public.chatbot_settings (chatbot_id);

alter table public.chat_messages enable row level security;
alter table public.chatbot_settings enable row level security;

drop policy if exists chat_messages_owner_all on public.chat_messages;
create policy chat_messages_owner_all on public.chat_messages
for all
using (
  exists (
    select 1
    from public.chatbots c
    where c.id = chat_messages.chatbot_id
      and c.user_id = public.current_request_user_id()
  )
)
with check (
  exists (
    select 1
    from public.chatbots c
    where c.id = chat_messages.chatbot_id
      and c.user_id = public.current_request_user_id()
  )
);

drop policy if exists chatbot_settings_owner_all on public.chatbot_settings;
create policy chatbot_settings_owner_all on public.chatbot_settings
for all
using (
  exists (
    select 1
    from public.chatbots c
    where c.id = chatbot_settings.chatbot_id
      and c.user_id = public.current_request_user_id()
  )
)
with check (
  exists (
    select 1
    from public.chatbots c
    where c.id = chatbot_settings.chatbot_id
      and c.user_id = public.current_request_user_id()
  )
);
