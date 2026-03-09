-- 003_uploads_and_admin_plans.sql
-- Run in Supabase SQL editor.

create extension if not exists pgcrypto;

-- Chatbot logo metadata
alter table public.chatbots
  add column if not exists logo_path text,
  add column if not exists logo_updated_at timestamptz;

-- Knowledge base file metadata
create table if not exists public.kb_files (
  id uuid primary key default gen_random_uuid(),
  chatbot_id uuid not null references public.chatbots(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  filename text not null,
  mime_type text not null,
  storage_path text not null,
  file_size integer not null check (file_size >= 0),
  created_at timestamptz not null default now()
);

create index if not exists kb_files_chatbot_id_idx on public.kb_files (chatbot_id);
create index if not exists kb_files_user_id_idx on public.kb_files (user_id);

-- Private storage buckets
insert into storage.buckets (id, name, public)
values ('kufu-logos', 'kufu-logos', false)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public;

insert into storage.buckets (id, name, public)
values ('kufu-kb-docs', 'kufu-kb-docs', false)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public;

-- RLS for kb_files (future direct access posture; backend service role bypasses this)
alter table public.kb_files enable row level security;

drop policy if exists kb_files_owner_all on public.kb_files;
create policy kb_files_owner_all on public.kb_files
for all
using (user_id = public.current_request_user_id())
with check (user_id = public.current_request_user_id());

