-- 005_custom_quote_monthly_messages.sql
-- Run in Supabase SQL editor.

alter table public.custom_quotes
  add column if not exists requested_monthly_messages integer;

alter table public.custom_quotes
  drop constraint if exists custom_quotes_requested_monthly_messages_check;

alter table public.custom_quotes
  add constraint custom_quotes_requested_monthly_messages_check
  check (
    requested_monthly_messages is null
    or requested_monthly_messages > 0
  );