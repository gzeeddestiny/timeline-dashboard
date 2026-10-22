create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Create these encrypted Vault entries before applying this file:
--   timeline_dashboard_url  e.g. https://timeline-dashboard-rose.vercel.app
--   timeline_cron_secret    same 32+ character value as Vercel CRON_SYNC_SECRET
do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'timeline_dashboard_url')
    or not exists (select 1 from vault.decrypted_secrets where name = 'timeline_cron_secret') then
    raise exception 'Create timeline_dashboard_url and timeline_cron_secret in Supabase Vault first';
  end if;
end $$;

-- Keep this setup script safe to run again during rollout or recovery.
select cron.unschedule(jobid)
from cron.job
where jobname in (
  'timeline-dashboard-sync',
  'timeline-dashboard-notifications',
  'timeline-dashboard-daily-digest',
  'timeline-dashboard-contract-alerts',
  'timeline-retention'
);

select cron.schedule(
  'timeline-dashboard-sync',
  '25,55 * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'timeline_dashboard_url') || '/api/cron-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'timeline_cron_secret')
      ),
      body := jsonb_build_object('scheduledAt', now()),
      timeout_milliseconds := 55000
    );
  $$
);

select cron.schedule(
  'timeline-dashboard-notifications',
  '*/15 * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'timeline_dashboard_url') || '/api/cron-notifications',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'timeline_cron_secret')
      ),
      body := jsonb_build_object('scheduledAt', now()),
      timeout_milliseconds := 55000
    );
  $$
);

select cron.schedule(
  'timeline-dashboard-contract-alerts',
  '0 2 * * *', -- 09:00 Asia/Bangkok
  $$ select private.queue_contract_notifications(); $$
);

select cron.schedule(
  'timeline-retention',
  '30 19 * * *', -- 02:30 Asia/Bangkok
  $$ select private.purge_operational_history(); $$
);
