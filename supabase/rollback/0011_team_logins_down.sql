-- Rollback for 0011_team_logins.sql. NOT a migration: run by hand only if asked.
--
-- Before running: roll the app back in Vercel to the deployment before the team-logins PR
-- (Instant Rollback). That deployment uses the single shared password again (ADMIN_PASSWORD),
-- so keep that variable set in Vercel.
--
-- What is lost: every team login, signed-in device, invite link and alert subscription, who each
-- lead is assigned to, and who wrote each note. No lead, touch, event or message is deleted.
-- Optional: keep a copy of the assignments first:
--   create table lead_assignments_backup as select id, assigned_to from leads where assigned_to is not null;

begin;
alter table lead_events drop column if exists actor_id;
alter table leads drop column if exists assigned_to;
drop table if exists push_subscriptions;
drop table if exists team_invites;
drop table if exists team_sessions;
drop table if exists team_members;
commit;
