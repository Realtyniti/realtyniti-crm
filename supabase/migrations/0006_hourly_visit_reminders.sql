-- Hourly site-visit reminders. Vercel's free plan only runs daily crons, so
-- Supabase calls /api/cron/reminders every hour. The bearer secret (same value
-- as CRON_SECRET in Vercel) lives in Supabase Vault, not in this file.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- select vault.create_secret('<CRON_SECRET>', 'crm_cron_secret', 'Bearer secret for realtyniti-crm /api/cron/*');

select cron.schedule(
  'crm-visit-reminders',
  '5 * * * *',
  $$
  select net.http_get(
    url := 'https://realtyniti-crm.vercel.app/api/cron/reminders',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'crm_cron_secret')
    )
  );
  $$
);
