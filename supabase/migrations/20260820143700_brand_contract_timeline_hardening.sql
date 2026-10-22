-- Harden the Brand timeline schema after the initial rollout.
-- Keep the helper deterministic even if a caller changes the session search_path.
create or replace function private.normalized_brand_key(value text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select regexp_replace(lower(trim(coalesce(value, ''))), '\s+', ' ', 'g')
$$;

-- Cover the foreign keys used by Brand navigation, notification cleanup and
-- audit joins. These indexes are intentionally additive and safe to rerun.
create index if not exists brand_workstream_sources_workstream_idx
  on public.brand_workstream_sources (workstream_id);
create index if not exists notifications_contract_id_idx
  on public.notifications (contract_id);
create index if not exists brand_workstreams_created_by_idx
  on public.brand_workstreams (created_by);
create index if not exists brand_workstreams_updated_by_idx
  on public.brand_workstreams (updated_by);
create index if not exists contract_rounds_closed_by_idx
  on public.contract_rounds (closed_by);
create index if not exists contract_rounds_created_by_idx
  on public.contract_rounds (created_by);
create index if not exists contract_rounds_updated_by_idx
  on public.contract_rounds (updated_by);
create index if not exists milestone_overrides_updated_by_idx
  on public.milestone_overrides (updated_by);

-- Avoid overlapping SELECT and FOR ALL policies on the new tables. Active
-- users keep read access; only Admins can insert, update or delete metadata.
drop policy if exists brand_workstreams_admin_write on public.brand_workstreams;
create policy brand_workstreams_admin_insert on public.brand_workstreams
  for insert to authenticated with check ((select private.is_admin()));
create policy brand_workstreams_admin_update on public.brand_workstreams
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy brand_workstreams_admin_delete on public.brand_workstreams
  for delete to authenticated using ((select private.is_admin()));

drop policy if exists brand_sources_admin_write on public.brand_workstream_sources;
create policy brand_sources_admin_insert on public.brand_workstream_sources
  for insert to authenticated with check ((select private.is_admin()));
create policy brand_sources_admin_update on public.brand_workstream_sources
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy brand_sources_admin_delete on public.brand_workstream_sources
  for delete to authenticated using ((select private.is_admin()));

drop policy if exists contract_rounds_admin_write on public.contract_rounds;
create policy contract_rounds_admin_insert on public.contract_rounds
  for insert to authenticated with check ((select private.is_admin()));
create policy contract_rounds_admin_update on public.contract_rounds
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy contract_rounds_admin_delete on public.contract_rounds
  for delete to authenticated using ((select private.is_admin()));

drop policy if exists milestone_overrides_admin_write on public.milestone_overrides;
create policy milestone_overrides_admin_insert on public.milestone_overrides
  for insert to authenticated with check ((select private.is_admin()));
create policy milestone_overrides_admin_update on public.milestone_overrides
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy milestone_overrides_admin_delete on public.milestone_overrides
  for delete to authenticated using ((select private.is_admin()));
