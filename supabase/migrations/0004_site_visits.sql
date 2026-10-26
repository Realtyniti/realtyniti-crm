-- Phase 3: Site Visit Booker (SYS-03). Chetan opens slots; buyers book from a WhatsApp link.

create table visit_slots (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- e.g. "Yamuna Expressway", "Noida Sector 150"; weekends on YEIDA, weekday evenings in Noida.
  area text not null,
  address text,
  map_url text,
  capacity int not null default 1 check (capacity > 0),
  is_open boolean not null default true,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index visit_slots_starts_idx on visit_slots (starts_at) where is_open;

create table site_visits (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,
  slot_id uuid not null references visit_slots (id),
  project_interest text,
  pickup text,
  people int not null default 1 check (people between 1 and 20),
  status text not null default 'booked' check (status in ('booked', 'cancelled', 'done', 'no_show')),
  reminder_evening_sent_at timestamptz,
  reminder_2h_sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index site_visits_slot_idx on site_visits (slot_id) where status = 'booked';
create index site_visits_lead_idx on site_visits (lead_id);
-- One live booking per lead; rebooking cancels the old one first.
create unique index site_visits_one_live_per_lead on site_visits (lead_id) where status = 'booked';

alter table visit_slots enable row level security;
alter table site_visits enable row level security;
