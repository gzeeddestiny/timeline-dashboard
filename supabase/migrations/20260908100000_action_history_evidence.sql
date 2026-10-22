begin;

alter table public.action_events add column if not exists brand_name text;
alter table public.action_events add column if not exists actor_name text;
alter table public.action_events add column if not exists evidence_source text default 'application';
alter table public.action_events add column if not exists time_precision text not null default 'exact'
  check (time_precision in ('exact','minute','version'));

update public.action_events
set evidence_source = case when dedupe_key like 'historical:%' then 'workflow_audit' else source end
where evidence_source is null;

alter table public.action_events alter column evidence_source set not null;

create or replace function public.ingest_verified_history(p_event jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare
  task_row public.tasks_current%rowtype;
  inserted_id uuid;
  event_time timestamptz := (p_event->>'occurredAt')::timestamptz;
  event_key text := p_event->>'id';
begin
  if event_key is null or event_key !~ '^verified_sheet:[A-Za-z0-9:_-]+$'
     or p_event->>'evidenceSource' <> 'sheet_version_history'
     or event_time > now()
     or jsonb_typeof(p_event->'changes') <> 'object'
     or p_event->'changes' = '{}'::jsonb then
    raise exception 'Invalid verified history evidence';
  end if;
  select * into task_row from public.tasks_current where task_key=p_event->>'taskKey';
  if not found then raise exception 'Verified history Task ID was not found'; end if;

  insert into public.action_events(dedupe_key,occurred_at,source,kind,task_keys,project_name,brand_name,
    task_name,ae_names,actor_email,actor_name,changes,history_gap,evidence_source,time_precision)
  values(event_key,event_time,'google_sheet','history_backfill',array[task_row.task_key],
    nullif(p_event->>'projectName',''),nullif(p_event->>'brandName',''),task_row.topic,
    coalesce(array(select jsonb_array_elements_text(coalesce(p_event->'aeNames','[]'::jsonb))),'{}'),
    nullif(p_event->>'actorEmail',''),nullif(p_event->>'actorName',''),p_event->'changes',
    nullif(p_event->>'historyGap',''),'sheet_version_history',coalesce(nullif(p_event->>'timePrecision',''),'minute'))
  on conflict(dedupe_key) do nothing returning id into inserted_id;
  if inserted_id is null then return 'duplicate'; end if;

  update public.task_activity_state set
    last_activity_at=event_time,last_activity_kind='history_backfill',last_activity_source='google_sheet',
    last_activity_actor_email=nullif(p_event->>'actorEmail',''),last_action_changes=p_event->'changes',
    history_gap=null,updated_at=now()
  where task_key=task_row.task_key
    and (last_activity_kind='task_discovered' or last_activity_at is null or event_time>last_activity_at);
  return 'inserted';
end $$;

revoke all on function public.ingest_verified_history(jsonb) from public,anon,authenticated;
grant execute on function public.ingest_verified_history(jsonb) to service_role;

commit;
