-- Per diem stayed behind on the week it was worked.
--
-- ---------------------------------------------------------------------------
-- WHAT WENT WRONG
-- ---------------------------------------------------------------------------
--
-- Found on invoice 2987, James Lake PSV, checking the hold-open fix. The hours
-- moved onto the open invoice and the per diem did not: 17 welder hours and 9
-- helper hours from three days, but only three per-diem days billed instead of
-- five. Two hundred dollars of per diem for 09-04 sat on a week that will never
-- be invoiced, while the crew sheet attached to the bill listed all five days.
-- The customer would have been handed a sheet showing $500 of per diem against
-- a line charging $300.
--
-- Every other billing view reads v_work_lines_billing, whose week_start is the
-- week the work BILLS on. v_per_diem_days_by_job reads v_work_lines, whose
-- week_start is the week it was WORKED. That distinction did not exist until an
-- invoice could stay open across weeks, and this view was not moved with the
-- others when it started to.
--
-- ---------------------------------------------------------------------------
-- HOW IT WORKS NOW
-- ---------------------------------------------------------------------------
--
-- The billing side gets its own per-diem-days view, off the billing lines. The
-- worked-week one is left exactly as it is, because it is not only a billing
-- view: the weekly welder and helper summaries read it, and a man's per diem
-- belongs to the week he was out there, whatever week the customer is billed
-- for it. Pay never follows an invoice.
--
-- Only v_week_job_invoice moves over. For any invoice not held open the two
-- views return the same rows, because worked week and billing week are the
-- same week.
--
-- Safe to re-run.

create or replace view public.v_per_diem_days_billing as
  select week_start,
         bill_job_id,
         person_kind,
         person_id,
         person_name,
         entry_date,
         max(per_diem_rate) as per_diem_rate
    from v_work_lines_billing
   where per_diem_flag is true and bill_job_id is not null
   group by week_start, bill_job_id, person_kind, person_id, person_name, entry_date;

comment on view public.v_per_diem_days_billing is
  'One row per person per day per billing job, on the week the work bills -- the billing-side twin of v_per_diem_days_by_job, which stays on the week the work was done because pay reads it.';

grant select on public.v_per_diem_days_billing to authenticated;

do $inv$
declare
  v_def text;
  v_hits int;
begin
  select pg_get_viewdef('public.v_week_job_invoice'::regclass, true) into v_def;

  if position('v_per_diem_days_billing' in v_def) > 0 then
    raise notice 'v_week_job_invoice already bills per diem on the billing week; leaving it alone';
    return;
  end if;

  -- It is only ever named inside rev_pd. If that stops being true, a blind
  -- rename would move something else with it, so count first.
  v_hits := (length(v_def) - length(replace(v_def, 'v_per_diem_days_by_job', '')))
            / length('v_per_diem_days_by_job');
  if v_hits <> 9 then
    raise exception
      'STOP: expected v_per_diem_days_by_job 9 times in v_week_job_invoice, found %. Nothing has been changed.', v_hits;
  end if;

  execute 'create or replace view public.v_week_job_invoice as '
          || replace(v_def, 'v_per_diem_days_by_job', 'v_per_diem_days_billing');
end
$inv$;

notify pgrst, 'reload schema';
