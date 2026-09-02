-- Billing jobs together must not reach backwards.
--
-- 20260829_bill_jobs_together.sql applied bill_with_customer in v_work_lines
-- with no cut-off, so ticking it regrouped every week that job had ever had --
-- including weeks already sent to QuickBooks.
--
-- That was found before anything was ticked, and only because the numbers were
-- looked at first. Rocking Double S has 13 jobs and 20 weeks, and all 20 are
-- already invoiced. Ticking two of those jobs would have moved billed work off
-- the jobs it was billed under: twelve jobs showing no work, one showing
-- everything, and the portal no longer matching invoices the customer is
-- already holding.
--
-- A merge is a decision about what to do next, not a rewriting of what was
-- already sent. So it takes effect from a date, set the day it is switched on
-- and cleared when it is switched off, by a trigger rather than by anybody
-- remembering.
--
-- Safe to re-run.

alter table public.jobs
  add column if not exists bill_with_customer_from date;

comment on column public.jobs.bill_with_customer_from is
  'Merging applies to weeks starting on or after this date. Set when bill_with_customer is switched on, so already-invoiced weeks keep the grouping they were billed under.';

update public.jobs
   set bill_with_customer_from = current_date
 where bill_with_customer and bill_with_customer_from is null;

create or replace function public.tg_jobs_bill_with_customer_from()
returns trigger
language plpgsql
as $$
begin
  if new.bill_with_customer and not coalesce(old.bill_with_customer, false) then
    new.bill_with_customer_from := coalesce(new.bill_with_customer_from, current_date);
  elsif not new.bill_with_customer then
    new.bill_with_customer_from := null;
  end if;
  return new;
end;
$$;

drop trigger if exists jobs_bill_with_customer_from on public.jobs;
create trigger jobs_bill_with_customer_from
  before insert or update of bill_with_customer on public.jobs
  for each row execute function public.tg_jobs_bill_with_customer_from();

-- The anchor now depends on the week as well as the job.
create or replace function public.bill_anchor_job(p_job_id uuid, p_week date)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select a.id
       from jobs me
       join jobs a
         on a.bill_with_customer
        and a.qb_customer_id is not null
        and a.qb_customer_id = me.qb_customer_id
        and a.bill_with_customer_from is not null
        and p_week >= a.bill_with_customer_from
      where me.id = p_job_id
        and me.bill_with_customer
        and me.qb_customer_id is not null
        and me.bill_with_customer_from is not null
        and p_week >= me.bill_with_customer_from
      order by a.created_at nulls last, a.id
      limit 1),
    p_job_id);
$$;

revoke all on function public.bill_anchor_job(uuid, date) from public;
grant execute on function public.bill_anchor_job(uuid, date) to authenticated;

-- Patched from the definition actually running. pg_get_viewdef renders the call
-- without a schema prefix, which the first attempt at this got wrong and was
-- refused for -- correctly, since a near-miss here silently stops merging.
do $rebuild$
declare
  v_def text;
  v_old text := 'ELSE bill_anchor_job(de.job_id)';
  v_new text := 'ELSE bill_anchor_job(de.job_id, week_start_of(de.entry_date))';
begin
  select pg_get_viewdef('public.v_work_lines'::regclass, true) into v_def;

  if position('bill_anchor_job(de.job_id, week_start_of' in v_def) > 0 then
    raise notice 'v_work_lines already passes the week; leaving it alone';
    return;
  end if;
  if position(v_old in v_def) = 0 then
    raise exception
      'STOP: v_work_lines does not call bill_anchor_job the way this expected. Nothing has been changed.';
  end if;

  execute 'create or replace view public.v_work_lines as ' || replace(v_def, v_old, v_new);
end
$rebuild$;

-- The one-argument version would still be reachable and would still reach
-- backwards. There must be one way to answer this.
drop function if exists public.bill_anchor_job(uuid);

notify pgrst, 'reload schema';
