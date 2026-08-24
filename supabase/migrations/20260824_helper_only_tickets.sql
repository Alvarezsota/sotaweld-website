-- Tickets with no welder on them, and the man who turned them in.
--
-- Applied to production 2026-08-24 as two migrations, `helper_only_tickets` and
-- `helper_ticket_supervisor`. Recorded here together because they are one change:
-- the first makes a helper-only ticket possible, the second makes it visible to
-- the welder who raised it, and the first is not much use on its own.
--
-- ---------------------------------------------------------------------------
-- 1. A ticket does not need a welder
-- ---------------------------------------------------------------------------
--
-- A day is sometimes worked by a helper or two with no welder there. welder_id
-- was NOT NULL, so every ticket had to name one and helper hours could only ride
-- along on somebody else's -- which meant a helper who worked alone either went
-- unbilled or got hung off a welder who was not on the job.
alter table public.daily_entries alter column welder_id drop not null;

comment on column public.daily_entries.welder_id is
  'The welder whose ticket this is. Null means a helper-only ticket: the hours on the row are 0 and the work is entirely in daily_entry_helpers.';

-- v_work_lines needs no change and is deliberately left alone. Its welder leg
-- inner-joins profiles on welder_id, so a null produces no welder line at all,
-- while the helper leg joins daily_entry_helpers and carries on as usual. That
-- is what makes a helper-only ticket cost and bill correctly everywhere at once.
-- approvals.js was taught to do the same rather than draw a blank row at zero
-- hours; the two were checked against each other and agree.

-- ---------------------------------------------------------------------------
-- 2. Who raised it
-- ---------------------------------------------------------------------------
--
-- With welder_id null, every policy reading "welder_id = auth.uid()" falls
-- through to admins, and the welder who stood there and watched the work could
-- not see the ticket he had just turned in. supervisor_id is that man.
--
-- It is not a second welder. It carries no hours, no pay rate and no bill rate,
-- v_work_lines does not read it, and it is set only on tickets raised from Log
-- Work -- a helper ticket the office raises in Approvals leaves it null, since
-- admins see everything regardless.
alter table public.daily_entries
  add column if not exists supervisor_id uuid references public.profiles(id) on delete set null;

comment on column public.daily_entries.supervisor_id is
  'The welder who raised this helper-only ticket, for visibility only. No hours, no rates. Null on tickets the office raises.';

create index if not exists daily_entries_supervisor_id_idx
  on public.daily_entries (supervisor_id) where supervisor_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Policies
-- ---------------------------------------------------------------------------
--
-- Insert stays deliberately tight: a man may file his own ticket, or a helper
-- ticket with himself as supervisor, and nothing else. Naming someone else as
-- the welder while putting his own name in supervisor_id matches neither branch,
-- so this cannot be used to file hours against another man. That is tested, not
-- assumed -- the attempt is refused by RLS.
drop policy if exists daily_entries_select on public.daily_entries;
create policy daily_entries_select on public.daily_entries for select
  using (welder_id = auth.uid() or supervisor_id = auth.uid() or is_admin(auth.uid()));

drop policy if exists daily_entries_update on public.daily_entries;
create policy daily_entries_update on public.daily_entries for update
  using (welder_id = auth.uid() or supervisor_id = auth.uid() or is_admin(auth.uid()));

drop policy if exists daily_entries_insert_own on public.daily_entries;
create policy daily_entries_insert_own on public.daily_entries for insert
  with check (welder_id = auth.uid()
              or (welder_id is null and supervisor_id = auth.uid())
              or is_admin(auth.uid()));

drop policy if exists "welders delete own entries" on public.daily_entries;
create policy "welders delete own entries" on public.daily_entries for delete
  using (welder_id = auth.uid()
         or (welder_id is null and supervisor_id = auth.uid()));

-- The helper rows are the whole content of a helper-only ticket, so the man who
-- raised it needs to read, add and clear them. Editing one is still delete and
-- re-insert, the way the page already saves, so no update policy is needed.
drop policy if exists daily_entry_helpers_select on public.daily_entry_helpers;
create policy daily_entry_helpers_select on public.daily_entry_helpers for select
  using (exists (select 1 from daily_entries de
                 where de.id = daily_entry_helpers.daily_entry_id
                   and (de.welder_id = auth.uid() or de.supervisor_id = auth.uid()
                        or is_admin(auth.uid()))));

drop policy if exists daily_entry_helpers_insert on public.daily_entry_helpers;
create policy daily_entry_helpers_insert on public.daily_entry_helpers for insert
  with check (exists (select 1 from daily_entries de
                      where de.id = daily_entry_helpers.daily_entry_id
                        and (de.welder_id = auth.uid() or de.supervisor_id = auth.uid()
                             or is_admin(auth.uid()))));

drop policy if exists "welders delete own entry helpers" on public.daily_entry_helpers;
create policy "welders delete own entry helpers" on public.daily_entry_helpers for delete
  using (exists (select 1 from daily_entries de
                 where de.id = daily_entry_helpers.daily_entry_id
                   and (de.welder_id = auth.uid() or de.supervisor_id = auth.uid())));
