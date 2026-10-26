-- Phase 4: Follow-up Clock (SYS-05), Project Sheet SOP (SYS-06), Channel Board (SYS-07).

alter table leads
  add column followups_unanswered int not null default 0,
  add column last_followup_at timestamptz;

create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  developer text not null,
  micro_market text not null,
  sector text,
  rera_number text,
  configurations text,
  price_min_inr bigint,
  price_max_inr bigint,
  plc text,
  payment_plan text,
  possession text,
  offers text,
  offer_valid_until date,
  amenities text,
  availability text not null default 'available' check (availability in ('available', 'limited', 'sold_out', 'on_hold')),
  developer_contact_name text,
  developer_contact_phone text,
  last_confirmed_at timestamptz,
  confirmed_by text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (price_min_inr is null or price_max_inr is null or price_min_inr <= price_max_inr)
);
create trigger projects_updated_at before update on projects
  for each row execute function touch_updated_at();

-- Monthly spend per channel, entered by Chetan (Meta can be pulled automatically later).
create table channel_spend (
  source lead_source not null,
  month date not null check (extract(day from month) = 1),
  amount_inr bigint not null check (amount_inr >= 0),
  updated_at timestamptz not null default now(),
  primary key (source, month)
);

alter table projects enable row level security;
alter table channel_spend enable row level security;
