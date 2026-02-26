-- Kufu multi-tenant schema + RLS
-- Run this file in Supabase SQL Editor.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  is_verified boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  business_name text not null,
  website_url text,
  plan text not null default 'starter',
  created_at timestamptz not null default now()
);

create index if not exists idx_clients_user_id on public.clients(user_id);

create table if not exists public.email_verification_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  email text not null,
  token text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_email_verification_tokens_user_id on public.email_verification_tokens(user_id);
create index if not exists idx_email_verification_tokens_email on public.email_verification_tokens(email);

create table if not exists public.client_knowledge (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  services_text text,
  pricing_text text,
  faqs_json jsonb not null default '[]'::jsonb,
  hours_text text,
  contact_text text,
  updated_at timestamptz not null default now(),
  unique (client_id)
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text,
  email text,
  phone text,
  need text,
  status text not null default 'new',
  source text default 'chat',
  created_at timestamptz not null default now()
);

create index if not exists idx_leads_client_id on public.leads(client_id);
create index if not exists idx_leads_created_at_desc on public.leads(created_at desc);

-- ---------------------------------------------------------------------------
-- JWT claim helpers for custom JWT (not Supabase Auth user table)
-- ---------------------------------------------------------------------------

create or replace function public.request_jwt_claim(claim_key text)
returns text
language plpgsql
stable
as $$
declare
  direct_claim text;
  claims_json_text text;
  claims_json jsonb;
begin
  direct_claim := current_setting('request.jwt.claim.' || claim_key, true);
  if direct_claim is not null and direct_claim <> '' then
    return direct_claim;
  end if;

  claims_json_text := current_setting('request.jwt.claims', true);
  if claims_json_text is null or claims_json_text = '' then
    return null;
  end if;

  begin
    claims_json := claims_json_text::jsonb;
  exception when others then
    return null;
  end;

  return nullif(claims_json ->> claim_key, '');
end;
$$;

create or replace function public.request_user_id()
returns uuid
language plpgsql
stable
as $$
declare
  raw_value text;
begin
  raw_value := public.request_jwt_claim('sub');
  if raw_value is null then
    return null;
  end if;

  begin
    return raw_value::uuid;
  exception when others then
    return null;
  end;
end;
$$;

create or replace function public.request_client_id()
returns uuid
language plpgsql
stable
as $$
declare
  raw_value text;
begin
  raw_value := public.request_jwt_claim('client_id');
  if raw_value is null then
    return null;
  end if;

  begin
    return raw_value::uuid;
  exception when others then
    return null;
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS + Policies
-- ---------------------------------------------------------------------------

alter table public.users enable row level security;
alter table public.clients enable row level security;
alter table public.email_verification_tokens enable row level security;
alter table public.client_knowledge enable row level security;
alter table public.leads enable row level security;

drop policy if exists users_select_own on public.users;
drop policy if exists users_update_own on public.users;

create policy users_select_own
on public.users
for select
using (id = public.request_user_id());

create policy users_update_own
on public.users
for update
using (id = public.request_user_id())
with check (id = public.request_user_id());

drop policy if exists clients_select_own on public.clients;
drop policy if exists clients_update_own on public.clients;

create policy clients_select_own
on public.clients
for select
using (user_id = public.request_user_id());

create policy clients_update_own
on public.clients
for update
using (user_id = public.request_user_id())
with check (user_id = public.request_user_id());

drop policy if exists evt_select_own on public.email_verification_tokens;
drop policy if exists evt_update_own on public.email_verification_tokens;
drop policy if exists evt_delete_own on public.email_verification_tokens;

create policy evt_select_own
on public.email_verification_tokens
for select
using (user_id = public.request_user_id());

create policy evt_update_own
on public.email_verification_tokens
for update
using (user_id = public.request_user_id())
with check (user_id = public.request_user_id());

create policy evt_delete_own
on public.email_verification_tokens
for delete
using (user_id = public.request_user_id());

drop policy if exists ck_select_own_client on public.client_knowledge;
drop policy if exists ck_insert_own_client on public.client_knowledge;
drop policy if exists ck_update_own_client on public.client_knowledge;
drop policy if exists ck_delete_own_client on public.client_knowledge;

create policy ck_select_own_client
on public.client_knowledge
for select
using (
  client_id = public.request_client_id()
  and exists (
    select 1 from public.clients c
    where c.id = client_knowledge.client_id
      and c.user_id = public.request_user_id()
  )
);

create policy ck_insert_own_client
on public.client_knowledge
for insert
with check (
  client_id = public.request_client_id()
  and exists (
    select 1 from public.clients c
    where c.id = client_knowledge.client_id
      and c.user_id = public.request_user_id()
  )
);

create policy ck_update_own_client
on public.client_knowledge
for update
using (
  client_id = public.request_client_id()
  and exists (
    select 1 from public.clients c
    where c.id = client_knowledge.client_id
      and c.user_id = public.request_user_id()
  )
)
with check (
  client_id = public.request_client_id()
  and exists (
    select 1 from public.clients c
    where c.id = client_knowledge.client_id
      and c.user_id = public.request_user_id()
  )
);

create policy ck_delete_own_client
on public.client_knowledge
for delete
using (
  client_id = public.request_client_id()
  and exists (
    select 1 from public.clients c
    where c.id = client_knowledge.client_id
      and c.user_id = public.request_user_id()
  )
);

drop policy if exists leads_select_own_client on public.leads;
drop policy if exists leads_insert_own_client on public.leads;
drop policy if exists leads_update_own_client on public.leads;
drop policy if exists leads_delete_own_client on public.leads;

create policy leads_select_own_client
on public.leads
for select
using (
  client_id = public.request_client_id()
  and exists (
    select 1 from public.clients c
    where c.id = leads.client_id
      and c.user_id = public.request_user_id()
  )
);

create policy leads_insert_own_client
on public.leads
for insert
with check (
  client_id = public.request_client_id()
  and exists (
    select 1 from public.clients c
    where c.id = leads.client_id
      and c.user_id = public.request_user_id()
  )
);

create policy leads_update_own_client
on public.leads
for update
using (
  client_id = public.request_client_id()
  and exists (
    select 1 from public.clients c
    where c.id = leads.client_id
      and c.user_id = public.request_user_id()
  )
)
with check (
  client_id = public.request_client_id()
  and exists (
    select 1 from public.clients c
    where c.id = leads.client_id
      and c.user_id = public.request_user_id()
  )
);

create policy leads_delete_own_client
on public.leads
for delete
using (
  client_id = public.request_client_id()
  and exists (
    select 1 from public.clients c
    where c.id = leads.client_id
      and c.user_id = public.request_user_id()
  )
);
