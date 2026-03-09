-- Backfill missing chatbot -> client links
update public.chatbots as c
set
  client_id = (
    select cl.id
    from public.clients as cl
    where cl.user_id = c.user_id
    order by cl.created_at asc, cl.id asc
    limit 1
  ),
  updated_at = now()
where c.client_id is null
  and exists (
    select 1
    from public.clients as cl
    where cl.user_id = c.user_id
  );
