-- 006_whatsapp_automation.sql
-- Run in Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists public.whatsapp_integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  chatbot_id uuid not null references public.chatbots(id) on delete cascade,
  phone_number_id text not null unique,
  business_account_id text,
  display_phone_number text,
  access_token text not null,
  verify_token text not null unique,
  webhook_secret text,
  is_active boolean not null default true,
  last_inbound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_phone_number_id_not_blank check (length(trim(phone_number_id)) > 0),
  constraint whatsapp_verify_token_not_blank check (length(trim(verify_token)) > 0)
);

create unique index if not exists whatsapp_integrations_user_unique_idx
  on public.whatsapp_integrations (user_id);

create unique index if not exists whatsapp_integrations_chatbot_unique_idx
  on public.whatsapp_integrations (chatbot_id);

create index if not exists whatsapp_integrations_client_idx
  on public.whatsapp_integrations (client_id);

create index if not exists whatsapp_integrations_phone_idx
  on public.whatsapp_integrations (phone_number_id);

create index if not exists whatsapp_integrations_created_at_idx
  on public.whatsapp_integrations (created_at desc);

alter table public.whatsapp_integrations enable row level security;

drop policy if exists whatsapp_integrations_owner_all on public.whatsapp_integrations;
create policy whatsapp_integrations_owner_all on public.whatsapp_integrations
for all
using (user_id = public.current_request_user_id())
with check (user_id = public.current_request_user_id());
