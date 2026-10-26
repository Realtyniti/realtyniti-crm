-- Phase 1 foundation: the Lead Card (F-00).
-- Every other system reads from or writes to these tables.

create type lead_source as enum (
  'meta', 'instagram', 'youtube', 'whatsapp', 'website', 'referral', 'call', 'other'
);
create type lead_temperature as enum ('hot', 'warm', 'cold');
create type lead_status as enum (
  'new', 'qualifying', 'qualified', 'site_visit', 'converted', 'lost'
);
create type lead_purpose as enum ('end_use', 'investment', 'rental');

create table leads (
  id uuid primary key default gen_random_uuid(),
  name text,
  -- Normalised to +91XXXXXXXXXX. One client arriving from two platforms is one row.
  phone text not null unique,
  email text,
  -- The five qualifying answers, in Chetan's order.
  budget_min_inr bigint,
  budget_max_inr bigint,
  micro_market text,
  property_type text,
  purpose lead_purpose,
  timeline_months int,
  agreed_site_visit boolean not null default false,
  interest_level text,
  temperature lead_temperature,
  status lead_status not null default 'new',
  first_source lead_source not null,
  lost_reason text,
  -- Set whenever money (price, payment plan, discount, offer) comes up.
  -- Automation stops sending once this is true.
  needs_chetan boolean not null default false,
  needs_chetan_reason text,
  next_follow_up_at timestamptz,
  first_reply_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lost_needs_reason
    check (status <> 'lost' or coalesce(btrim(lost_reason), '') <> ''),
  constraint budget_order
    check (budget_min_inr is null or budget_max_inr is null or budget_min_inr <= budget_max_inr)
);

create index leads_next_follow_up_idx on leads (next_follow_up_at) where status not in ('converted', 'lost');
create index leads_temperature_idx on leads (temperature);

-- Each time a lead arrives from a platform, even if the client already has a card.
create table lead_touches (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,
  source lead_source not null,
  external_id text,
  raw jsonb,
  received_at timestamptz not null default now(),
  unique (source, external_id)
);
create index lead_touches_lead_idx on lead_touches (lead_id);

-- Full conversation and activity history shown on the card.
create table lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,
  kind text not null check (kind in ('message_in', 'message_out', 'note', 'status_change', 'flag')),
  channel lead_source,
  body text not null,
  created_at timestamptz not null default now()
);
create index lead_events_lead_idx on lead_events (lead_id, created_at);

-- Messages Chetan approves once before first use. Never carry a price.
create table message_templates (
  key text primary key,
  channel lead_source,
  purpose text not null,
  body text not null,
  approved_at timestamptz,
  updated_at timestamptz not null default now()
);

create or replace function touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger leads_updated_at before update on leads
  for each row execute function touch_updated_at();

-- Editing a template's text withdraws its approval.
create or replace function template_reapproval() returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if new.body is distinct from old.body and new.approved_at is not distinct from old.approved_at then
    new.approved_at := null;
  end if;
  return new;
end $$;

create trigger message_templates_reapproval before update on message_templates
  for each row execute function template_reapproval();

-- Only the server (service role) talks to these tables; no public access.
alter table leads enable row level security;
alter table lead_touches enable row level security;
alter table lead_events enable row level security;
alter table message_templates enable row level security;
