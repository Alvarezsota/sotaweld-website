-- An invoice that stays open across weeks.
--
-- Some jobs are two days and some run into the following week. The week is
-- still approved on Monday -- the welder's time is proved, his statement goes
-- out, the job log locks -- but the invoice is not finished, because the job is
-- not finished. Before this, that second week started a second invoice and the
-- customer got two bills for one short job.
--
-- So a week can hold its invoice open. While it is open and has not been
-- pushed, later weeks on that job bill onto it. Close it when the job is done
-- and push one invoice covering the lot.
--
-- APPROVING AND FINISHING ARE NOT THE SAME ACT. That is the whole point.
-- Approving a week is about the man's hours; pushing is about the customer's
-- bill. They were one thing only because nothing had ever needed them apart.
--
-- Pay is untouched, as ever: a man is paid for the week he worked, and every
-- pay-side view still reads week_start.
--
-- Safe to re-run.

alter table public.job_weeks
  add column if not exists invoice_open boolean not null default false;

comment on column public.job_weeks.invoice_open is
  'Hold this invoice open: later weeks on this job bill onto it instead of starting their own, until it is closed and pushed. Approving those later weeks still proves and pays the time as normal.';

create or replace function public.billing_week_for(p_job_id uuid, p_week date)
returns date
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select min(jw.week_start)
       from job_weeks jw
      where jw.job_id = p_job_id
        and jw.invoice_open
        and jw.qb_invoice_id is null
        and jw.week_start <= p_week),
    p_week);
$$;

comment on function public.billing_week_for(uuid, date) is
  'The week this work bills on. Its own week unless an earlier week of the same job is holding its invoice open and has not been pushed.';

revoke all on function public.billing_week_for(uuid, date) from public;
grant execute on function public.billing_week_for(uuid, date) to authenticated;

-- bill_week_start now follows an open invoice as well as an explicit per-ticket
-- override. The override still wins -- typing a week on a line has to do
-- something.
do $lines$
declare
  v_def text;
  v_old text := 'COALESCE(b.bill_week_start, b.week_start) AS bill_week_start';
  v_new text := 'COALESCE(b.bill_week_start, billing_week_for(b.bill_job_id, b.week_start)) AS bill_week_start';
begin
  select pg_get_viewdef('public.v_work_lines'::regclass, true) into v_def;

  if position('billing_week_for' in v_def) > 0 then
    raise notice 'v_work_lines already follows open invoices; leaving it alone';
    return;
  end if;
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 2 then
    raise exception
      'STOP: expected the bill_week_start expression twice in v_work_lines. Nothing has been changed.';
  end if;

  execute 'create or replace view public.v_work_lines as ' || replace(v_def, v_old, v_new);
end
$lines$;

-- A week whose work bills onto another invoice must not spend a number of its
-- own. Numbers are the one thing here that cannot be un-spent.
create or replace function public.tg_job_weeks_number_on_approve()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.status <> 'approved' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'approved' then
    return new;
  end if;
  if new.invoice_no is not null and length(trim(new.invoice_no)) > 0 then
    return new;
  end if;

  -- Billing onto an earlier week's open invoice: that invoice has the number.
  if billing_week_for(new.job_id, new.week_start) <> new.week_start then
    return new;
  end if;

  new.invoice_no := (take_invoice_no())::text;
  return new;
end;
$function$;

notify pgrst, 'reload schema';
