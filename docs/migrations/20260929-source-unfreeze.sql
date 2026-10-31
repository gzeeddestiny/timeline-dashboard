-- Run ONLY on source after stopping target jobs and reconciling any target writes.
BEGIN;
SET LOCAL lock_timeout = '10s';
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS timeline_migration_read_only ON public.%I',t.tablename);
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS private.timeline_migration_block_write();
SELECT cron.alter_job(jobid, active := true) FROM cron.job
WHERE jobname IN ('timeline-dashboard-sync','timeline-dashboard-notifications','timeline-dashboard-contract-alerts','timeline-retention');
COMMIT;
