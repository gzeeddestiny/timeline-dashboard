begin;

alter table public.tasks_current add column if not exists source_dates jsonb not null default '{}';
alter table public.sync_stage_tasks add column if not exists source_dates jsonb not null default '{}';
alter table public.tasks_current add column if not exists source_event_at timestamptz;
alter table public.tasks_current add column if not exists source_event_versions jsonb not null default '{}';
alter table public.task_activity_state add column if not exists history_gap text;
alter table public.task_activity_state add column if not exists last_action_changes jsonb not null default '{}';

create table public.action_events (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text unique not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  source text not null check (source in ('dashboard','google_sheet','system')),
  kind text not null,
  task_keys text[] not null default '{}',
  project_id uuid,
  project_name text,
  task_name text,
  member_name text,
  ae_names text[] not null default '{}',
  actor_email text,
  changes jsonb not null,
  history_gap text
);
create index action_events_time_idx on public.action_events(occurred_at desc, id desc);
create index action_events_tasks_idx on public.action_events using gin(task_keys);
create index action_events_ae_idx on public.action_events using gin(ae_names);
alter table public.action_events enable row level security;
revoke all on public.action_events from public, anon, authenticated;
grant select, insert on public.action_events to service_role;

create table public.sheet_activity_health (
  spreadsheet_id text primary key references public.sheets(spreadsheet_id) on delete cascade,
  checked_at timestamptz not null default now(),
  pending_count integer not null default 0,
  error text,
  installed_gids bigint[] not null default '{}'
);
alter table public.sheet_activity_health enable row level security;
revoke all on public.sheet_activity_health from public, anon, authenticated;
grant all on public.sheet_activity_health to service_role;

create function private.action_diff(b jsonb, a jsonb) returns jsonb
language sql immutable set search_path = '' as $$
 select coalesce(jsonb_object_agg(k, jsonb_build_object('before', b->k, 'after', a->k)), '{}'::jsonb)
 from (select jsonb_object_keys(b || a) k) keys
 where coalesce(b->k, 'null'::jsonb) is distinct from coalesce(a->k, 'null'::jsonb)
$$;

create function private.assignment_aes(a jsonb) returns text[]
language sql immutable set search_path = '' as $$
 select coalesce(array_agg(distinct v), '{}') from jsonb_array_elements_text(
 case jsonb_typeof(a->'ae') when 'array' then a->'ae'
 when 'string' then jsonb_build_array(a->>'ae') else '[]'::jsonb end) v where v <> ''
$$;

-- This is the single writer of task activity. Profile events have no task keys.
create function private.record_action(
 p_key text, p_at timestamptz, p_source text, p_kind text, p_tasks text[],
 p_changes jsonb, p_actor text default null, p_project uuid default null,
 p_member text default null, p_gap text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
 event_id uuid;
 project_row public.brand_workstreams;
 task_row public.tasks_current;
 assignment_value jsonb := '{}';
 historic_assignment jsonb;
 ae_values text[] := '{}';
 task_key_value text;
begin
 if p_changes = '{}'::jsonb and p_gap is null then return null; end if;
 if coalesce(array_length(p_tasks, 1),0) > 0 then
   select * into task_row from public.tasks_current where task_key = p_tasks[1];
 end if;
 if p_project is not null then
   select * into project_row from public.brand_workstreams where id = p_project;
 else
   select p.* into project_row from public.brand_workstreams p
   join public.brand_workstream_sources s on s.workstream_id = p.id
   where s.tab_key = task_row.spreadsheet_id || ':' || task_row.sheet_gid::text limit 1;
 end if;
 assignment_value := coalesce(project_row.assignment, '{}');
 if project_row.id is null and task_row.task_key is not null then
   select a.value into assignment_value from public.assignments a
   left join public.brands b on b.tab_key = task_row.spreadsheet_id || ':' || task_row.sheet_gid::text
   where a.brand_key in (b.tab_key, b.brand_name, lower(regexp_replace(trim(b.brand_name),'\s+',' ','g')))
   order by (a.brand_key = b.tab_key) desc limit 1;
   assignment_value := coalesce(assignment_value, '{}');
 end if;
 -- Use the assignment as it was at event time, including delayed Sheet deliveries.
 if project_row.id is not null then
   select changes->'assignment'->'after' into historic_assignment from public.action_events
   where project_id = project_row.id and kind = 'assignment_changed' and occurred_at <= p_at
   order by occurred_at desc, received_at desc limit 1;
   if historic_assignment is null then
     select changes->'assignment'->'before' into historic_assignment from public.action_events
     where project_id = project_row.id and kind = 'assignment_changed' and occurred_at > p_at
     order by occurred_at, received_at limit 1;
   end if;
   assignment_value := coalesce(historic_assignment, assignment_value);
 end if;
 if p_kind = 'assignment_changed' then assignment_value := p_changes->'assignment'->'after'; end if;
 ae_values := private.assignment_aes(assignment_value);
 if p_member is not null then
   if exists (select 1 from public.team_members where name = p_member and role = 'ae') then ae_values := array[p_member]; end if;
 end if;
 insert into public.action_events(dedupe_key, occurred_at, source, kind, task_keys, project_id,
 project_name, task_name, member_name, ae_names, actor_email, changes, history_gap)
 values(p_key, p_at, p_source, p_kind, coalesce(p_tasks,'{}'), project_row.id,
 concat_ws(' · ', project_row.brand_name, project_row.name), task_row.topic, p_member,
 ae_values, nullif(lower(p_actor),''), p_changes, p_gap)
 on conflict(dedupe_key) do nothing returning id into event_id;
 if event_id is null then return null; end if;
 foreach task_key_value in array coalesce(p_tasks, '{}') loop
   if not exists(select 1 from public.tasks_current where task_key = task_key_value) then continue; end if;
   if p_gap is not null then
     update public.task_activity_state set history_gap = p_gap where task_key = task_key_value;
   end if;
   if p_changes = '{}'::jsonb then continue; end if;
   insert into public.task_activity_state(task_key, first_seen_at, last_activity_at, last_activity_kind,
     last_activity_source, last_activity_actor_email, last_action_changes)
   values(task_key_value, now(), p_at, p_kind, p_source, nullif(lower(p_actor),''),p_changes)
   on conflict(task_key) do update set
     last_activity_at = excluded.last_activity_at, last_activity_kind = excluded.last_activity_kind,
     last_activity_source = excluded.last_activity_source, last_activity_actor_email = excluded.last_activity_actor_email,
     last_action_changes = excluded.last_action_changes,
     snoozed_until = null, snooze_reason = null, snoozed_by = null, updated_at = now()
   where excluded.last_activity_at >= public.task_activity_state.last_activity_at
      or public.task_activity_state.last_activity_kind = 'task_discovered';
 end loop;
 return event_id;
end $$;

-- A snapshot is an observation, never a user action.
revoke all on function private.record_action(text,timestamptz,text,text,text[],jsonb,text,uuid,text,text) from public,anon,authenticated;

create or replace function private.track_task_source_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if TG_OP = 'INSERT' then
   insert into public.task_activity_state(task_key) values(new.task_key) on conflict do nothing;
 elsif current_setting('app.action_write', true) is distinct from 'yes'
 and row(old.done, old.due_date, old.actual_submit, case when old.source_dates='{}'::jsonb then new.source_dates else old.source_dates end, old.responsibility)
 is distinct from row(new.done, new.due_date, new.actual_submit, new.source_dates, new.responsibility) then
   update public.task_activity_state set history_gap = 'พบค่าจาก Sheet เปลี่ยนระหว่าง sync แต่ยังไม่มีเหตุการณ์ยืนยันเวลา'
   where task_key = new.task_key;
 end if;
 return new;
end $$;

create or replace function private.track_workflow_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare b jsonb; a jsonb; actor_mail text;
begin
 b := case when TG_OP = 'INSERT' then jsonb_build_object('status','not_started','note','','priority',null,'next_action','')
 else jsonb_build_object('status',old.status,'note',old.note,'priority',old.priority,'next_action',old.next_action) end;
 a := jsonb_build_object('status',new.status,'note',new.note,'priority',new.priority,'next_action',new.next_action);
 select email into actor_mail from auth.users where id = new.updated_by;
 perform private.record_action(gen_random_uuid()::text, now(), 'dashboard', 'workflow_changed', array[new.task_key], private.action_diff(b,a), actor_mail);
 return new;
end $$;

create function private.track_assignment_action() returns trigger
language plpgsql security definer set search_path = '' as $$
declare keys text[]; actor_mail text; b jsonb; a jsonb; project_value uuid;
begin
 b := case when TG_OP = 'INSERT' then '{}'::jsonb else coalesce(to_jsonb(old)->'assignment', to_jsonb(old)->'value','{}') end;
 a := case when TG_OP = 'DELETE' then '{}'::jsonb else coalesce(to_jsonb(new)->'assignment', to_jsonb(new)->'value','{}') end;
 if b is not distinct from a then return coalesce(new,old); end if;
 if TG_TABLE_NAME = 'brand_workstreams' then
   project_value := coalesce(new.id,old.id);
   select array_agg(t.task_key) into keys from public.tasks_current t
   join public.brand_workstream_sources s on s.tab_key = t.spreadsheet_id || ':' || t.sheet_gid::text
   where s.workstream_id = project_value and t.active and not t.done;
 else
   select array_agg(t.task_key) into keys from public.tasks_current t
   left join public.brands b on b.tab_key = t.spreadsheet_id || ':' || t.sheet_gid::text
   where t.active and not t.done and (lower(regexp_replace(trim(b.brand_name),'\s+',' ','g')) = coalesce(new.brand_key,old.brand_key)
     or b.brand_name = coalesce(new.brand_key,old.brand_key)
     or b.tab_key = coalesce(new.brand_key,old.brand_key))
   and not exists(select 1 from public.brand_workstream_sources s where s.tab_key = b.tab_key);
 end if;
 select email into actor_mail from auth.users where id = coalesce(auth.uid(), (coalesce(to_jsonb(new),to_jsonb(old))->>'updated_by')::uuid);
 perform private.record_action(gen_random_uuid()::text,now(),'dashboard','assignment_changed',coalesce(keys,'{}'),
 jsonb_build_object('assignment',jsonb_build_object('before',b,'after',a)),actor_mail,project_value);
 return coalesce(new,old);
end $$;
create trigger track_project_assignment after insert or update or delete on public.brand_workstreams
for each row execute function private.track_assignment_action();
create trigger track_legacy_assignment after insert or update or delete on public.assignments
for each row execute function private.track_assignment_action();

create function private.track_avatar_action() returns trigger
language plpgsql security definer set search_path = '' as $$
declare actor_mail text;
begin
 if new.avatar is not distinct from old.avatar then return new; end if;
 select email into actor_mail from auth.users where id = coalesce(auth.uid(),new.updated_by);
 perform private.record_action(gen_random_uuid()::text,now(),'dashboard','avatar_changed','{}',
 jsonb_build_object('avatar',jsonb_build_object('before',old.avatar,'after',new.avatar)),actor_mail,null,new.name);
 return new;
end $$;
create trigger track_avatar_action after update on public.team_members for each row execute function private.track_avatar_action();

-- The journal owns completion events, including writes originating in the dashboard.
create or replace function public.finalize_completion(p_task_key text,p_row_index integer,p_done boolean,
 p_actual_submit date,p_actor uuid,p_actor_email text,p_synced_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
 perform set_config('app.action_write','yes',true);
 update public.tasks_current set row_index=p_row_index,done=p_done,actual_submit=p_actual_submit,source_synced_at=p_synced_at
 where task_key=p_task_key and active and (source_event_at is null or source_event_at <= p_synced_at);
end $$;

create function public.ingest_sheet_action(p_event jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare k text; at_time timestamptz; changes_value jsonb; entry record; t public.tasks_current;
begin
 k := p_event->>'taskKey'; at_time := (p_event->>'occurredAt')::timestamptz;
 if exists(select 1 from public.action_events where dedupe_key = p_event->>'id') then return; end if;
 select * into t from public.tasks_current where task_key=k for update;
 if not found then raise exception 'Task not synced yet'; end if;
 changes_value := p_event->'changes';
 perform private.record_action(p_event->>'id',at_time,p_event->>'source','sheet_fields_changed',array[k],changes_value,
 p_event->>'actorEmail',null,null,p_event->>'historyGap');
 if changes_value = '{}'::jsonb then return; end if;
   perform set_config('app.action_write','yes',true);
   for entry in select * from jsonb_each(changes_value) loop
     -- A newer edit to Done must not discard a delayed edit to a different date.
     if t.source_synced_at > at_time then continue; end if;
     if (t.source_event_versions->>entry.key)::timestamptz > at_time then continue; end if;
     if entry.key = 'done' then t.done := (entry.value->>'after')::boolean;
     elsif entry.key = 'due_date' then t.due_date := nullif(entry.value->>'after','')::date;
     elsif entry.key = 'actual_submit' then t.actual_submit := nullif(entry.value->>'after','')::date;
     elsif entry.key = 'responsibility' then t.responsibility := coalesce(entry.value->>'after','');
     elsif entry.key like 'date:%' then t.source_dates := jsonb_set(t.source_dates,array[substr(entry.key,6)],coalesce(entry.value->'after','null'::jsonb));
     end if;
     t.source_event_versions := jsonb_set(t.source_event_versions,array[entry.key],to_jsonb(at_time));
   end loop;
   update public.tasks_current set done=t.done,due_date=t.due_date,actual_submit=t.actual_submit,
   responsibility=t.responsibility,source_dates=t.source_dates,
   source_event_at=greatest(t.source_event_at,at_time),source_event_versions=t.source_event_versions where task_key=k;
end $$;
revoke all on function public.ingest_sheet_action(jsonb) from public,anon,authenticated;
grant execute on function public.ingest_sheet_action(jsonb) to service_role;

-- Reset unverified historical timestamps. Retain only auditable workflow changes below.
update public.task_activity_state set first_seen_at=now(),last_activity_at=now(),last_activity_kind='task_discovered',
last_activity_source='system',last_activity_actor_email=null;
do $$
declare e record; b jsonb; a jsonb;
begin
 for e in select * from public.task_events where resource='task_workflow' order by created_at,id loop
   if not exists(select 1 from public.tasks_current where task_key=e.record_key) then continue; end if;
   b := jsonb_build_object('status',coalesce(e.before_value->>'status','not_started'),'note',coalesce(e.before_value->>'note',''),
     'priority',e.before_value->'priority','next_action',coalesce(e.before_value->>'next_action',''));
   a := jsonb_build_object('status',coalesce(e.after_value->>'status','not_started'),'note',coalesce(e.after_value->>'note',''),
     'priority',e.after_value->'priority','next_action',coalesce(e.after_value->>'next_action',''));
   if private.action_diff(b,a) = '{}'::jsonb then continue; end if;
   perform private.record_action('historical:'||e.id,e.created_at,'dashboard','workflow_changed',array[e.record_key],
     private.action_diff(b,a),e.actor_email,null,null,'ประวัติเดิม: ไม่สามารถยืนยัน AE ณ เวลาเกิดเหตุการณ์');
 end loop;
 -- Never present today's assignment as a historical owner.
 update public.action_events set ae_names='{}' where dedupe_key like 'historical:%';
end $$;

create or replace function public.apply_sync_snapshot(
  p_run_id uuid,
  p_synced_at timestamptz,
  p_sheet_ids text[],
  p_metric_rows jsonb,
  p_issues jsonb,
  p_finished_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  applied integer;
begin
  if not exists (select 1 from public.sync_runs where id = p_run_id and status = 'running') then
    raise exception 'Sync run is not active';
  end if;

  insert into public.tasks_current (
    task_key, task_id, spreadsheet_id, sheet_gid, row_index, client_name, month,
    topic, responsibility, due_date, actual_submit, done, source_dates, active, removed_at, source_synced_at
  )
  select task_key, task_id, spreadsheet_id, sheet_gid, row_index, client_name, month,
    topic, responsibility, due_date, actual_submit, done, source_dates, true, null, p_synced_at
  from public.sync_stage_tasks where run_id = p_run_id
  on conflict (task_key) do update set
    task_id = excluded.task_id,
    spreadsheet_id = excluded.spreadsheet_id,
    sheet_gid = excluded.sheet_gid,
    row_index = excluded.row_index,
    client_name = excluded.client_name,
    month = excluded.month,
    topic = excluded.topic,
    responsibility = excluded.responsibility,
    due_date = excluded.due_date,
    actual_submit = excluded.actual_submit,
    done = excluded.done,
    source_dates = excluded.source_dates,
    active = true,
    removed_at = null,
    source_synced_at = p_synced_at
  where public.tasks_current.source_event_at is null or public.tasks_current.source_event_at <= p_synced_at;

  update public.tasks_current task set active = false, removed_at = p_synced_at
  where task.active
    and task.spreadsheet_id = any(coalesce(p_sheet_ids, array[]::text[]))
    and not exists (
      select 1 from public.sync_stage_tasks staged
      where staged.run_id = p_run_id and staged.task_key = task.task_key
    );

  insert into public.daily_metrics(snapshot_date, dimension, dimension_key, metrics, source_sync_id, updated_at)
  select metric.snapshot_date, metric.dimension, metric.dimension_key, metric.metrics, p_run_id, metric.updated_at
  from jsonb_to_recordset(coalesce(p_metric_rows, '[]'::jsonb)) as metric(
    snapshot_date date, dimension text, dimension_key text, metrics jsonb, updated_at timestamptz
  )
  on conflict (snapshot_date, dimension, dimension_key) do update set
    metrics = excluded.metrics,
    source_sync_id = p_run_id,
    updated_at = excluded.updated_at;

  select count(*) into applied from public.sync_stage_tasks where run_id = p_run_id;
  update public.sync_runs set
    status = 'success', task_count = applied,
    invalid_row_count = (select count(*) from jsonb_array_elements(coalesce(p_issues, '[]'::jsonb)) issue where issue ->> 'type' <> 'skipped_tab'),
    issues = coalesce(p_issues, '[]'::jsonb), error = null, finished_at = p_finished_at
  where id = p_run_id and status = 'running';

  delete from public.sync_stage_tasks where run_id = p_run_id;
  return applied;
end
$$;

revoke execute on function public.apply_sync_snapshot(uuid, timestamptz, text[], jsonb, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_sync_snapshot(uuid, timestamptz, text[], jsonb, jsonb, timestamptz) to service_role;


commit;
