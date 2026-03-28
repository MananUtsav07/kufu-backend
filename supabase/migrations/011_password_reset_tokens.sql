create table if not exists password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  email text not null,
  token text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists password_reset_tokens_user_id_idx on password_reset_tokens(user_id);
create index if not exists password_reset_tokens_token_idx on password_reset_tokens(token);
