-- Point supervisor_id at auth.users instead of profiles.
--
-- Applied to production 2026-08-24, fixing an outage the migration before it
-- caused. Worth reading before adding any column that references profiles.
--
-- ---------------------------------------------------------------------------
-- WHAT BROKE
-- ---------------------------------------------------------------------------
--
-- supervisor_id was added as a second foreign key from daily_entries to
-- profiles. PostgREST resolves an embed like
--
--   daily_entries -> profiles(full_name, pay_rate, bill_rate)
--
-- by finding the relationship between the two tables. With two of them and no
-- hint saying which, it cannot choose, so it rejects the request rather than
-- guessing. The Approvals page asks for exactly that embed to load a week, so
-- its whole query started failing and the page drew an empty grid: every job
-- tile, every ticket, gone from the screen.
--
-- Nothing was deleted. All 27 jobs, 81 tickets and 58 helper rows were sitting
-- there the entire time, unreadable through that one query. The Summary page was
-- unaffected because it goes through get_week_summary, and Log Work because it
-- selects columns without embedding.
--
-- ---------------------------------------------------------------------------
-- THE FIX, AND WHY IT IS HERE AND NOT IN THE JAVASCRIPT
-- ---------------------------------------------------------------------------
--
-- profiles.id is auth.users.id, so pointing supervisor_id at auth.users keeps
-- exactly the same integrity - a supervisor is still a real login, and still
-- clears to null if that login is deleted - while leaving daily_entries with a
-- single relationship to profiles. The embeds resolve again with nothing to
-- disambiguate.
--
-- Naming the constraint in the client would also have worked:
--   .select('*, profiles!daily_entries_welder_id_fkey(...)')
-- but every browser holding the old file would have stayed broken until it
-- refreshed, and the office should not have to do anything to get their week
-- back. A server-side fix reaches every client at once, cached or not.
--
-- ---------------------------------------------------------------------------
-- IF YOU ADD ANOTHER COLUMN POINTING AT A PERSON
-- ---------------------------------------------------------------------------
--
-- Reference auth.users, not profiles, unless you mean to embed it. A second
-- foreign key to profiles silently breaks every unhinted embed of the first one,
-- and it breaks them at read time in the browser, not here where you would see
-- it. This migration ran clean and still took the Approvals page down.

alter table public.daily_entries
  drop constraint if exists daily_entries_supervisor_id_fkey;

alter table public.daily_entries
  add constraint daily_entries_supervisor_id_fkey
  foreign key (supervisor_id) references auth.users(id) on delete set null;

comment on column public.daily_entries.supervisor_id is
  'The welder who raised this helper-only ticket, for visibility only. No hours, no rates. Null on tickets the office raises. References auth.users rather than profiles so daily_entries keeps a single relationship to profiles and PostgREST embeds of the welder stay unambiguous.';

notify pgrst, 'reload schema';
