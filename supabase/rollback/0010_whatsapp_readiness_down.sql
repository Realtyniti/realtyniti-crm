-- Rollback for 0010_whatsapp_readiness.sql. NOT a migration: run by hand only if asked.
--
-- Before running: roll the app back in Vercel to the deployment before PR #2 (Instant Rollback).
-- The new code needs these objects; the old code never touches them, so the app works either way
-- once the old deployment is live.
--
-- What is lost: the WhatsApp message log (wa_messages), the switches (whatsapp_settings), and
-- every per-lead "allow automatic WhatsApp" choice. No other lead data is touched.
-- Optional: keep a copy of the log first:
--   create table wa_messages_backup as table wa_messages;

begin;
drop table if exists wa_messages;
drop table if exists whatsapp_settings;
alter table leads drop column if exists wa_auto_allowed;
commit;
