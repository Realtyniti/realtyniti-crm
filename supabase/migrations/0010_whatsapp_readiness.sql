-- WhatsApp readiness (Stage 1). Additive only: no existing row is edited or deleted.
--
-- 1. leads.wa_auto_allowed: automatic WhatsApp messages need Chetan's per-lead OK.
--    Every existing lead gets false, so none of them can receive an automatic message
--    (bot reply, opener, follow-up, reminder) until Chetan switches it on for that lead.
-- 2. wa_messages: every WhatsApp message in or out, with Meta's message id and delivery status.
-- 3. whatsapp_settings: the global switches. The one row starts with everything off.

alter table leads add column wa_auto_allowed boolean not null default false;

create table wa_messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads (id) on delete set null,
  -- Meta's message id. Unique, so a webhook delivered twice is stored once.
  wamid text unique,
  direction text not null check (direction in ('in', 'out')),
  phone text not null,
  kind text not null default 'text' check (kind in ('text', 'template', 'media')),
  body text not null,
  template_name text,
  status text not null check (status in ('received', 'blocked', 'dry_run', 'sent', 'delivered', 'read', 'failed')),
  error text,
  actor text not null check (actor in ('chetan', 'bot', 'system', 'buyer')),
  automated boolean not null default false,
  -- One-time id from the reply form: a double click or a resubmit cannot send twice.
  client_ref text unique,
  created_at timestamptz not null default now(),
  status_at timestamptz
);
create index wa_messages_lead_idx on wa_messages (lead_id, created_at);
create index wa_messages_contacted_idx on wa_messages (lead_id) where direction = 'out' and status in ('sent', 'delivered', 'read');

create table whatsapp_settings (
  id boolean primary key default true check (id),
  outbound_enabled boolean not null default false,
  automation_enabled boolean not null default false,
  test_mode boolean not null default true,
  test_numbers text[] not null default '{}',
  updated_at timestamptz not null default now()
);
insert into whatsapp_settings (id) values (true) on conflict (id) do nothing;

alter table wa_messages enable row level security;
alter table whatsapp_settings enable row level security;
