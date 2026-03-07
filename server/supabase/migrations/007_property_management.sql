-- 007_property_management.sql
-- Run in Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists public.property_owners (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  company_name text not null,
  support_email text not null,
  support_whatsapp text,
  created_at timestamptz not null default now(),
  constraint property_owners_user_unique unique (user_id)
);

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.property_owners(id) on delete cascade,
  property_name text not null,
  address text not null,
  unit_number text,
  created_at timestamptz not null default now()
);

create index if not exists properties_owner_id_idx on public.properties (owner_id);
create index if not exists properties_created_at_idx on public.properties (created_at desc);

create table if not exists public.property_tenants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.property_owners(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  full_name text not null,
  email text not null,
  phone text,
  tenant_access_id text not null unique,
  password_hash text not null,
  lease_start_date date,
  lease_end_date date,
  monthly_rent numeric(12, 2) not null default 0,
  payment_due_day integer not null default 1,
  payment_status text not null default 'pending',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  constraint property_tenants_due_day_check check (payment_due_day between 1 and 31),
  constraint property_tenants_payment_status_check check (payment_status in ('pending', 'paid', 'overdue', 'partial')),
  constraint property_tenants_status_check check (status in ('active', 'inactive', 'terminated'))
);

create index if not exists property_tenants_owner_id_idx on public.property_tenants (owner_id);
create index if not exists property_tenants_property_id_idx on public.property_tenants (property_id);
create index if not exists property_tenants_created_at_idx on public.property_tenants (created_at desc);
create index if not exists property_tenants_payment_status_idx on public.property_tenants (payment_status);
create unique index if not exists property_tenants_owner_access_unique_idx
  on public.property_tenants (owner_id, tenant_access_id);

create table if not exists public.tenant_support_tickets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.property_tenants(id) on delete cascade,
  owner_id uuid not null references public.property_owners(id) on delete cascade,
  subject text not null,
  message text not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_support_tickets_status_check check (status in ('open', 'in_progress', 'resolved', 'closed'))
);

create index if not exists tenant_support_tickets_owner_id_idx on public.tenant_support_tickets (owner_id);
create index if not exists tenant_support_tickets_tenant_id_idx on public.tenant_support_tickets (tenant_id);
create index if not exists tenant_support_tickets_status_idx on public.tenant_support_tickets (status);
create index if not exists tenant_support_tickets_created_at_idx on public.tenant_support_tickets (created_at desc);

create table if not exists public.tenant_chat_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.property_tenants(id) on delete cascade,
  owner_id uuid not null references public.property_owners(id) on delete cascade,
  sender_type text not null,
  message text not null,
  intent text,
  escalated boolean not null default false,
  created_at timestamptz not null default now(),
  constraint tenant_chat_messages_sender_type_check check (sender_type in ('tenant', 'bot', 'owner'))
);

create index if not exists tenant_chat_messages_owner_id_idx on public.tenant_chat_messages (owner_id);
create index if not exists tenant_chat_messages_tenant_id_idx on public.tenant_chat_messages (tenant_id);
create index if not exists tenant_chat_messages_created_at_idx on public.tenant_chat_messages (created_at desc);
create index if not exists tenant_chat_messages_escalated_idx on public.tenant_chat_messages (escalated);

create table if not exists public.rent_reminders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.property_tenants(id) on delete cascade,
  owner_id uuid not null references public.property_owners(id) on delete cascade,
  reminder_type text not null,
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  constraint rent_reminders_type_check check (
    reminder_type in ('7_days_before', '1_day_before', 'due_today', '3_days_late', '7_days_late')
  ),
  constraint rent_reminders_status_check check (status in ('pending', 'sent', 'failed', 'canceled'))
);

create index if not exists rent_reminders_owner_id_idx on public.rent_reminders (owner_id);
create index if not exists rent_reminders_tenant_id_idx on public.rent_reminders (tenant_id);
create index if not exists rent_reminders_scheduled_for_idx on public.rent_reminders (scheduled_for);
create index if not exists rent_reminders_status_idx on public.rent_reminders (status);
create unique index if not exists rent_reminders_unique_entry_idx
  on public.rent_reminders (tenant_id, reminder_type, scheduled_for);

create table if not exists public.owner_notifications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.property_owners(id) on delete cascade,
  tenant_id uuid references public.property_tenants(id) on delete set null,
  notification_type text not null,
  title text not null,
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists owner_notifications_owner_id_idx on public.owner_notifications (owner_id);
create index if not exists owner_notifications_created_at_idx on public.owner_notifications (created_at desc);
create index if not exists owner_notifications_unread_idx on public.owner_notifications (owner_id, is_read);

create table if not exists public.tenant_dashboard_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.property_tenants(id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists tenant_dashboard_sessions_tenant_id_idx on public.tenant_dashboard_sessions (tenant_id);
create index if not exists tenant_dashboard_sessions_expires_at_idx on public.tenant_dashboard_sessions (expires_at);

alter table public.property_owners enable row level security;
alter table public.properties enable row level security;
alter table public.property_tenants enable row level security;
alter table public.tenant_support_tickets enable row level security;
alter table public.tenant_chat_messages enable row level security;
alter table public.rent_reminders enable row level security;
alter table public.owner_notifications enable row level security;
alter table public.tenant_dashboard_sessions enable row level security;

drop policy if exists property_owners_owner_all on public.property_owners;
create policy property_owners_owner_all on public.property_owners
for all
using (user_id = public.current_request_user_id())
with check (user_id = public.current_request_user_id());

drop policy if exists properties_owner_all on public.properties;
create policy properties_owner_all on public.properties
for all
using (
  exists (
    select 1 from public.property_owners po
    where po.id = properties.owner_id
      and po.user_id = public.current_request_user_id()
  )
)
with check (
  exists (
    select 1 from public.property_owners po
    where po.id = properties.owner_id
      and po.user_id = public.current_request_user_id()
  )
);

drop policy if exists property_tenants_owner_all on public.property_tenants;
create policy property_tenants_owner_all on public.property_tenants
for all
using (
  exists (
    select 1 from public.property_owners po
    where po.id = property_tenants.owner_id
      and po.user_id = public.current_request_user_id()
  )
)
with check (
  exists (
    select 1 from public.property_owners po
    where po.id = property_tenants.owner_id
      and po.user_id = public.current_request_user_id()
  )
);

drop policy if exists tenant_support_tickets_owner_all on public.tenant_support_tickets;
create policy tenant_support_tickets_owner_all on public.tenant_support_tickets
for all
using (
  exists (
    select 1 from public.property_owners po
    where po.id = tenant_support_tickets.owner_id
      and po.user_id = public.current_request_user_id()
  )
)
with check (
  exists (
    select 1 from public.property_owners po
    where po.id = tenant_support_tickets.owner_id
      and po.user_id = public.current_request_user_id()
  )
);

drop policy if exists tenant_chat_messages_owner_all on public.tenant_chat_messages;
create policy tenant_chat_messages_owner_all on public.tenant_chat_messages
for all
using (
  exists (
    select 1 from public.property_owners po
    where po.id = tenant_chat_messages.owner_id
      and po.user_id = public.current_request_user_id()
  )
)
with check (
  exists (
    select 1 from public.property_owners po
    where po.id = tenant_chat_messages.owner_id
      and po.user_id = public.current_request_user_id()
  )
);

drop policy if exists rent_reminders_owner_all on public.rent_reminders;
create policy rent_reminders_owner_all on public.rent_reminders
for all
using (
  exists (
    select 1 from public.property_owners po
    where po.id = rent_reminders.owner_id
      and po.user_id = public.current_request_user_id()
  )
)
with check (
  exists (
    select 1 from public.property_owners po
    where po.id = rent_reminders.owner_id
      and po.user_id = public.current_request_user_id()
  )
);

drop policy if exists owner_notifications_owner_all on public.owner_notifications;
create policy owner_notifications_owner_all on public.owner_notifications
for all
using (
  exists (
    select 1 from public.property_owners po
    where po.id = owner_notifications.owner_id
      and po.user_id = public.current_request_user_id()
  )
)
with check (
  exists (
    select 1 from public.property_owners po
    where po.id = owner_notifications.owner_id
      and po.user_id = public.current_request_user_id()
  )
);

drop policy if exists tenant_dashboard_sessions_owner_all on public.tenant_dashboard_sessions;
create policy tenant_dashboard_sessions_owner_all on public.tenant_dashboard_sessions
for all
using (
  exists (
    select 1
    from public.property_tenants pt
    join public.property_owners po on po.id = pt.owner_id
    where pt.id = tenant_dashboard_sessions.tenant_id
      and po.user_id = public.current_request_user_id()
  )
)
with check (
  exists (
    select 1
    from public.property_tenants pt
    join public.property_owners po on po.id = pt.owner_id
    where pt.id = tenant_dashboard_sessions.tenant_id
      and po.user_id = public.current_request_user_id()
  )
);
