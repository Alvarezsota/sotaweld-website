-- What is left of the bid.
--
-- A lump sum job is a pot of money. The question on one is not how much has
-- been built -- the portal already answers that, line item by line item, for
-- billing -- it is how much of the pot has gone out the door in wages while
-- the work gets done, and how much is still there.
--
-- Those are different numbers and only one of them tells you whether a job is
-- going to make money. A job can be eighty percent built and ninety percent
-- spent, and the completion figures will look fine right up to the week it
-- stops looking fine.
--
-- WHAT "SPENT" MEANS HERE, EXACTLY
-- ---------------------------------------------------------------------------
-- Money that leaves the company because of this job:
--
--   Labour    every hour logged against the job at the rate that man is paid,
--             welders and helpers alike. Not the bill rate -- the bill rate is
--             what the customer would have been charged by the hour, and on a
--             lump sum job the customer is not being charged by the hour.
--   Per diem  one per person per day, which is what is actually paid.
--
-- Read off v_work_lines, which is the same view the weekly pay statements are
-- built from. That is deliberate: a second definition of "what we paid" that
-- drifts from the first is worse than no figure at all.
--
-- WHAT IS NOT IN IT
-- ---------------------------------------------------------------------------
-- Materials. The portal records what material is CHARGED to a customer, not
-- what it cost to buy -- job_week_parts holds a sell rate. Adding it here would
-- quietly mix a price into a column of costs and overstate the burn. Steel and
-- consumables for a lump sum job have to come off the QuickBooks side.
--
-- Shop overhead, fuel, equipment. Not tracked per job anywhere.
--
-- So this is the labour burn, and it is named that on the screen rather than
-- called "cost", because a man reading "cost" would reasonably assume his
-- steel was in it.

alter table public.jobs
  add column if not exists bid_amount numeric;

comment on column public.jobs.bid_amount is
  'The lump sum this job was bid at -- the whole pot, one figure. Distinct from '
  'job_bid_items, which break a bid into line items for progress billing. A job '
  'can have both: the total here, the breakdown there.';

create or replace function public.job_spend(p_job uuid)
returns table (
  job_id uuid,
  job_name text,
  bid_amount numeric,
  labour_paid numeric,
  per_diem_paid numeric,
  spent numeric,
  remaining numeric,
  pct_spent numeric,
  hours numeric,
  people integer,
  first_day date,
  last_day date
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  -- What a job costs is not a welder's business, and v_work_lines will happily
  -- hand him his own rows. Definer, so the guard is the whole access rule.
  if not public.is_admin(auth.uid()) then
    raise exception 'Admins only.' using errcode = 'insufficient_privilege';
  end if;

  return query
  with lab as (
    select
      round(coalesce(sum(w.pay_hours * w.pay_rate), 0), 2) as paid,
      round(coalesce(sum(w.pay_hours), 0), 2)              as hrs,
      count(distinct w.person_id)                          as people,
      min(w.entry_date)                                    as d1,
      max(w.entry_date)                                    as d2
    from v_work_lines w
    where w.cost_job_id = p_job
  ),
  -- One per diem per person per day, at the day's rate -- the same rule the
  -- pay statements use, because that is what the man is actually handed.
  pd_day as (
    select w.person_kind, w.person_id, w.entry_date, max(w.per_diem_rate) as rate
    from v_work_lines w
    where w.per_diem_flag is true
    group by 1, 2, 3
  ),
  -- A man on two jobs in a day is paid one per diem, and it has to land on one
  -- of them. It lands on the job he gave most of his day to; the job id breaks
  -- a dead heat so the answer does not wander between runs.
  pd_job as (
    select w.person_kind, w.person_id, w.entry_date, w.cost_job_id,
           row_number() over (
             partition by w.person_kind, w.person_id, w.entry_date
             order by sum(w.pay_hours) desc, w.cost_job_id
           ) as rn
    from v_work_lines w
    where w.per_diem_flag is true
    group by w.person_kind, w.person_id, w.entry_date, w.cost_job_id
  ),
  pd as (
    select round(coalesce(sum(d.rate), 0), 2) as paid
    from pd_job j
    join pd_day d
      on d.person_kind = j.person_kind
     and d.person_id   = j.person_id
     and d.entry_date  = j.entry_date
    where j.rn = 1 and j.cost_job_id = p_job
  )
  select
    jb.id,
    jb.name,
    jb.bid_amount,
    lab.paid,
    pd.paid,
    round(lab.paid + pd.paid, 2),
    case when jb.bid_amount is null then null
         else round(jb.bid_amount - (lab.paid + pd.paid), 2) end,
    -- No bid entered, or a bid of zero, has no percentage. Dividing anyway is
    -- how a job with nothing on it reports as infinitely over.
    case when coalesce(jb.bid_amount, 0) = 0 then null
         else round((lab.paid + pd.paid) * 100 / jb.bid_amount, 1) end,
    lab.hrs,
    lab.people::integer,
    lab.d1,
    lab.d2
  from public.jobs jb, lab, pd
  where jb.id = p_job;
end;
$$;

comment on function public.job_spend(uuid) is
  'What has gone out in wages against a job, set against what it was bid at. '
  'Labour and per diem only -- materials are not costed anywhere in this '
  'system, so they are not in it. Built on v_work_lines so it agrees with the '
  'pay statements by construction.';

grant execute on function public.job_spend(uuid) to authenticated;
