-- 007_whatsapp_embedded_signup.sql
-- Run in Supabase SQL editor.

alter table public.whatsapp_integrations
  add column if not exists whatsapp_business_account_id text,
  add column if not exists business_phone_number_id text,
  add column if not exists phone_number text,
  add column if not exists status text not null default 'pending',
  add column if not exists onboarding_payload jsonb not null default '{}'::jsonb,
  add column if not exists webhook_subscribed boolean not null default false;

alter table public.whatsapp_integrations
  drop constraint if exists whatsapp_integrations_status_check;

alter table public.whatsapp_integrations
  add constraint whatsapp_integrations_status_check
  check (status in ('pending', 'connecting', 'connected', 'failed'));

update public.whatsapp_integrations
set
  whatsapp_business_account_id = coalesce(whatsapp_business_account_id, business_account_id),
  business_phone_number_id = coalesce(business_phone_number_id, phone_number_id),
  phone_number = coalesce(phone_number, display_phone_number),
  status = case when is_active then 'connected' else status end
where true;

create table if not exists public.whatsapp_onboarding_logs (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid references public.whatsapp_integrations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  chatbot_id uuid references public.chatbots(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists whatsapp_onboarding_logs_integration_idx
  on public.whatsapp_onboarding_logs (integration_id);

create index if not exists whatsapp_onboarding_logs_user_idx
  on public.whatsapp_onboarding_logs (user_id);

create index if not exists whatsapp_onboarding_logs_created_at_idx
  on public.whatsapp_onboarding_logs (created_at desc);

alter table public.whatsapp_onboarding_logs enable row level security;

drop policy if exists whatsapp_onboarding_logs_owner_all on public.whatsapp_onboarding_logs;
create policy whatsapp_onboarding_logs_owner_all on public.whatsapp_onboarding_logs
for all
using (user_id = public.current_request_user_id())
with check (user_id = public.current_request_user_id());
