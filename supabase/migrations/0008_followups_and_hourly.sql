-- Follow-up Clock templates, and the hourly job now covers reminders and follow-ups.
insert into message_templates (key, channel, purpose, body) values
  ('followup.hot', null, 'Follow-up for a hot lead', 'Hi {{name}}, just checking in. Shall we fix a time for you to see the projects we discussed?'),
  ('followup.warm', null, 'Follow-up for a warm lead', 'Hi {{name}}, any new thoughts on your search in {{micro_market}}? Happy to share options or set up a visit whenever you''re ready.'),
  ('followup.cold', null, 'Follow-up for a cold lead', 'Hi {{name}}, a quick hello from Realtyniti. If you''re still exploring {{micro_market}}, I''m here whenever you want an update.')
on conflict (key) do nothing;

select cron.unschedule('crm-visit-reminders');
select cron.schedule(
  'crm-hourly',
  '5 * * * *',
  $$
  select net.http_get(
    url := 'https://realtyniti-crm.vercel.app/api/cron/hourly',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'crm_cron_secret')
    )
  );
  $$
);
