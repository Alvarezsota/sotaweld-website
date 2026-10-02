-- A price is a price, whichever box it was typed into.
--
-- There are two places on a job that both look like the price. jobs.bid_amount
-- is the lump figure. The bid item lines are the other -- so many platforms at
-- so much each -- and their total is just as much "what this job was bid at".
--
-- job_spend only ever looked at bid_amount. So Gilbert priced a job by entering
-- it as a bid line, logged a week of work against it, and watched the number
-- sit still: "I would put the price in there as a bid item but then I would log
-- work to it and it stay the same. I don't know why it was doing that."
--
-- It was doing that because a price entered the other way read as no price at
-- all. He said three times it was confusing. It was not confusing, it was wrong.
--
-- Now: the lump figure wins when it is set, because a man who types one means
-- it. Failing that, the bid lines are the price. nullif keeps a job carrying a
-- couple of blank placeholder lines reading as unpriced rather than bid at
-- zero, which would show it 100% over on its first day.
--
-- Also drops the piece-pay term. That feature was reverted (see
-- 20261002b_paid_by_the_piece.sql); v_week_piece_pay holds no rows and no
-- dollars, so removing it changes no figure on any job.
--
-- The signature is unchanged, so this is a straight CREATE OR REPLACE.

create or replace function public.job_spend(p_job uuid)
 returns table(job_id uuid, job_name text, bid_amount numeric, labour_paid numeric,
               per_diem_paid numeric, spent numeric, remaining numeric, pct_spent numeric,
               hours numeric, people integer, first_day date, last_day date)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
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
  lines as (
    select round(coalesce(sum(bi.qty_bid * bi.unit_price), 0), 2) as total
    from job_bid_items bi where bi.job_id = p_job
  ),
  bid as (
    select coalesce(jb.bid_amount, nullif(lines.total, 0)) as amount
    from public.jobs jb, lines where jb.id = p_job
  ),
  pd_day as (
    select w.person_kind, w.person_id, w.entry_date, max(w.per_diem_rate) as rate
    from v_work_lines w where w.per_diem_flag is true
    group by 1, 2, 3
  ),
  pd_job as (
    select w.person_kind, w.person_id, w.entry_date, w.cost_job_id,
           row_number() over (partition by w.person_kind, w.person_id, w.entry_date
                              order by sum(w.pay_hours) desc, w.cost_job_id) as rn
    from v_work_lines w where w.per_diem_flag is true
    group by w.person_kind, w.person_id, w.entry_date, w.cost_job_id
  ),
  pd as (
    select round(coalesce(sum(d.rate), 0), 2) as paid
    from pd_job j
    join pd_day d on d.person_kind = j.person_kind and d.person_id = j.person_id
                 and d.entry_date = j.entry_date
    where j.rn = 1 and j.cost_job_id = p_job
  )
  select
    jb.id, jb.name, bid.amount,
    lab.paid,
    pd.paid,
    round(lab.paid + pd.paid, 2),
    case when bid.amount is null then null
         else round(bid.amount - (lab.paid + pd.paid), 2) end,
    case when coalesce(bid.amount, 0) = 0 then null
         else round((lab.paid + pd.paid) * 100 / bid.amount, 1) end,
    lab.hrs, lab.people::integer, lab.d1, lab.d2
  from public.jobs jb, lab, pd, bid
  where jb.id = p_job;
end;
$function$;
