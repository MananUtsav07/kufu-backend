-- 001_plans_subscriptions.sql
-- Run in Supabase SQL editor.

create extension if not exists pgcrypto;

-- users role support
alter table public.users
  add column if not exists role text not null default 'user';

alter table public.users
  drop constraint if exists users_role_check;

alter table public.users
  add constraint users_role_check check (role in ('user', 'admin'));

alter table public.users
  alter column email set not null;

create unique index if not exists users_email_unique_idx on public.users (email);

-- clients additions
alter table public.clients
  add column if not exists plan text not null default 'free',
  add column if not exists knowledge_base_text text;

alter table public.clients
  alter column knowledge_base_text set default '';

-- token hardening
alter table public.email_verification_tokens
  alter column token set not null,
  alter column expires_at set not null;

create unique index if not exists email_verification_tokens_token_unique_idx
  on public.email_verification_tokens (token);

create index if not exists email_verification_tokens_user_id_idx
  on public.email_verification_tokens (user_id);

create index if not exists email_verification_tokens_email_idx
  on public.email_verification_tokens (email);

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  monthly_message_cap integer,
  chatbot_limit integer,
  price_inr integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  plan_code text not null references public.plans(code),
  status text not null default 'active',
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  message_count_in_period integer not null default 0,
  total_message_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_status_check check (status in ('active', 'paused', 'canceled', 'past_due'))
);

create unique index if not exists subscriptions_user_unique_idx on public.subscriptions (user_id);
create index if not exists subscriptions_plan_code_idx on public.subscriptions (plan_code);
create index if not exists subscriptions_period_end_idx on public.subscriptions (current_period_end);

create table if not exists public.chatbots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  name text not null,
  website_url text,
  allowed_domains text[] not null default '{}',
  widget_public_key text not null unique,
  branding jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chatbots_user_id_idx on public.chatbots (user_id);
create index if not exists chatbots_client_id_idx on public.chatbots (client_id);
create index if not exists chatbots_created_at_idx on public.chatbots (created_at desc);

create table if not exists public.chatbot_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  chatbot_id uuid not null references public.chatbots(id) on delete cascade,
  session_id text not null,
  role text not null,
  content text not null,
  tokens_estimate integer not null default 0,
  created_at timestamptz not null default now(),
  constraint chatbot_messages_role_check check (role in ('user', 'assistant'))
);

create index if not exists chatbot_messages_user_id_idx on public.chatbot_messages (user_id);
create index if not exists chatbot_messages_chatbot_id_idx on public.chatbot_messages (chatbot_id);
create index if not exists chatbot_messages_session_id_idx on public.chatbot_messages (session_id);
create index if not exists chatbot_messages_created_at_idx on public.chatbot_messages (created_at desc);

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  subject text not null,
  message text not null,
  admin_response text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tickets_status_check check (status in ('open', 'closed'))
);

create index if not exists tickets_user_id_idx on public.tickets (user_id);
create index if not exists tickets_status_idx on public.tickets (status);
create index if not exists tickets_created_at_idx on public.tickets (created_at desc);

create table if not exists public.custom_quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  requested_plan text,
  requested_chatbots integer,
  requested_unlimited_messages boolean not null default false,
  notes text,
  status text not null default 'pending',
  admin_response text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint custom_quotes_status_check check (status in ('pending', 'responded', 'closed', 'approved'))
);

create index if not exists custom_quotes_user_id_idx on public.custom_quotes (user_id);
create index if not exists custom_quotes_status_idx on public.custom_quotes (status);
create index if not exists custom_quotes_created_at_idx on public.custom_quotes (created_at desc);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.users(id) on delete set null,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_actor_user_id_idx on public.audit_logs (actor_user_id);
create index if not exists audit_logs_created_at_idx on public.audit_logs (created_at desc);

insert into public.plans (code, name, monthly_message_cap, chatbot_limit, price_inr, is_active)
values
  ('free', 'Free', 10, 1, 0, true),
  ('starter', 'Starter', 1000, 1, 1999, true),
  ('pro', 'Pro', 10000, 1, 3999, true),
  ('business', 'Business', null, 10, 7999, true)
on conflict (code) do update
set
  name = excluded.name,
  monthly_message_cap = excluded.monthly_message_cap,
  chatbot_limit = excluded.chatbot_limit,
  price_inr = excluded.price_inr,
  is_active = excluded.is_active;

-- helper for future Supabase Auth based RLS adoption
create or replace function public.current_request_user_id()
returns uuid
language plpgsql
stable
as $$
declare
  raw_sub text;
  claims jsonb;
begin
  raw_sub := nullif(current_setting('request.jwt.claim.sub', true), '');

  if raw_sub is null then
    begin
      claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
      raw_sub := nullif(claims ->> 'sub', '');
    exception
      when others then
        raw_sub := null;
    end;
  end if;

  if raw_sub is null then
    return null;
  end if;

  begin
    return raw_sub::uuid;
  exception
    when others then
      return null;
  end;
end;
$$;

alter table public.users enable row level security;
alter table public.clients enable row level security;
alter table public.email_verification_tokens enable row level security;
alter table public.client_knowledge enable row level security;
alter table public.leads enable row level security;
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.chatbots enable row level security;
alter table public.chatbot_messages enable row level security;
alter table public.tickets enable row level security;
alter table public.custom_quotes enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists users_self_select on public.users;
create policy users_self_select on public.users
for select
using (id = public.current_request_user_id());

drop policy if exists users_self_update on public.users;
create policy users_self_update on public.users
for update
using (id = public.current_request_user_id())
with check (id = public.current_request_user_id());

drop policy if exists clients_owner_select on public.clients;
create policy clients_owner_select on public.clients
for select
using (user_id = public.current_request_user_id());

drop policy if exists clients_owner_update on public.clients;
create policy clients_owner_update on public.clients
for update
using (user_id = public.current_request_user_id())
with check (user_id = public.current_request_user_id());

drop policy if exists verification_tokens_owner_select on public.email_verification_tokens;
create policy verification_tokens_owner_select on public.email_verification_tokens
for select
using (user_id = public.current_request_user_id());

drop policy if exists verification_tokens_owner_update on public.email_verification_tokens;
create policy verification_tokens_owner_update on public.email_verification_tokens
for all
using (user_id = public.current_request_user_id())
with check (user_id = public.current_request_user_id());

drop policy if exists client_knowledge_owner_all on public.client_knowledge;
create policy client_knowledge_owner_all on public.client_knowledge
for all
using (
  exists (
    select 1 from public.clients c
    where c.id = client_knowledge.client_id
      and c.user_id = public.current_request_user_id()
  )
)
with check (
  exists (
    select 1 from public.clients c
    where c.id = client_knowledge.client_id
      and c.user_id = public.current_request_user_id()
  )
);

drop policy if exists leads_owner_all on public.leads;
create policy leads_owner_all on public.leads
for all
using (
  exists (
    select 1 from public.clients c
    where c.id = leads.client_id
      and c.user_id = public.current_request_user_id()
  )
)
with check (
  exists (
    select 1 from public.clients c
    where c.id = leads.client_id
      and c.user_id = public.current_request_user_id()
  )
);

drop policy if exists plans_public_read on public.plans;
create policy plans_public_read on public.plans
for select
using (true);

drop policy if exists subscriptions_owner_all on public.subscriptions;
create policy subscriptions_owner_all on public.subscriptions
for all
using (user_id = public.current_request_user_id())
with check (user_id = public.current_request_user_id());

drop policy if exists chatbots_owner_all on public.chatbots;
create policy chatbots_owner_all on public.chatbots
for all
using (user_id = public.current_request_user_id())
with check (user_id = public.current_request_user_id());

drop policy if exists chatbot_messages_owner_all on public.chatbot_messages;
create policy chatbot_messages_owner_all on public.chatbot_messages
for all
using (user_id = public.current_request_user_id())
with check (user_id = public.current_request_user_id());

drop policy if exists tickets_owner_all on public.tickets;
create policy tickets_owner_all on public.tickets
for all
using (user_id = public.current_request_user_id())
with check (user_id = public.current_request_user_id());

drop policy if exists custom_quotes_owner_all on public.custom_quotes;
create policy custom_quotes_owner_all on public.custom_quotes
for all
using (user_id = public.current_request_user_id())
with check (user_id = public.current_request_user_id());

-- no direct client access to audit logs
