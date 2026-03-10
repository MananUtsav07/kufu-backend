-- 010_website_integrations.sql
-- Stores website platform detection metadata for dashboard installation guidance.

create extension if not exists pgcrypto;

create table if not exists public.website_integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  chatbot_id uuid references public.chatbots(id) on delete cascade,
  website_url text not null,
  detected_type text not null default 'unknown',
  detection_confidence text not null default 'low',
  detection_signals jsonb not null default '[]'::jsonb,
  last_detected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint website_integrations_type_check check (
    detected_type in (
      'wordpress',
      'shopify',
      'react',
      'nextjs',
      'webflow',
      'wix',
      'squarespace',
      'custom',
      'unknown'
    )
  ),
  constraint website_integrations_confidence_check check (
    detection_confidence in ('high', 'medium', 'low')
  )
);

create index if not exists website_integrations_user_detected_idx
  on public.website_integrations (user_id, last_detected_at desc);

create index if not exists website_integrations_chatbot_detected_idx
  on public.website_integrations (chatbot_id, last_detected_at desc);

create index if not exists website_integrations_type_idx
  on public.website_integrations (detected_type);

create unique index if not exists website_integrations_user_chatbot_unique_idx
  on public.website_integrations (user_id, chatbot_id)
  where chatbot_id is not null;

alter table public.website_integrations enable row level security;

drop policy if exists website_integrations_owner_all on public.website_integrations;
create policy website_integrations_owner_all on public.website_integrations
for all
using (user_id = public.current_request_user_id())
with check (user_id = public.current_request_user_id());
