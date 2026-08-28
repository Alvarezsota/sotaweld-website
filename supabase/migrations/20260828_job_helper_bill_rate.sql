-- A job can have a helper rate of its own.
--
-- MasTec pay $35 an hour for a helper. Nothing could say that. jobs.bill_rate
-- and jobs.stainless_bill_rate are welding rates and deliberately never reach a
-- helper -- that rule is from 20260824_per_line_rate_overrides.sql and it is
-- right -- so the only way to bill a helper at anything but his own standing
-- rate was to type the number on the line, every line, every day.
--
-- Which held exactly as long as somebody remembered. Jayson Alvarez on MasTec,
-- week of 08-17: $35 typed on the 19th, $35 typed on the 20th, nothing typed on
-- the 18th, so the 18th went out at his standing $25 on an invoice that is
-- already numbered. The rate was not wrong in anybody's head. It was wrong on
-- the invoice because it lived in three places and one of them was missed.
--
-- ---------------------------------------------------------------------------
-- THE RULE, NOW SYMMETRIC
-- ---------------------------------------------------------------------------
--
--   jobs.bill_rate, jobs.stainless_bill_rate   welding rates. Never a helper.
--   jobs.helper_bill_rate                      the helper rate. Never a welder.
--
-- Each side of the crew has a job rate and neither can reach across. A rate
-- typed on a line still beats both, the way it always has -- entering a number
-- has to do something.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS MOVES
-- ---------------------------------------------------------------------------
--
-- Null everywhere except MasTec, so every other job bills exactly as it did.
-- On MasTec it corrects the one line that was missed:
--
--   08-18  Jayson Alvarez  8 hrs   $25 -> $35   +$80
--
-- Invoice 2982 goes from $5,460.00 to $5,540.00. It is approved and numbered
-- and has NOT gone to QuickBooks, so this is a correction to a bill that has
-- not been sent rather than a change to one that has.
--
-- The $35 typed on the 19th and the 20th is cleared with the same breath. It
-- agrees with the job rate today, so nothing moves; left in place it would
-- silently outrank the job the day the rate changes, which is the fault this
-- migration exists to end.

alter table public.jobs
  add column if not exists helper_bill_rate numeric
    check (helper_bill_rate is null or helper_bill_rate >= 0);

comment on column public.jobs.helper_bill_rate is
  'What a helper bills at per hour on this job. Null means each helper bills at his own standing rate, which is the ordinary case. A job rate is otherwise a welding rate and never reaches a helper -- this is the one that does, and it never reaches a welder.';

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

update public.jobs set helper_bill_rate = 35 where name = 'MasTec Industrial';

-- Redundant the moment the line above lands, and a trap if it is left.
update public.daily_entries de
   set bill_rate_override = null
  from public.jobs j
 where j.id = de.job_id
   and j.name = 'MasTec Industrial'
   and de.bill_rate_override = j.helper_bill_rate
   and de.welder_id in (select id from public.profiles where bills_as_helper_id is not null);
