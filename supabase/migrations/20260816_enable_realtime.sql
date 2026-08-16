-- Publish the crew portal's tables so the pages update as work is logged.
--
-- Symptom this fixes: the Weld Log showed the hours a ticket was originally
-- submitted with. Correcting the ticket in Approvals changed the database but
-- nothing told the open page to look again, so it kept the stale number until
-- someone reloaded by hand.
--
-- The pages now subscribe to changes on these tables. Postgres only sends
-- changes for tables in the supabase_realtime publication, so without this the
-- subscriptions connect but never hear anything, and the portal quietly falls
-- back to refreshing when a tab comes back into view.
--
-- Row-level security still applies: the client passes its access token to
-- Realtime, so a welder is only sent changes to rows they could already read.
--
-- Safe to re-run — each table is added only if it isn't published already.

do $$
declare
  t text;
begin
  foreach t in array array[
    'daily_entries',
    'daily_entry_helpers',
    'daily_entry_parts',
    'weld_reports',
    'job_weeks',
    'announcements',
    'quote_requests'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Confirmation: expect all seven tables listed.
select tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename in (
    'daily_entries','daily_entry_helpers','daily_entry_parts',
    'weld_reports','job_weeks','announcements','quote_requests'
  )
order by tablename;
