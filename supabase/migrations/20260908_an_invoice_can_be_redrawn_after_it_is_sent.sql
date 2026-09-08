-- What was on an invoice has to stay knowable after the invoice is sent.
--
-- ---------------------------------------------------------------------------
-- WHAT WENT WRONG
-- ---------------------------------------------------------------------------
--
-- Invoice 2987 went to QuickBooks at $2,340 covering three days, and the crew
-- sheet stapled to it says $1,660 and two days. Same invoice, two documents,
-- and the one the customer reads to check the bill disagrees with the bill.
--
-- billing_week_for skips a week that has been pushed -- rightly, or later work
-- would keep piling onto an invoice already sitting in somebody's inbox. But it
-- was the only record of where the earlier work went, so the moment 2987 landed
-- the Sep 04 hours stopped counting as part of it, everywhere. The push builds
-- the sheet AFTER marking the week synced, so the sheet was drawn on the far
-- side of that change and came out short.
--
-- The job_weeks rows survived it -- billed_on_job_week_id is written at push
-- time for exactly this reason -- but nothing that draws the work read them.
--
-- ---------------------------------------------------------------------------
-- HOW IT WORKS NOW
-- ---------------------------------------------------------------------------
--
-- billing_week_for asks the written-down answer first and calculates second:
--
--   1. carried out on another week's invoice -> that week, forever
--   2. an earlier week is open and unpushed   -> that week, for now
--   3. otherwise                              -> its own week
--
-- Rule 1 is a fact about an invoice that has gone; rule 2 is a plan for one
-- that has not. Rule 2 is unchanged, so nothing that has not been pushed
-- behaves any differently, and a week pushed on its own has neither and lands
-- on rule 3 exactly as before.
--
-- The sheet is now reproducible: redraw 2987 next year and it draws what was
-- billed, because where the work went is recorded rather than re-derived.
--
-- Safe to re-run.

create or replace function public.billing_week_for(p_job_id uuid, p_week date)
returns date
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    -- 1. Already carried out on another week's invoice. Settled, and it stays
    --    settled after that invoice is pushed, which is the whole point.
    (select parent.week_start
       from job_weeks me
       join job_weeks parent on parent.id = me.billed_on_job_week_id
      where me.job_id = p_job_id
        and me.week_start = p_week),
    -- 2. An earlier week is holding its invoice open and has not gone yet.
    (select min(jw.week_start)
       from job_weeks jw
      where jw.job_id = p_job_id
        and jw.invoice_open
        and jw.qb_invoice_id is null
        and jw.week_start <= p_week),
    -- 3. Its own.
    p_week);
$$;

comment on function public.billing_week_for(uuid, date) is
  'The week this work bills on: the week that carried it out if it has already gone on one, otherwise an earlier week holding its invoice open, otherwise its own.';

revoke all on function public.billing_week_for(uuid, date) from public;
grant execute on function public.billing_week_for(uuid, date) to authenticated;

notify pgrst, 'reload schema';
