-- 011_password_reset_tokens.sql

create table if not exists public.password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  email text not null,
  token text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists password_reset_tokens_user_id_idx on public.password_reset_tokens(user_id);
create index if not exists password_reset_tokens_token_idx on public.password_reset_tokens(token);

alter table public.password_reset_tokens enable row level security;

drop policy if exists password_reset_tokens_deny_all on public.password_reset_tokens;
create policy password_reset_tokens_deny_all on public.password_reset_tokens
for all using (false) with check (false);
