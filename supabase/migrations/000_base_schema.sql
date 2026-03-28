-- 000_base_schema.sql
-- Run this FIRST on a fresh Supabase project before any other migrations.
-- Creates all base tables that subsequent migrations expect to already exist.

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------
-- users
-- -----------------------------------------------------------------------
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  is_verified boolean not null default false,
  role text not null default 'user',
  created_at timestamptz not null default now(),
  constraint users_role_check check (role in ('user', 'admin'))
);

create unique index if not exists users_email_unique_idx on public.users (email);
create index if not exists users_created_at_desc_idx on public.users (created_at desc);

-- -----------------------------------------------------------------------
-- clients
-- -----------------------------------------------------------------------
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  business_name text not null,
  website_url text,
  plan text not null default 'free',
  knowledge_base_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists clients_user_id_unique_idx on public.clients (user_id);
create index if not exists clients_created_at_idx on public.clients (created_at desc);

-- -----------------------------------------------------------------------
-- email_verification_tokens
-- -----------------------------------------------------------------------
create table if not exists public.email_verification_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  email text not null,
  token text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists email_verification_tokens_user_id_idx
  on public.email_verification_tokens (user_id);
create index if not exists email_verification_tokens_email_idx
  on public.email_verification_tokens (email);

-- -----------------------------------------------------------------------
-- client_knowledge
-- -----------------------------------------------------------------------
create table if not exists public.client_knowledge (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references public.clients(id) on delete cascade,
  services_text text,
  pricing_text text,
  faqs_json jsonb not null default '[]'::jsonb,
  hours_text text,
  contact_text text,
  knowledge_base_text text not null default '',
  updated_at timestamptz not null default now()
);

create index if not exists client_knowledge_client_id_idx
  on public.client_knowledge (client_id);

-- -----------------------------------------------------------------------
-- leads
-- -----------------------------------------------------------------------
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text,
  email text,
  phone text,
  need text,
  status text not null default 'new',
  source text,
  created_at timestamptz not null default now()
);

create index if not exists leads_client_id_idx on public.leads (client_id);
create index if not exists leads_client_status_created_idx
  on public.leads (client_id, status, created_at desc);
create index if not exists leads_client_created_idx
  on public.leads (client_id, created_at desc);
