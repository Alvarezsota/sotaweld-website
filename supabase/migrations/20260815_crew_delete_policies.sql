-- Let welders delete their own tickets.
--
-- Symptom this fixes: a welder confirms "Delete this ticket?" and nothing
-- happens, and editing a ticket doubles its helper/parts lines. Both come from
-- DELETE being refused on these three tables — Postgres removes zero rows and
-- reports no error, so the app could not tell the difference from success.
--
-- Each policy is scoped to auth.uid(), so a welder can only ever remove their
-- own work. Office/admin policies are left untouched.
--
-- Safe to re-run.

drop policy if exists "welders delete own entries" on daily_entries;
create policy "welders delete own entries"
on daily_entries for delete to authenticated
using (welder_id = auth.uid());

drop policy if exists "welders delete own entry helpers" on daily_entry_helpers;
create policy "welders delete own entry helpers"
on daily_entry_helpers for delete to authenticated
using (exists (select 1 from daily_entries de
               where de.id = daily_entry_helpers.daily_entry_id
                 and de.welder_id = auth.uid()));

drop policy if exists "welders delete own entry parts" on daily_entry_parts;
create policy "welders delete own entry parts"
on daily_entry_parts for delete to authenticated
using (exists (select 1 from daily_entries de
               where de.id = daily_entry_parts.daily_entry_id
                 and de.welder_id = auth.uid()));

-- Confirmation: expect one row per table.
select tablename, policyname, cmd
from pg_policies
where tablename in ('daily_entries','daily_entry_helpers','daily_entry_parts')
  and cmd = 'DELETE'
order by tablename;
