alter table public.sync_runs drop constraint if exists sync_runs_trigger_type_check;
alter table public.sync_runs add constraint sync_runs_trigger_type_check
  check (trigger_type in ('client', 'manual', 'migration', 'cron'));

grant usage on schema private to authenticated, service_role;

-- Supabase projects created after May 2026 require explicit Data API grants.
-- RLS below remains the row-level authorization boundary.
grant select, insert, update, delete on table public.access_list to authenticated;
grant select, insert, update on table public.sheets to authenticated;
grant select, insert, update, delete on table public.team_members to authenticated;
grant select, insert, update, delete on table public.brands to authenticated;
grant select, insert, update, delete on table public.assignments to authenticated;
grant select on table public.tasks_current to authenticated;
grant select, insert, update on table public.task_workflow to authenticated;
grant select on table public.task_aliases to authenticated;
grant select on table public.sync_runs to authenticated;
grant select on table public.task_events to authenticated;
grant select on table public.daily_metrics to authenticated;
grant select, update on table public.notifications to authenticated;

grant all privileges on table
  public.access_list,
  public.sheets,
  public.team_members,
  public.brands,
  public.assignments,
  public.tasks_current,
  public.task_workflow,
  public.task_aliases,
  public.sync_runs,
  public.task_events,
  public.daily_metrics,
  public.notifications,
  public.email_outbox
to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke all privileges on table
  public.access_list,
  public.sheets,
  public.team_members,
  public.brands,
  public.assignments,
  public.tasks_current,
  public.task_workflow,
  public.task_aliases,
  public.sync_runs,
  public.task_events,
  public.daily_metrics,
  public.notifications,
  public.email_outbox
from anon;
revoke all on table public.email_outbox from authenticated;

revoke execute on function private.current_email() from public, anon;
revoke execute on function private.is_active_user() from public, anon;
revoke execute on function private.is_admin() from public, anon;
grant execute on function private.current_email() to authenticated, service_role;
grant execute on function private.is_active_user() to authenticated, service_role;
grant execute on function private.is_admin() to authenticated, service_role;

revoke execute on function private.protect_last_admin() from public, anon, authenticated;
revoke execute on function private.stamp_authenticated_actor() from public, anon, authenticated;
revoke execute on function private.archive_tasks_for_disabled_sheet() from public, anon, authenticated;
revoke execute on function private.audit_shared_change() from public, anon, authenticated;

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update to authenticated
using ((select private.is_active_user()) and lower(recipient_email) = (select private.current_email()))
with check ((select private.is_active_user()) and lower(recipient_email) = (select private.current_email()));
