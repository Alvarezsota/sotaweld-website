-- A job that is overhead, and bills nothing.
--
-- Shop is the shop's own time: an OSHA class, clearing the plate side of the
-- yard, throwing out I-beam, a bench built for a customer who is being invoiced
-- a lump sum for it separately. None of that goes on anybody's invoice, and yet
-- it was reading as $5,287.50 of revenue across three weeks against $3,823 of
-- real cost, because a man with no job rate over him falls back to his own bill
-- rate and every man has one.
--
-- ---------------------------------------------------------------------------
-- WHY A FLAG AND NOT A ZERO JOB RATE
-- ---------------------------------------------------------------------------
--
-- Setting jobs.bill_rate = 0 would zero the welders and leave every helper
-- untouched, because a helper deliberately ignores the job rate -- a job rate is
-- a welding rate, which is the rule that stopped Jayson Alvarez billing at $125
-- on a stainless ticket. Most of what lands on Shop is helpers, so that fix
-- would have looked right and corrected almost nothing.
--
-- So the flag sits above both legs and zeroes them together. Per diem goes with
-- it: there is no per diem on a day spent in the yard.
--
-- ---------------------------------------------------------------------------
-- WHAT IT DOES NOT TOUCH
-- ---------------------------------------------------------------------------
--
-- Pay. Every man is paid exactly what he was paid before -- this is about what
-- leaves the building, not what he earns. An internal job therefore reads as
-- pure cost, which is what overhead is.
--
-- approvals.js resolves these same rates in JavaScript to draw the job log. It
-- has been taught the same rule. If you change the chain here, change it there.

alter table public.jobs
  add column if not exists is_internal boolean not null default false;

comment on column public.jobs.is_internal is
  'Overhead. Work on this job is paid but never billed: bill rate and per diem resolve to zero for welders and helpers alike. The job also cannot be pushed to QuickBooks, having nothing to invoice.';

-- create or replace keeps every dependent view and function attached; the column
-- list and its order are unchanged, which is what makes that legal.
create or replace view public.v_work_lines as
 WITH base AS (
         SELECT de.id AS entry_id,
            de.entry_date,
            week_start_of(de.entry_date) AS week_start,
            de.job_id AS work_job_id,
            de.for_job_id,
                CASE
                    WHEN de.for_job_id IS NOT NULL AND fj.billing_type = 'hourly'::text THEN de.for_job_id
                    ELSE de.job_id
                END AS bill_job_id,
            COALESCE(de.for_job_id, de.job_id) AS cost_job_id,
            de.one_off_name,
            de.description,
            de.is_stainless,
            de.per_diem AS welder_per_diem,
            de.welder_id,
            de.hours AS welder_hours,
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
    'welder'::text AS person_kind,
    p.id AS person_id,
    p.full_name AS person_name,
    b.welder_hours AS hours,
    COALESCE(b.pay_rate_override, p.pay_rate) AS pay_rate,
        CASE
            WHEN COALESCE(bj.is_internal, false) THEN 0::numeric
            WHEN b.is_stainless THEN COALESCE(b.stainless_rate_override, b.bill_rate_override, bj.stainless_bill_rate, p.bill_rate)
            ELSE COALESCE(b.bill_rate_override, bj.bill_rate, p.bill_rate)
        END AS bill_rate,
    b.welder_per_diem AS per_diem_flag,
        CASE
            WHEN COALESCE(bj.is_internal, false) THEN 0::numeric
            ELSE COALESCE(b.per_diem_override, bj.per_diem, 0::numeric)
        END AS per_diem_rate,
    b.bid_item_id,
    b.bid_item_name
   FROM base b
     JOIN profiles p ON p.id = b.welder_id
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
            ELSE COALESCE(deh.bill_rate_override, h.bill_rate)
        END AS bill_rate,
    deh.per_diem AS per_diem_flag,
        CASE
            WHEN COALESCE(bj.is_internal, false) THEN 0::numeric
            ELSE COALESCE(deh.per_diem_override, bj.per_diem, 0::numeric)
        END AS per_diem_rate,
    b.bid_item_id,
    b.bid_item_name
   FROM base b
     JOIN daily_entry_helpers deh ON deh.daily_entry_id = b.entry_id
     JOIN helpers h ON h.id = deh.helper_id
     LEFT JOIN jobs wj ON wj.id = b.work_job_id
     LEFT JOIN jobs foj ON foj.id = b.for_job_id
     LEFT JOIN jobs bj ON bj.id = b.bill_job_id
     LEFT JOIN jobs cj ON cj.id = b.cost_job_id;

-- Shop is the shop's own time.
update public.jobs set is_internal = true where name = 'Shop';
