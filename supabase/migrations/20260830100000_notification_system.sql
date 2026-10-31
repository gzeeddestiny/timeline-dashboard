begin;

alter table public.task_workflow
  add column if not exists next_action text not null default '' check (length(next_action) <= 2000);

create table if not exists public.task_activity_state (
  task_key text primary key references public.tasks_current(task_key) on delete cascade,
  first_seen_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  last_activity_kind text not null default 'task_discovered',
  last_activity_source text not null default 'system' check (last_activity_source in ('system', 'dashboard', 'google_sheet')),
  last_activity_actor_email text,
  snoozed_until date,
  snooze_reason text check (snooze_reason is null or length(snooze_reason) between 1 and 500),
  snoozed_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  check (snoozed_until is null or snooze_reason is not null)
);

create index if not exists task_activity_stale_idx
  on public.task_activity_state (last_activity_at, snoozed_until);

insert into public.task_activity_state (
  task_key, first_seen_at, last_activity_at, last_activity_kind, last_activity_source, last_activity_actor_email
)
select task.task_key,
  now(),
  coalesce(greatest(workflow.updated_at, events.last_event_at), workflow.updated_at, events.last_event_at, now()),
  case when workflow.updated_at is not null or events.last_event_at is not null then 'historical_update' else 'task_discovered' end,
  case when workflow.updated_at is not null then 'dashboard' else 'system' end,
  events.actor_email
from public.tasks_current task
left join public.task_workflow workflow on workflow.task_key = task.task_key
left join lateral (
  select max(created_at) as last_event_at,
    (array_agg(actor_email order by created_at desc) filter (where actor_email is not null))[1] as actor_email
  from public.task_events where record_key = task.task_key
) events on true
on conflict (task_key) do nothing;

create or replace function private.track_task_source_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  changed boolean;
begin
  if TG_OP = 'INSERT' then
    insert into public.task_activity_state(task_key, first_seen_at, last_activity_at, last_activity_kind, last_activity_source)
    values (new.task_key, now(), now(), 'task_discovered', 'system')
    on conflict (task_key) do nothing;
    return new;
  end if;

  changed := row(
    old.topic, old.responsibility, old.due_date, old.actual_submit, old.done
  ) is distinct from row(
    new.topic, new.responsibility, new.due_date, new.actual_submit, new.done
  );
  if changed then
    insert into public.task_activity_state(
      task_key, first_seen_at, last_activity_at, last_activity_kind, last_activity_source,
      snoozed_until, snooze_reason, snoozed_by, updated_at
    ) values (new.task_key, now(), now(), 'task_fields_changed', 'google_sheet', null, null, null, now())
    on conflict (task_key) do update set
      last_activity_at = excluded.last_activity_at,
      last_activity_kind = excluded.last_activity_kind,
      last_activity_source = excluded.last_activity_source,
      last_activity_actor_email = null,
      snoozed_until = null, snooze_reason = null, snoozed_by = null,
      updated_at = now();
  end if;
  return new;
end $$;

drop trigger if exists track_task_source_activity on public.tasks_current;
create trigger track_task_source_activity after insert or update on public.tasks_current
for each row execute function private.track_task_source_activity();

create or replace function private.track_workflow_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor_mail text;
  kind text;
begin
  if TG_OP = 'UPDATE' and row(old.status, old.note, old.priority, old.next_action)
    is not distinct from row(new.status, new.note, new.priority, new.next_action) then
    return new;
  end if;
  select lower(email) into actor_mail from auth.users where id = new.updated_by;
  kind := case
    when TG_OP = 'INSERT' then 'workflow_created'
    when old.next_action is distinct from new.next_action then 'next_action_changed'
    when old.status is distinct from new.status then 'status_changed'
    when old.note is distinct from new.note then 'note_changed'
    else 'priority_changed'
  end;
  insert into public.task_activity_state(
    task_key, first_seen_at, last_activity_at, last_activity_kind, last_activity_source,
    last_activity_actor_email, snoozed_until, snooze_reason, snoozed_by, updated_at
  ) values (new.task_key, now(), now(), kind, 'dashboard', actor_mail, null, null, null, now())
  on conflict (task_key) do update set
    last_activity_at = excluded.last_activity_at,
    last_activity_kind = excluded.last_activity_kind,
    last_activity_source = excluded.last_activity_source,
    last_activity_actor_email = excluded.last_activity_actor_email,
    snoozed_until = null, snooze_reason = null, snoozed_by = null,
    updated_at = now();
  return new;
end $$;

drop trigger if exists track_workflow_activity on public.task_workflow;
create trigger track_workflow_activity after insert or update on public.task_workflow
for each row execute function private.track_workflow_activity();

drop function if exists public.patch_task_workflow(text, public.workflow_status, boolean, text, boolean, text, boolean, uuid, bigint, boolean);
create function public.patch_task_workflow(
  p_task_key text,
  p_status public.workflow_status,
  p_has_status boolean,
  p_note text,
  p_has_note boolean,
  p_priority text,
  p_has_priority boolean,
  p_next_action text,
  p_has_next_action boolean,
  p_actor uuid,
  p_expected_note_version bigint,
  p_force_note boolean
)
returns public.task_workflow
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.task_workflow;
  next_status public.workflow_status;
  next_action_value text;
begin
  select * into saved from public.task_workflow where task_key = p_task_key for update;
  if found and p_has_note and not p_force_note and coalesce(p_expected_note_version, -1) <> saved.note_version then
    raise exception 'NOTE_CONFLICT' using errcode = '40001';
  end if;
  next_status := case when p_has_status then p_status else coalesce(saved.status, 'not_started'::public.workflow_status) end;
  next_action_value := trim(case when p_has_next_action then coalesce(p_next_action, '') else coalesce(saved.next_action, '') end);
  if next_status in ('in_progress', 'waiting_client', 'blocked') and next_action_value = '' then
    raise exception 'NEXT_ACTION_REQUIRED' using errcode = '23514';
  end if;

  insert into public.task_workflow(task_key, status, note, priority, next_action, updated_by, updated_at, note_version)
  values (
    p_task_key,
    next_status,
    case when p_has_note then coalesce(p_note, '') else '' end,
    case when p_has_priority then p_priority else null end,
    next_action_value,
    p_actor, now(), case when p_has_note then 1 else 0 end
  )
  on conflict (task_key) do update set
    status = next_status,
    note = case when p_has_note then excluded.note else task_workflow.note end,
    priority = case when p_has_priority then excluded.priority else task_workflow.priority end,
    next_action = next_action_value,
    note_version = case when p_has_note then task_workflow.note_version + 1 else task_workflow.note_version end,
    updated_by = p_actor,
    updated_at = now()
  returning * into saved;
  return saved;
end $$;

revoke execute on function public.patch_task_workflow(text, public.workflow_status, boolean, text, boolean, text, boolean, text, boolean, uuid, bigint, boolean) from public, anon, authenticated;
grant execute on function public.patch_task_workflow(text, public.workflow_status, boolean, text, boolean, text, boolean, text, boolean, uuid, bigint, boolean) to service_role;

create or replace function public.finalize_completion(
  p_task_key text,
  p_row_index integer,
  p_done boolean,
  p_actual_submit date,
  p_actor uuid,
  p_actor_email text,
  p_synced_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_row public.tasks_current;
  after_row public.tasks_current;
begin
  select * into before_row from public.tasks_current where task_key = p_task_key and active for update;
  if not found then raise exception 'Task unavailable'; end if;
  update public.tasks_current set
    row_index = p_row_index, done = p_done, actual_submit = p_actual_submit,
    source_synced_at = p_synced_at
  where task_key = p_task_key
  returning * into after_row;
  insert into public.task_activity_state(
    task_key, first_seen_at, last_activity_at, last_activity_kind, last_activity_source,
    last_activity_actor_email, snoozed_until, snooze_reason, snoozed_by, updated_at
  ) values (
    p_task_key, now(), now(), case when p_done then 'task_completed' else 'task_reopened' end,
    'dashboard', lower(p_actor_email), null, null, null, now()
  ) on conflict (task_key) do update set
    last_activity_at = excluded.last_activity_at,
    last_activity_kind = excluded.last_activity_kind,
    last_activity_source = excluded.last_activity_source,
    last_activity_actor_email = excluded.last_activity_actor_email,
    snoozed_until = null, snooze_reason = null, snoozed_by = null,
    updated_at = now();
  insert into public.task_events(resource, record_key, event_type, before_value, after_value, actor, actor_email)
  values ('tasks_current', p_task_key, 'update', to_jsonb(before_row), to_jsonb(after_row), p_actor, lower(p_actor_email));
end
$$;

revoke execute on function public.finalize_completion(text, integer, boolean, date, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.finalize_completion(text, integer, boolean, date, uuid, text, timestamptz) to service_role;

create table if not exists public.notification_settings (
  id boolean primary key default true check (id),
  daily_enabled boolean not null default false,
  no_activity_enabled boolean not null default false,
  manual_enabled boolean not null default false,
  daily_time time not null default '09:00',
  no_activity_time time not null default '09:15',
  timezone text not null default 'Asia/Bangkok' check (timezone = 'Asia/Bangkok'),
  sender_name text not null default 'Timeline Notifications' check (length(sender_name) between 1 and 100),
  primary_owner_email text,
  test_email_sent_at timestamptz,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
insert into public.notification_settings(id) values (true) on conflict (id) do nothing;

create table if not exists public.notification_preferences (
  email text primary key references public.access_list(email) on update cascade on delete cascade,
  owner_digest_enabled boolean not null default false,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_templates (
  template_type text not null check (template_type in ('daily_digest', 'no_activity', 'manual')),
  audience text not null check (audience in ('employee', 'owner')),
  subject text not null check (length(subject) between 1 and 200),
  greeting text not null default '' check (length(greeting) <= 500),
  intro text not null default '' check (length(intro) <= 1000),
  reminder text not null default '' check (length(reminder) <= 1000),
  description text not null default '' check (length(description) <= 1000),
  closing text not null default '' check (length(closing) <= 1000),
  updated_by uuid references auth.users(id),
  updated_by_email text,
  updated_at timestamptz not null default now(),
  primary key (template_type, audience),
  check (template_type = 'daily_digest' or audience = 'employee')
);

insert into public.notification_templates(template_type, audience, subject, greeting, intro, reminder, description, closing)
values
  ('daily_digest', 'employee', '[Daily Digest] {{employee_name}} — {{attention_count}} งานที่ต้องติดตาม', 'สวัสดี {{employee_name}}', 'สรุปงานที่ต้องติดตามประจำวันที่ {{digest_date}}', 'กรุณาตรวจสอบ Deadline, Last Update และ Next Action ของแต่ละงาน', 'รายการเรียงจากงานที่เร่งด่วนที่สุด', 'เปิด Dashboard เพื่อดูรายละเอียดและอัปเดตความคืบหน้า'),
  ('daily_digest', 'owner', '[Company Daily Digest] {{employee_count}} คน · {{attention_count}} งาน', 'สวัสดี {{employee_name}}', 'ภาพรวมงานที่ต้องติดตามทั้งบริษัทประจำวันที่ {{digest_date}}', 'ตรวจสอบงาน Overdue, ใกล้ Deadline และงานที่ไม่มีความคืบหน้า', 'รายการจัดกลุ่มตามพนักงานและเรียงตามความเร่งด่วน', 'เปิด Follow-up เพื่อดูรายการทั้งหมด'),
  ('no_activity', 'employee', '[No Activity] {{employee_name}} — {{stale_count}} งานไม่มีความคืบหน้า', 'สวัสดี {{employee_name}}', 'พบงานที่ไม่มี Activity ใหม่ครบ 5 วัน', 'กรุณาอัปเดต Status, Note หรือ Next Action หากงานมีความคืบหน้า', 'หากกำลังรอลูกค้าหรือติดข้อจำกัด สามารถ Snooze พร้อมระบุเหตุผลได้', 'เปิด My Work เพื่อจัดการรายการทั้งหมด'),
  ('manual', 'employee', '[ติดตามงาน] {{project_name}} — {{task_count}} งาน', 'สวัสดี {{employee_name}}', 'มีรายการงานที่ต้องการติดตามเพิ่มเติม', 'กรุณาตรวจสอบรายละเอียดและ Next Action', 'ข้อความนี้ส่งโดยผู้ดูแลระบบ', 'เปิด Dashboard เพื่อดูรายละเอียดงาน')
on conflict (template_type, audience) do nothing;

create or replace function public.save_notification_setup(
  p_settings jsonb,
  p_owner_emails jsonb,
  p_templates jsonb,
  p_actor uuid,
  p_actor_email text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notification_settings set
    daily_enabled = (p_settings->>'daily_enabled')::boolean,
    no_activity_enabled = (p_settings->>'no_activity_enabled')::boolean,
    manual_enabled = (p_settings->>'manual_enabled')::boolean,
    daily_time = (p_settings->>'daily_time')::time,
    no_activity_time = (p_settings->>'no_activity_time')::time,
    sender_name = p_settings->>'sender_name',
    primary_owner_email = nullif(p_settings->>'primary_owner_email', ''),
    updated_by = p_actor,
    updated_at = now()
  where id = true;

  delete from public.notification_preferences;
  insert into public.notification_preferences(email, owner_digest_enabled, updated_by, updated_at)
  select lower(value), true, p_actor, now()
  from jsonb_array_elements_text(p_owner_emails)
  on conflict (email) do update set owner_digest_enabled = true, updated_by = p_actor, updated_at = now();

  insert into public.notification_templates(
    template_type, audience, subject, greeting, intro, reminder, description, closing,
    updated_by, updated_by_email, updated_at
  )
  select row.template_type, row.audience, row.subject, row.greeting, row.intro,
    row.reminder, row.description, row.closing, p_actor, lower(p_actor_email), now()
  from jsonb_to_recordset(p_templates) as row(
    template_type text, audience text, subject text, greeting text, intro text,
    reminder text, description text, closing text
  )
  on conflict (template_type, audience) do update set
    subject = excluded.subject, greeting = excluded.greeting, intro = excluded.intro,
    reminder = excluded.reminder, description = excluded.description, closing = excluded.closing,
    updated_by = excluded.updated_by, updated_by_email = excluded.updated_by_email, updated_at = excluded.updated_at;
end
$$;
revoke execute on function public.save_notification_setup(jsonb, jsonb, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.save_notification_setup(jsonb, jsonb, jsonb, uuid, text) to service_role;

create table if not exists public.notification_batches (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('daily_digest', 'no_activity', 'manual')),
  audience text not null default 'employee' check (audience in ('employee', 'owner')),
  recipient_email text not null,
  business_date date not null,
  task_keys jsonb not null default '[]'::jsonb check (jsonb_typeof(task_keys) = 'array'),
  task_snapshot jsonb not null default '[]'::jsonb check (jsonb_typeof(task_snapshot) = 'array'),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  template_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(template_snapshot) = 'object'),
  custom_message text check (custom_message is null or length(custom_message) <= 1000),
  dedupe_key text not null unique,
  duplicate_fingerprint text,
  triggered_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists notification_batches_history_idx on public.notification_batches(created_at desc, type);
create index if not exists notification_batches_manual_duplicate_idx on public.notification_batches(duplicate_fingerprint, created_at desc) where type = 'manual';

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.notification_batches(id) on delete cascade,
  channel text not null check (channel in ('email', 'in_app')),
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'unknown')),
  priority smallint not null default 10,
  attempts smallint not null default 0 check (attempts between 0 and 4),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(batch_id, channel)
);
create index if not exists notification_delivery_queue_idx on public.notification_deliveries(status, next_attempt_at, priority, created_at);

alter table public.notifications add column if not exists batch_id uuid references public.notification_batches(id) on delete cascade;
alter table public.notifications add column if not exists payload jsonb not null default '{}'::jsonb;
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('assignment', 'blocked', 'due', 'stale', 'contract_expiry', 'no_activity_batch', 'manual_batch', 'delivery_failure'));

create or replace function public.claim_notification_deliveries(p_limit integer default 100)
returns setof public.notification_deliveries
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with candidates as (
    select id from public.notification_deliveries
    where channel = 'email' and status = 'queued' and next_attempt_at <= now()
    order by priority asc, created_at asc
    for update skip locked limit least(greatest(p_limit, 1), 100)
  )
  update public.notification_deliveries delivery set
    status = 'sending', attempts = delivery.attempts + 1, updated_at = now()
  from candidates where delivery.id = candidates.id
  returning delivery.*;
end $$;
revoke execute on function public.claim_notification_deliveries(integer) from public, anon, authenticated;
grant execute on function public.claim_notification_deliveries(integer) to service_role;

alter table public.task_activity_state enable row level security;
alter table public.notification_settings enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notification_templates enable row level security;
alter table public.notification_batches enable row level security;
alter table public.notification_deliveries enable row level security;

create policy task_activity_admin_read on public.task_activity_state for select to authenticated using ((select private.is_admin()));
create policy notification_settings_admin on public.notification_settings for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy notification_preferences_admin on public.notification_preferences for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy notification_templates_admin on public.notification_templates for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy notification_batches_admin_read on public.notification_batches for select to authenticated using ((select private.is_admin()));
create policy notification_deliveries_admin_read on public.notification_deliveries for select to authenticated using ((select private.is_admin()));

revoke all on table public.task_activity_state, public.notification_settings, public.notification_preferences,
  public.notification_templates, public.notification_batches, public.notification_deliveries from anon;
grant select on table public.task_activity_state, public.notification_settings, public.notification_preferences,
  public.notification_templates, public.notification_batches, public.notification_deliveries to authenticated;
grant all on table public.task_activity_state, public.notification_settings, public.notification_preferences,
  public.notification_templates, public.notification_batches, public.notification_deliveries to service_role;

create or replace function private.purge_operational_history()
returns void language sql security definer set search_path = public as $$
  delete from public.daily_metrics where snapshot_date < current_date - 365;
  delete from public.sync_runs where started_at < now() - interval '90 days';
  delete from public.notifications where created_at < now() - interval '90 days';
  delete from public.notification_batches where created_at < now() - interval '90 days';
$$;

commit;
