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

  delete from public.notification_preferences as preference
  where not exists (
    select 1
    from jsonb_array_elements_text(coalesce(p_owner_emails, '[]'::jsonb)) as selected(email)
    where lower(selected.email) = preference.email
  );

  insert into public.notification_preferences(email, owner_digest_enabled, updated_by, updated_at)
  select lower(value), true, p_actor, now()
  from jsonb_array_elements_text(coalesce(p_owner_emails, '[]'::jsonb))
  on conflict (email) do update set
    owner_digest_enabled = true,
    updated_by = p_actor,
    updated_at = now();

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
    subject = excluded.subject,
    greeting = excluded.greeting,
    intro = excluded.intro,
    reminder = excluded.reminder,
    description = excluded.description,
    closing = excluded.closing,
    updated_by = excluded.updated_by,
    updated_by_email = excluded.updated_by_email,
    updated_at = excluded.updated_at;
end
$$;

revoke execute on function public.save_notification_setup(jsonb, jsonb, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.save_notification_setup(jsonb, jsonb, jsonb, uuid, text) to service_role;
