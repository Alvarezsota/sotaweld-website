-- Two jobs for one customer, billed as one.
--
-- ---------------------------------------------------------------------------
-- WHAT WENT WRONG
-- ---------------------------------------------------------------------------
--
-- Saturday 08-29, Rocking Double S: "Loram Train car modifications" and
-- "RF Fuel line leak repair" were both worked, both billed to the same
-- customer, and came out as two reports and two invoices. Approvals makes one
-- report per job, and nothing said those two jobs go on one bill.
--
-- The only thing that could merge two jobs was the yard rule -- a ticket on a
-- yard job naming the job it was for. That is a per-ticket choice made by
-- whoever files it, it needs a parent job, and is_yard cannot be set anywhere
-- in the portal. None of that helps two ordinary jobs for one customer.
--
-- ---------------------------------------------------------------------------
-- HOW IT WORKS NOW
-- ---------------------------------------------------------------------------
--
-- A job can say "bill me with this customer's other jobs". Off by default, so
-- nothing merges that was not asked to merge -- two jobs for one customer often
-- want separate invoices, different PO, different bid, different location.
--
-- Ticked jobs sharing a QuickBooks customer bill together. One of them is the
-- anchor -- the oldest, by id -- and the others' work bills under it. That is
-- the same redirection the yard rule already performs through bill_job_id, so
-- the invoice, the week detail and the approvals screen all follow it without
-- being taught anything new.
--
-- The customer is the QuickBooks id, never the typed name. "Rocking Double S
-- LLC" and "Rocking double S LL" are the same customer and were two strings;
-- that is exactly how this got missed, and a typed name cannot be the key.
--
-- A ticket that names the job it was for still wins, as it always has.
--
-- Safe to re-run.

alter table public.jobs
  add column if not exists bill_with_customer boolean not null default false;

comment on column public.jobs.bill_with_customer is
  'When true, this job bills together with the customer''s other ticked jobs -- one report, one invoice for the week. Off by default. Needs a QuickBooks customer on the job; without one there is nothing to group by.';

-- The job a given job's work bills under. Itself, unless it is ticked and
-- another ticked job for the same customer is older.
create or replace function public.bill_anchor_job(p_job_id uuid)
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
      where me.id = p_job_id
        and me.bill_with_customer
        and me.qb_customer_id is not null
      -- Oldest job wins, not lowest id. Ticking a new job later must not take
      -- the anchor from a job that already has weeks approved against it.
      order by a.created_at nulls last, a.id
      limit 1),
    p_job_id);
$$;

comment on function public.bill_anchor_job(uuid) is
  'Which job this one bills under. Itself unless it is ticked to bill with the customer and an older ticked job shares that customer.';

revoke all on function public.bill_anchor_job(uuid) from public;
grant execute on function public.bill_anchor_job(uuid) to authenticated;

-- v_work_lines, with one line changed: where the work bills.
create or replace view public.v_work_lines as
 WITH base AS (
         SELECT de.id AS entry_id,
            de.entry_date,
            week_start_of(de.entry_date) AS week_start,
            de.job_id AS work_job_id,
            de.for_job_id,
                CASE
                    -- A ticket that names the job it was for still wins.
                    WHEN de.for_job_id IS NOT NULL AND fj.billing_type = 'hourly'::text THEN de.for_job_id
                    -- Otherwise the job it bills under, which is itself unless it
                    -- is ticked to bill with the customer's other jobs.
                    ELSE public.bill_anchor_job(de.job_id)
                END AS bill_job_id,
            COALESCE(de.for_job_id, de.job_id) AS cost_job_id,
            de.one_off_name,
            de.description,
            de.is_stainless,
            de.per_diem AS welder_per_diem,
            de.welder_id,
            de.hours AS welder_hours,
            de.pay_hours_override AS welder_pay_hours_override,
            de.pay_rate_override,
            de.bill_rate_override,
            de.stainless_rate_override,
            de.per_diem_override,
            de.bid_item_id,
            bi.description AS bid_item_name
           FROM daily_entries de
             LEFT JOIN jobs fj ON fj.id = de.for_job_id
             LEFT JOIN job_bid_items bi ON bi.id = de.bid_item_id
        )
 SELECT b.entry_id,
    b.entry_date,
    b.week_start,
    b.work_job_id,
    wj.name AS work_job_name,
    b.for_job_id,
    foj.name AS for_job_name,
    b.bill_job_id,
    bj.name AS bill_job_name,
    bj.bill_to,
    bj.operator,
    bj.billing_type,
    bj.track_hours,
    b.cost_job_id,
    cj.name AS cost_job_name,
    cj.billing_type AS cost_billing_type,
    b.one_off_name,
    b.description,
    b.is_stainless,
        CASE
            WHEN p.bills_as_helper_id IS NOT NULL THEN 'helper'::text
            ELSE 'welder'::text
        END AS person_kind,
    COALESCE(p.bills_as_helper_id, p.id) AS person_id,
    COALESCE(ah.name, p.full_name) AS person_name,
    b.welder_hours AS hours,
    COALESCE(b.pay_rate_override, ah.pay_rate, p.pay_rate) AS pay_rate,
        CASE
            WHEN COALESCE(bj.is_internal, false) THEN 0::numeric
            -- Billed as a helper: the job's helper rate reaches him, its welding
            -- rates do not, and a rate on his own line beats both.
            WHEN p.bills_as_helper_id IS NOT NULL THEN
                COALESCE(b.bill_rate_override, bj.helper_bill_rate, ah.bill_rate, p.bill_rate)
            WHEN b.is_stainless THEN COALESCE(b.stainless_rate_override, b.bill_rate_override, bj.stainless_bill_rate, p.bill_rate)
            ELSE COALESCE(b.bill_rate_override, bj.bill_rate, p.bill_rate)
        END AS bill_rate,
    b.welder_per_diem AS per_diem_flag,
        CASE
            WHEN COALESCE(bj.is_internal, false) THEN 0::numeric
            ELSE COALESCE(b.per_diem_override, bj.per_diem, 0::numeric)
        END AS per_diem_rate,
    b.bid_item_id,
    b.bid_item_name,
    COALESCE(b.welder_pay_hours_override, b.welder_hours) AS pay_hours
   FROM base b
     JOIN profiles p ON p.id = b.welder_id
     LEFT JOIN helpers ah ON ah.id = p.bills_as_helper_id
     LEFT JOIN jobs wj ON wj.id = b.work_job_id
     LEFT JOIN jobs foj ON foj.id = b.for_job_id
     LEFT JOIN jobs bj ON bj.id = b.bill_job_id
     LEFT JOIN jobs cj ON cj.id = b.cost_job_id
UNION ALL
 SELECT b.entry_id,
    b.entry_date,
    b.week_start,
    b.work_job_id,
    wj.name AS work_job_name,
    b.for_job_id,
    foj.name AS for_job_name,
    b.bill_job_id,
    bj.name AS bill_job_name,
    bj.bill_to,
    bj.operator,
    bj.billing_type,
    bj.track_hours,
    b.cost_job_id,
    cj.name AS cost_job_name,
    cj.billing_type AS cost_billing_type,
    b.one_off_name,
    b.description,
    b.is_stainless,
    'helper'::text AS person_kind,
    h.id AS person_id,
    h.name AS person_name,
    deh.hours,
    COALESCE(deh.pay_rate_override, h.pay_rate) AS pay_rate,
        CASE
            WHEN COALESCE(bj.is_internal, false) THEN 0::numeric
            ELSE COALESCE(deh.bill_rate_override, bj.helper_bill_rate, h.bill_rate)
        END AS bill_rate,
    deh.per_diem AS per_diem_flag,
        CASE
            WHEN COALESCE(bj.is_internal, false) THEN 0::numeric
            ELSE COALESCE(deh.per_diem_override, bj.per_diem, 0::numeric)
        END AS per_diem_rate,
    b.bid_item_id,
    b.bid_item_name,
    COALESCE(deh.pay_hours_override, deh.hours) AS pay_hours
   FROM base b
     JOIN daily_entry_helpers deh ON deh.daily_entry_id = b.entry_id
     JOIN helpers h ON h.id = deh.helper_id
     LEFT JOIN jobs wj ON wj.id = b.work_job_id
     LEFT JOIN jobs foj ON foj.id = b.for_job_id
     LEFT JOIN jobs bj ON bj.id = b.bill_job_id
     LEFT JOIN jobs cj ON cj.id = b.cost_job_id;
