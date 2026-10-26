-- Phase 2: Lead Catcher conversation state.
alter table leads
  add column awaiting_question text,
  add column asked_questions text[] not null default '{}',
  add column last_inbound_at timestamptz,
  add column prefers_hinglish boolean not null default false;
