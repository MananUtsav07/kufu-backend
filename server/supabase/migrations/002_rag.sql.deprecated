-- 002_rag.sql
-- Per-chatbot RAG storage and retrieval on Supabase Postgres + pgvector.

create extension if not exists pgcrypto;
create extension if not exists vector;

create table if not exists public.rag_pages (
  id uuid primary key default gen_random_uuid(),
  chatbot_id uuid not null references public.chatbots(id) on delete cascade,
  url text not null,
  title text,
  content_text text,
  content_hash text,
  last_crawled_at timestamptz not null default now(),
  status text not null default 'ok',
  http_status integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rag_pages_chatbot_url_unique unique (chatbot_id, url)
);

create index if not exists rag_pages_chatbot_idx on public.rag_pages (chatbot_id);
create index if not exists rag_pages_updated_at_idx on public.rag_pages (updated_at desc);

create table if not exists public.rag_chunks (
  id uuid primary key default gen_random_uuid(),
  chatbot_id uuid not null references public.chatbots(id) on delete cascade,
  page_id uuid not null references public.rag_pages(id) on delete cascade,
  chunk_index integer not null,
  chunk_text text not null,
  embedding vector(1536) not null,
  token_estimate integer,
  created_at timestamptz not null default now()
);

create index if not exists rag_chunks_chatbot_idx on public.rag_chunks (chatbot_id);
create index if not exists rag_chunks_page_idx on public.rag_chunks (page_id);
create index if not exists rag_chunks_embedding_idx
  on public.rag_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create table if not exists public.rag_ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  chatbot_id uuid not null references public.chatbots(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  pages_found integer not null default 0,
  pages_crawled integer not null default 0,
  chunks_written integer not null default 0,
  error text,
  website_url text,
  max_pages integer,
  triggered_by_user_id uuid references public.users(id) on delete set null,
  cancel_requested boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint rag_ingestion_runs_status_check check (status in ('running', 'done', 'failed', 'canceled'))
);

create index if not exists rag_ingestion_runs_chatbot_idx on public.rag_ingestion_runs (chatbot_id);
create index if not exists rag_ingestion_runs_status_idx on public.rag_ingestion_runs (status);
create index if not exists rag_ingestion_runs_updated_at_idx on public.rag_ingestion_runs (updated_at desc);

create or replace function public.rag_match_chunks(
  p_chatbot_id uuid,
  p_query_embedding vector(1536),
  p_match_count integer default 8
)
returns table (
  chunk_text text,
  url text,
  similarity double precision
)
language sql
stable
as $$
  select
    c.chunk_text,
    p.url,
    1 - (c.embedding <=> p_query_embedding) as similarity
  from public.rag_chunks c
  inner join public.rag_pages p on p.id = c.page_id
  where c.chatbot_id = p_chatbot_id
  order by c.embedding <=> p_query_embedding
  limit greatest(1, least(coalesce(p_match_count, 8), 20));
$$;

alter table public.rag_pages enable row level security;
alter table public.rag_chunks enable row level security;
alter table public.rag_ingestion_runs enable row level security;

drop policy if exists rag_pages_deny_all on public.rag_pages;
create policy rag_pages_deny_all on public.rag_pages
for all
using (false)
with check (false);

drop policy if exists rag_chunks_deny_all on public.rag_chunks;
create policy rag_chunks_deny_all on public.rag_chunks
for all
using (false)
with check (false);

drop policy if exists rag_ingestion_runs_deny_all on public.rag_ingestion_runs;
create policy rag_ingestion_runs_deny_all on public.rag_ingestion_runs
for all
using (false)
with check (false);

comment on table public.rag_pages is 'RAG crawled pages. Accessed by backend service-role only.';
comment on table public.rag_chunks is 'RAG chunks with pgvector embeddings. Accessed by backend service-role only.';
comment on table public.rag_ingestion_runs is 'RAG ingestion progress/error tracking. Accessed by backend service-role only.';
