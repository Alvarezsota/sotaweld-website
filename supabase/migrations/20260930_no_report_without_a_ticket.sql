-- No weld report without a time ticket -- said by the database this time.
--
-- The rule already existed: the weld report screen greys out its Submit button
-- when the man has logged no hours for the day, and the job picker offers him
-- nothing but "Log your hours first...". Both were written in the page.
--
-- A rule that only the page knows is not a rule. Between 09-21 and 09-29 six
-- reports were filed before the man's ticket existed, and one of them was
-- Rumualdo on Monday the 28th: weld report at 8:43pm, hours at 8:04 the next
-- morning -- eleven hours later. The nightly reminder went out at 7pm saying he
-- owed both, which was true when it was sent.
--
-- Two ways past a page-side gate, and this covers both. A phone that keeps the
-- portal on its home screen holds the old JavaScript until somebody taps the
-- update bar, so the fix can be live for a week and absent from the one screen
-- that matters. And the gate fails open by design -- if the hours lookup errors
-- it does not restrict, on the grounds that a welder should not be locked out
-- by a bad connection. Neither of those reaches the database.
--
-- WHO THIS DOES NOT STOP
-- ---------------------------------------------------------------------------
-- An admin, because fixing a day nobody logged is exactly his job.
--
-- Anything with no signed-in person behind it -- the service role, cron, a
-- migration. They are not who this is for and stopping them breaks maintenance.
--
-- And the split credit. When Damian logs a 24" split with Rumualdo, a trigger
-- writes the other half onto Rumualdo's report. That write happens while
-- DAMIAN is the signed-in user, so the row's welder is not the person writing
-- it, and the rule does not apply. It must not: Rumualdo's paperwork is not
-- Damian's to be blocked by, and refusing it would fail Damian's submission for
-- something he cannot do anything about.

create or replace function public.weld_report_needs_a_ticket()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  -- Only a man filing his own report is held. See above for the three cases
  -- this deliberately lets through.
  if auth.uid() is null
     or new.welder_id is distinct from auth.uid()
     or public.is_admin(auth.uid()) then
    return new;
  end if;

  if not exists (
    select 1 from public.daily_entries d
    where d.welder_id = new.welder_id
      and d.entry_date = new.report_date
  ) then
    raise exception
      'Log your work for % on Log Work first. Your inches go against the job on your hours ticket.',
      to_char(new.report_date, 'FMMon FMDD')
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- BEFORE, so it refuses rather than letting the row land and undoing it, and so
-- it runs ahead of the two AFTER triggers that reconcile split credits.
drop trigger if exists weld_reports_need_a_ticket on public.weld_reports;
create trigger weld_reports_need_a_ticket
  before insert or update of welder_id, report_date, job_id on public.weld_reports
  for each row execute function public.weld_report_needs_a_ticket();

comment on function public.weld_report_needs_a_ticket() is
  'A welder cannot file his own weld report for a day he has logged no hours '
  'on. Admins, service-role writes and split credits written for a partner are '
  'exempt -- see the migration for why each one has to be.';
