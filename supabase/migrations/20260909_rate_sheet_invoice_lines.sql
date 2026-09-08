-- Billing a customer off their own rate sheet.
--
-- ---------------------------------------------------------------------------
-- WHOSE FORTY HOURS
-- ---------------------------------------------------------------------------
--
-- "Time and a half after 40 hours" is a weekly line, and three things about it
-- had to be decided rather than assumed.
--
-- PER MAN. Forty hours is one man's week, not the crew's. Six men at ten hours
-- a day are nowhere near overtime on the second day.
--
-- ACROSS THIS CUSTOMER'S WORK, NOT ONE JOB AND NOT ALL WORK. Counting per job
-- would let a man do thirty hours on one of their jobs and twenty on another
-- and cross forty on neither, which under-bills. Counting every hour he worked
-- all week would charge them a premium earned on somebody else's job, which
-- over-bills and is indefensible if they ever ask. So the line is drawn across
-- the hours on that customer's jobs, and no others.
--
-- IN THE ORDER THE HOURS HAPPENED. A man's week is walked date by date and the
-- hours past the fortieth are the overtime ones, which puts the premium on the
-- day it was actually earned. That matters when his week spans two of their
-- jobs on separate invoices: the overtime lands on the invoice for the day it
-- fell on rather than being split by some ratio.
--
-- NOTHING IS SPLIT 8-AND-2 DAILY. That is only right at exactly five ten-hour
-- days. On a four-day week it bills eight hours of premium that is not owed
-- under a term that says "after 40", and on a six-day week it leaves the same
-- eight hours' premium uncollected -- $379.20 either way on a Combo Welder.
--
-- ---------------------------------------------------------------------------
-- A MAN WITH NO CLASSIFICATION IS REPORTED, NEVER DROPPED
-- ---------------------------------------------------------------------------
--
-- These customers bill by classification, and a man who has not been given one
-- has no rate on this sheet. His hours are not quietly left off the invoice --
-- that is money gone with nothing to show it went. They come back in
-- `unclassified` so the preview can say whose hours they are, and the push
-- refuses until somebody has said what he bills as.
--
-- Pay is untouched. This is what the customer is charged.
--
-- Safe to re-run.

create or replace function public.rate_sheet_week_lines(p_job_week_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_job_id  uuid;
  v_week    date;
  v_cust    text;
  v_env     text;
  v_sheet   public.rate_sheets%rowtype;
  v_labor   jsonb;
  v_equip   jsonb;
  v_unclass jsonb;
  v_pd_days numeric := 0;
  v_pd_rate numeric := 0;
begin
  select jw.job_id, jw.week_start, j.qb_customer_id, coalesce(j.qb_environment, 'production')
    into v_job_id, v_week, v_cust, v_env
  from job_weeks jw
  join jobs j on j.id = jw.job_id
  where jw.id = p_job_week_id;

  -- No customer, or no sheet for them: this is an ordinary job week and the
  -- caller carries on billing it the way it always has.
  if v_cust is null then
    return null;
  end if;

  select * into v_sheet
  from rate_sheets
  where qb_customer_id = v_cust
    and qb_environment = v_env
    and active
    and effective_on <= v_week
  order by effective_on desc
  limit 1;

  if v_sheet.id is null then
    return null;
  end if;

  with cust_jobs as (
    -- Every job of this customer's. The forty-hour line is drawn across these
    -- and nothing else.
    select id from jobs
     where qb_customer_id = v_cust
       and coalesce(qb_environment, 'production') = v_env
  ),
  lines as (
    select wl.entry_id, wl.entry_date, wl.person_kind, wl.person_id,
           wl.person_name, wl.hours, wl.bill_job_id
      from v_work_lines_billing wl
     where wl.week_start = v_week
       and wl.bill_job_id in (select id from cust_jobs)
       and wl.hours > 0
  ),
  ranked as (
    -- What this man had already put in on their work before this line. The
    -- frame stops one row short on purpose: it is the hours BEFORE this one.
    select l.*,
           coalesce(sum(l.hours) over (
             partition by l.person_kind, l.person_id
             order by l.entry_date, l.entry_id
             rows between unbounded preceding and 1 preceding), 0) as before_h
      from lines l
  ),
  split as (
    select r.*,
           case
             when v_sheet.ot_after_hours is null then r.hours
             else greatest(0, least(r.hours, v_sheet.ot_after_hours - r.before_h))
           end as st_hours
      from ranked r
  ),
  mine as (
    -- Only the hours that bill on THIS invoice. The split above needed the
    -- man's whole week with this customer; the invoice only gets its own share.
    select s.*, (s.hours - s.st_hours) as ot_hours
      from split s
     where s.bill_job_id = v_job_id
  ),
  classed as (
    select m.*, i.id as item_id, i.description as class_name, i.rate
      from mine m
      left join crew_rate_class c
             on c.rate_sheet_id = v_sheet.id
            and c.person_kind = m.person_kind
            and c.person_id = m.person_id
      left join rate_sheet_items i
             on i.id = c.rate_sheet_item_id
  )
  select
    coalesce((
      select jsonb_agg(x order by x.class_name)
      from (
        select class_name,
               item_id,
               rate,
               round(sum(st_hours), 2) as st_hours,
               round(sum(ot_hours), 2) as ot_hours,
               round(sum(st_hours) * rate, 2) as st_amount,
               round(sum(ot_hours) * rate * v_sheet.ot_multiplier, 2) as ot_amount
          from classed
         where item_id is not null
         group by class_name, item_id, rate
      ) x
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'person_name', person_name,
               'person_kind', person_kind,
               'hours', round(sum_h, 2))
             order by person_name)
      from (
        select person_name, person_kind, sum(hours) as sum_h
          from classed
         where item_id is null
         group by person_name, person_kind
      ) u
    ), '[]'::jsonb)
  into v_labor, v_unclass;

  -- ---- equipment -----------------------------------------------------------
  -- Reached through the work lines so it inherits their idea of which week and
  -- which job a ticket bills on, yard redirection and held-open invoices and
  -- all. An entry with equipment and no hours on it would not be seen here.
  with entries_here as (
    select distinct wl.entry_id
      from v_work_lines_billing wl
     where wl.week_start = v_week
       and wl.bill_job_id = v_job_id
  )
  select coalesce(jsonb_agg(e order by e.category, e.description), '[]'::jsonb)
    into v_equip
  from (
    select i.category,
           i.description,
           i.unit,
           i.rate,
           round(sum(case when i.unit = 'each' then de.quantity
                          else de.amount * de.quantity end), 2) as quantity,
           round(sum(case when i.unit = 'each' then de.quantity
                          else de.amount * de.quantity end) * i.rate, 2) as amount
      from daily_entry_equipment de
      join entries_here eh on eh.entry_id = de.daily_entry_id
      join rate_sheet_items i on i.id = de.rate_sheet_item_id
     where i.rate_sheet_id = v_sheet.id
     group by i.category, i.description, i.unit, i.rate
  ) e;

  -- ---- per diem ------------------------------------------------------------
  -- The sheet's rate, not the job's. Electric Hydrogen is $125 where everyone
  -- else is $100, and the number on the job row is the one everyone else uses.
  select count(*) into v_pd_days
  from v_per_diem_days_billing d
  where d.week_start = v_week and d.bill_job_id = v_job_id;

  v_pd_rate := coalesce(v_sheet.per_diem_rate, 0);

  return jsonb_build_object(
    'rate_sheet_id',   v_sheet.id,
    'rate_sheet_name', v_sheet.name,
    'ot_after_hours',  v_sheet.ot_after_hours,
    'ot_multiplier',   v_sheet.ot_multiplier,
    'labor',           v_labor,
    'unclassified',    v_unclass,
    'equipment',       v_equip,
    'per_diem_days',   v_pd_days,
    'per_diem_rate',   v_pd_rate,
    'per_diem_amount', round(v_pd_days * v_pd_rate, 2),
    'total', round(
        coalesce((select sum((l->>'st_amount')::numeric + (l->>'ot_amount')::numeric)
                    from jsonb_array_elements(v_labor) l), 0)
      + coalesce((select sum((q->>'amount')::numeric)
                    from jsonb_array_elements(v_equip) q), 0)
      + v_pd_days * v_pd_rate, 2)
  );
end;
$function$;

comment on function public.rate_sheet_week_lines(uuid) is
  'Invoice lines for a job week billed off the customer''s own rate sheet: labour by classification split straight/overtime at the sheet''s weekly hours line per man, equipment, and per diem at the sheet rate. Null when the customer has no sheet.';

revoke all on function public.rate_sheet_week_lines(uuid) from public;
grant execute on function public.rate_sheet_week_lines(uuid) to authenticated;

notify pgrst, 'reload schema';
