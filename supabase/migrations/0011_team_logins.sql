-- Team logins (Phase 2 of the rollout). Additive only: no existing row is edited or deleted.
--
-- 1. team_members: one row per person who can sign in (owner, manager, agent). A deactivated
--    member keeps their row (and their leads), but cannot sign in.
-- 2. team_sessions: one row per signed-in device. The browser holds a random token; only its
--    SHA-256 hash is stored. Deactivating a member deletes their sessions, which signs them out
--    of every device on their next click.
-- 3. team_invites: one-time links to set a password (new member or password reset). Hash only.
-- 4. push_subscriptions: phones and browsers that asked for new-lead alerts.
-- 5. leads.assigned_to: who works the lead. Nullable, no default: existing leads stay unassigned.
-- 6. lead_events.actor_id: who wrote a note or made a change. Nullable: old events stay as they are.

create table team_members (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  -- Normalised +91XXXXXXXXXX. Used to sign in.
  phone text not null unique,
  -- reviewer: a view-only login (Meta App Review). Every write is refused and contact details are masked.
  role text not null check (role in ('owner', 'manager', 'agent', 'reviewer')),
  -- scrypt hash (salt and parameters inside). Null until the member sets a password from their link.
  password_hash text,
  active boolean not null default true,
  failed_logins int not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Exactly one owner: two people racing through first-time setup cannot both become owner.
create unique index team_members_one_owner on team_members ((true)) where role = 'owner';

create table team_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  member_id uuid not null references team_members (id) on delete cascade,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index team_sessions_member_idx on team_sessions (member_id);

create table team_invites (
  token_hash text primary key,
  member_id uuid not null references team_members (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index team_invites_member_idx on team_invites (member_id);

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references team_members (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index push_subscriptions_member_idx on push_subscriptions (member_id);

alter table leads add column assigned_to uuid references team_members (id) on delete set null;
create index leads_assigned_to_idx on leads (assigned_to);

alter table lead_events add column actor_id uuid references team_members (id) on delete set null;

-- Only the CRM server reads or writes these, with the service role key (which bypasses RLS).
-- RLS on with no policies and the grants revoked: a browser holding the public key gets nothing.
alter table team_members enable row level security;
alter table team_sessions enable row level security;
alter table team_invites enable row level security;
alter table push_subscriptions enable row level security;
revoke all on table team_members from anon, authenticated;
revoke all on table team_sessions from anon, authenticated;
revoke all on table team_invites from anon, authenticated;
revoke all on table push_subscriptions from anon, authenticated;
