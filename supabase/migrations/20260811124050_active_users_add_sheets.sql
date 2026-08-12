drop policy if exists sheets_admin_insert on public.sheets;
drop policy if exists sheets_active_insert on public.sheets;

create policy sheets_active_insert on public.sheets
for insert to authenticated
with check ((select private.is_active_user()));
