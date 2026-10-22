-- Run ONLY on target qxlrleabulpqryduntwf after domain cutover and source jobs disabled.
BEGIN;
SELECT cron.alter_job(jobid, active := true) FROM cron.job
WHERE jobname IN ('timeline-dashboard-sync','timeline-dashboard-notifications','timeline-dashboard-contract-alerts','timeline-retention');
COMMIT;
SELECT jobname,schedule,active FROM cron.job ORDER BY jobname;
