begin;

-- Timeline edits that miss the Sheet edit trigger (formulas, API writes, paste
-- failures, untracked tabs) are still activity. Sync records them with sync-time
-- precision; a later exact Sheet event replaces the approximate one.
alter table public.task_activity_state add column if not exists resumed_at timestamptz;
alter table public.task_activity_state add column if not exists last_activity_actor_inferred boolean not null default false;

-- Where an edit happened and who made it when Google hides the editor from the edit trigger.
alter table public.action_events add column if not exists spreadsheet_id text;
alter table public.action_events add column if not exists sheet_name text;
alter table public.action_events add column if not exists cell_range text;
alter table public.action_events add column if not exists inferred_actor_email text;
alter table public.action_events add column if not exists inferred_actor_name text;
alter table public.action_events add column if not exists inferred_candidates text[] not null default '{}';
alter table public.action_events add column if not exists actor_attribution text;
alter table public.action_events drop constraint if exists action_events_actor_attribution_check;
alter table public.action_events add constraint action_events_actor_attribution_check
  check (actor_attribution is null or actor_attribution in ('revision_single_editor','revision_ambiguous','unknown'));
create index if not exists action_events_unattributed_idx on public.action_events(occurred_at)
  where source = 'google_sheet' and actor_email is null and actor_attribution is null;
create index if not exists action_events_actor_idx on public.action_events(lower(coalesce(actor_email, inferred_actor_email)), occurred_at desc);

create table if not exists public.sheet_revisions (
  spreadsheet_id text not null references public.sheets(spreadsheet_id) on delete cascade,
  revision_id text not null,
  spreadsheet_name text,
  modified_at timestamptz not null,
  editor_email text,
  editor_name text,
  received_at timestamptz not null default now(),
  primary key (spreadsheet_id, revision_id)
);
create index if not exists sheet_revisions_time_idx on public.sheet_revisions(spreadsheet_id, modified_at);
create index if not exists sheet_revisions_editor_idx on public.sheet_revisions(lower(editor_email), modified_at desc);
alter table public.sheet_revisions enable row level security;
revoke all on public.sheet_revisions from public, anon, authenticated;
grant select, insert, update on public.sheet_revisions to service_role;
alter table public.action_events drop constraint if exists action_events_time_precision_check;
alter table public.action_events add constraint action_events_time_precision_check
  check (time_precision in ('exact','minute','version','sync'));

create or replace function private.record_action(
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
     last_activity_actor_inferred = false, last_action_changes = excluded.last_action_changes,
     -- Marks a task that was silent for the No Activity window and has just been updated.
     resumed_at = case when public.task_activity_state.last_activity_at <= excluded.last_activity_at - interval '120 hours'
       then excluded.last_activity_at else public.task_activity_state.resumed_at end,
     snoozed_until = null, snooze_reason = null, snoozed_by = null, updated_at = now()
   where excluded.last_activity_at >= public.task_activity_state.last_activity_at
      or public.task_activity_state.last_activity_kind = 'task_discovered';
 end loop;
 return event_id;
end $$;
revoke all on function private.record_action(text,timestamptz,text,text,text[],jsonb,text,uuid,text,text) from public,anon,authenticated;

create or replace function private.task_source_fields(t public.tasks_current, dates jsonb) returns jsonb
language sql immutable set search_path = '' as $$
 select jsonb_build_object('done',t.done,'due_date',t.due_date,'actual_submit',t.actual_submit,'responsibility',t.responsibility)
 || coalesce((select jsonb_object_agg('date:' || key, value) from jsonb_each(coalesce(dates,'{}'::jsonb))), '{}'::jsonb)
$$;

create or replace function private.track_task_source_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare event_id uuid;
begin
 if TG_OP = 'INSERT' then
   insert into public.task_activity_state(task_key) values(new.task_key) on conflict do nothing;
 elsif current_setting('app.action_write', true) is distinct from 'yes'
 and row(old.done, old.due_date, old.actual_submit, case when old.source_dates='{}'::jsonb then new.source_dates else old.source_dates end, old.responsibility)
 is distinct from row(new.done, new.due_date, new.actual_submit, new.source_dates, new.responsibility) then
   event_id := private.record_action('sync:' || gen_random_uuid()::text, now(), 'google_sheet', 'sheet_sync_detected', array[new.task_key],
     private.action_diff(
       private.task_source_fields(old, case when old.source_dates='{}'::jsonb then new.source_dates else old.source_dates end),
       private.task_source_fields(new, new.source_dates)));
   update public.action_events set evidence_source = 'sync_snapshot', time_precision = 'sync', spreadsheet_id = new.spreadsheet_id where id = event_id;
 end if;
 return new;
end $$;

create or replace function public.ingest_sheet_action(p_event jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare k text; at_time timestamptz; changes_value jsonb; entry record; t public.tasks_current; replaced public.action_events; event_id uuid;
begin
 k := p_event->>'taskKey'; at_time := (p_event->>'occurredAt')::timestamptz;
 if exists(select 1 from public.action_events where dedupe_key = p_event->>'id') then return; end if;
 select * into t from public.tasks_current where task_key=k for update;
 if not found then raise exception 'Task not synced yet'; end if;
 changes_value := p_event->'changes';
 -- A delayed exact event supersedes the sync-time record of the same edit.
 if changes_value <> '{}'::jsonb then
   delete from public.action_events where id = (
     select e.id from public.action_events e where e.kind = 'sheet_sync_detected' and e.task_keys = array[k] and e.occurred_at >= at_time
       and not exists(select 1 from jsonb_each(e.changes) s where changes_value->s.key->'after' is distinct from s.value->'after')
     order by e.occurred_at limit 1)
   returning * into replaced;
   if replaced.id is not null then
     update public.task_activity_state set last_activity_at = at_time
     where task_key = k and last_activity_kind = 'sheet_sync_detected' and last_activity_at = replaced.occurred_at;
   end if;
 end if;
 event_id := private.record_action(p_event->>'id',at_time,p_event->>'source','sheet_fields_changed',array[k],changes_value,
 p_event->>'actorEmail',null,null,p_event->>'historyGap');
 if event_id is not null then
   update public.action_events set spreadsheet_id = t.spreadsheet_id,
     sheet_name = nullif(left(p_event->>'sheetName',200),''), cell_range = nullif(left(p_event->>'range',100),'')
   where id = event_id;
 end if;
 if changes_value = '{}'::jsonb then return; end if;
   perform set_config('app.action_write','yes',true);
   for entry in select * from jsonb_each(changes_value) loop
     -- Other cells in the row are history only; they have no task snapshot column.
     if entry.key like 'cell:%' then continue; end if;
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
    resumed_at=case when last_activity_at <= event_time - interval '120 hours' then event_time else resumed_at end,
    last_activity_at=event_time,last_activity_kind='history_backfill',last_activity_source='google_sheet',
    last_activity_actor_email=nullif(p_event->>'actorEmail',''),last_activity_actor_inferred=false,last_action_changes=p_event->'changes',
    history_gap=null,updated_at=now()
  where task_key=task_row.task_key
    and (last_activity_kind='task_discovered' or last_activity_at is null or event_time>last_activity_at);
  return 'inserted';
end $$;
revoke all on function public.ingest_verified_history(jsonb) from public,anon,authenticated;
grant execute on function public.ingest_verified_history(jsonb) to service_role;

-- V2 plan dates and comments are updates to the task as well.
create or replace function private.track_v2_plan_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare b jsonb; actor_mail text;
begin
 b := case when TG_OP = 'INSERT' then jsonb_build_object('start_date',null,'end_date',null)
 else jsonb_build_object('start_date',old.start_date,'end_date',old.end_date) end;
 select email into actor_mail from auth.users where id = new.updated_by;
 perform private.record_action(gen_random_uuid()::text, now(), 'dashboard', 'v2_plan_changed', array[new.task_key],
   private.action_diff(b, jsonb_build_object('start_date',new.start_date,'end_date',new.end_date)), actor_mail);
 return new;
end $$;
create or replace function private.track_v2_comment_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if new.deleted or (TG_OP = 'UPDATE' and new.body is not distinct from old.body) then return new; end if;
 perform private.record_action(gen_random_uuid()::text, now(), 'dashboard', 'v2_comment', array[new.task_key],
   jsonb_build_object('comment', jsonb_build_object('before', case when TG_OP = 'UPDATE' then left(old.body,200) end, 'after', left(new.body,200))),
   new.author_email);
 return new;
end $$;
-- Production may not have the V2 tables yet; timeline_v2 attaches these triggers when it runs later.
do $$ begin
 if to_regclass('public.v2_plans') is not null then
   drop trigger if exists track_v2_plan_activity on public.v2_plans;
   create trigger track_v2_plan_activity after insert or update on public.v2_plans
   for each row execute function private.track_v2_plan_activity();
 end if;
 if to_regclass('public.v2_comments') is not null then
   drop trigger if exists track_v2_comment_activity on public.v2_comments;
   create trigger track_v2_comment_activity after insert or update on public.v2_comments
   for each row execute function private.track_v2_comment_activity();
 end if;
end $$;

-- Names the editor of Sheet events that arrived without one, using Drive version history.
-- A revision's time closes a merged editing window, so the edit precedes it. Only a window
-- with exactly one visible editor is attributed; several editors are listed, never guessed.
create or replace function public.attribute_sheet_actors(p_since timestamptz, p_collected_at timestamptz default now())
returns integer language plpgsql security definer set search_path = '' as $$
declare
 e record; people text[]; hidden integer; person text; person_name text;
 window_start timestamptz; window_end timestamptz; changed integer := 0;
begin
 for e in select a.id, a.occurred_at, a.kind, a.task_keys,
     coalesce(a.spreadsheet_id, nullif(split_part(a.task_keys[1], ':', 1), '')) as sheet_id
   from public.action_events a
   where a.source = 'google_sheet' and a.actor_email is null and a.actor_attribution is null
     and a.kind <> 'history_backfill' and a.occurred_at >= p_since
   order by a.occurred_at limit 5000
 loop
   if e.kind = 'sheet_sync_detected' then
     window_start := e.occurred_at - interval '35 minutes'; window_end := e.occurred_at;
   else
     window_start := e.occurred_at - interval '2 minutes'; window_end := e.occurred_at + interval '15 minutes';
   end if;
   -- Revisions for this window may not have been collected yet.
   if window_end > p_collected_at then continue; end if;
   select coalesce(array_agg(distinct coalesce(lower(r.editor_email), 'name:' || r.editor_name))
            filter (where coalesce(r.editor_email, r.editor_name) is not null), '{}'),
          count(*) filter (where r.editor_email is null and r.editor_name is null)
   into people, hidden
   from public.sheet_revisions r
   where r.spreadsheet_id = e.sheet_id and r.modified_at between window_start and window_end;
   if cardinality(people) = 1 and hidden = 0 then
     person := people[1];
     if person like 'name:%' then person_name := substr(person, 6); person := null;
     else
       select r.editor_name into person_name from public.sheet_revisions r
       where r.spreadsheet_id = e.sheet_id and lower(r.editor_email) = person and r.modified_at between window_start and window_end
       order by r.modified_at desc limit 1;
     end if;
     update public.action_events set inferred_actor_email = person, inferred_actor_name = person_name,
       actor_attribution = 'revision_single_editor' where id = e.id;
     if person is not null then
       update public.task_activity_state set last_activity_actor_email = person, last_activity_actor_inferred = true
       where task_key = any(e.task_keys) and last_activity_at = e.occurred_at and last_activity_actor_email is null;
     end if;
   elsif cardinality(people) > 1 or (cardinality(people) = 1 and hidden > 0) then
     update public.action_events set actor_attribution = 'revision_ambiguous',
       inferred_candidates = array(select regexp_replace(p, '^name:', '') from unnest(people) p order by 1) where id = e.id;
   elsif window_end < p_collected_at - interval '2 hours' then
     update public.action_events set actor_attribution = 'unknown' where id = e.id;
   else
     continue;
   end if;
   changed := changed + 1;
 end loop;
 return changed;
end $$;
revoke all on function public.attribute_sheet_actors(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.attribute_sheet_actors(timestamptz, timestamptz) to service_role;

commit;
