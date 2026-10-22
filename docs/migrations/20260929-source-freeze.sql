-- Run ONLY on source micjfmxdpxeswcgciyjt at migration cutover.
-- Reversed by 20260929-source-unfreeze.sql. Does not delete business data.
BEGIN;
SET LOCAL lock_timeout = '10s';
SELECT cron.alter_job(jobid, active := false) FROM cron.job
WHERE jobname IN ('timeline-dashboard-sync','timeline-dashboard-notifications','timeline-dashboard-contract-alerts','timeline-retention');
CREATE FUNCTION private.timeline_migration_block_write() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Timeline database has moved. Please reload the application.' USING ERRCODE = '55000';
END $$;
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
    EXECUTE format('CREATE TRIGGER timeline_migration_read_only BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION private.timeline_migration_block_write()', t.tablename);
  END LOOP;
END $$;
COMMIT;
SELECT count(*) AS guarded_tables FROM pg_trigger WHERE tgname='timeline_migration_read_only';
SELECT jobname, active FROM cron.job ORDER BY jobname;
