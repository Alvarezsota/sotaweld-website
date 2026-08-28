-- A man with a login who is a helper on the invoice.
--
-- Jayson Alvarez is a helper. He is paid $18 and he bills at $25, and the
-- helpers table has him at exactly that. He also has a login, because he files
-- his own tickets from his phone -- and the man who files a ticket is its
-- welder_id, so v_work_lines has been calling him a welder since the day he got
-- the login. 136.5 hours across fifteen days, against 28 as a helper.
--
-- Nobody was paid wrong: his profile carries the same $18/$25 the helpers row
-- does. What was wrong is the word. qb_invoice_payload splits an invoice into a
-- "Welder labor" line and a "Helper labor" line off person_kind, so his hours
-- have been going to QuickBooks as welder labour and dragging that line's
-- average rate down toward $25 -- a customer reading the invoice sees welding
-- billed at a helper's price and no explanation for it.
--
-- ---------------------------------------------------------------------------
-- WHY A LINK AND NOT A FLAG
-- ---------------------------------------------------------------------------
--
-- A boolean would have said "this login is some helper". It has to say which
-- one, because he is already in the helpers table and the two records have to
-- become one man or he collects two pay statements a week -- and after this,
-- both of them named "(helper)", which is the same filename twice and the second
-- landing on top of the first in OneDrive.
--
-- So the column points at his helpers row, and v_work_lines reports that row's
-- id and name for both legs. One man, one summary, one statement, and per diem
-- deduped across a day he spent partly on his own ticket and partly on somebody
-- else's -- which it could not do before, the two legs having been two people.
--
-- ---------------------------------------------------------------------------
-- A JOB RATE IS A WELDING RATE, AND STILL IS
-- ---------------------------------------------------------------------------
--
-- The rule from 20260824_per_line_rate_overrides.sql: jobs.bill_rate and
-- jobs.stainless_bill_rate are what the welding goes out at and neither one
-- reaches a helper. A login that bills as a helper has to obey it too, or the
-- first stainless ticket he files bills him at the job's stainless rate -- $125
-- on Shop, $145 on MasTec -- which is the exact fault that rule was written for.
--
-- What still moves him is a rate typed on his own line. That is deliberate and
-- it matches the welder chain: entering a number should do something rather than
-- be quietly ignored in favour of a job rate.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS MOVES TODAY: NOTHING
-- ---------------------------------------------------------------------------
--
-- Every billed hour he has was checked before this was written:
--
--   Shop, 11 lines        internal, bills 0        -> 0, unchanged
--   SOTA Yard, 08-14      job bill_rate is null    -> his own $25, unchanged
--   MasTec, 08-19, 08-20  bill_rate_override 35    -> $35, unchanged
--
-- No invoice total moves by a cent. What moves is which line his hours sit on
-- and what the sheet beside it calls him.

-- ---------------------------------------------------------------------------
-- THERE IS ALREADY A profiles.helper_id, AND IT IS NOT THIS
-- ---------------------------------------------------------------------------
--
-- It holds Jayson's helpers row and nothing else in the system reads it -- no
-- migration creates it, no view joins it, no page selects it. It was set by hand
-- and left, and its meaning was never written down anywhere.
--
-- Billing off a column whose contract nobody stated is how a welder becomes a
-- helper by accident one day. This one says what it does in its name, so setting
-- it is a decision somebody made on purpose. helper_id is left exactly where it
-- is: unused, and not mine to delete.

alter table public.profiles
  add column if not exists bills_as_helper_id uuid
    references public.helpers(id) on delete set null;

comment on column public.profiles.bills_as_helper_id is
  'This login is a helper on the invoice, and this is his helpers row. Set, and every ticket he files is reported as helper time under that row: helper rates, helper line on the invoice, one pay statement covering both legs. Null -- the ordinary case -- means he is a welder.';

create index if not exists profiles_bills_as_helper_id_idx
  on public.profiles (bills_as_helper_id) where bills_as_helper_id is not null;

-- Only the welder leg changes, and only where the link is set. The helper leg is
-- untouched, and so is every welder who has no link -- coalesce hands back
-- exactly what it handed back before.
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
            -- Billed as a helper: the job's welding rates never reach him, but a
            -- rate typed on his own line still does.
            WHEN p.bills_as_helper_id IS NOT NULL THEN
                CASE
                    WHEN b.is_stainless THEN COALESCE(b.stainless_rate_override, b.bill_rate_override, ah.bill_rate, p.bill_rate)
                    ELSE COALESCE(b.bill_rate_override, ah.bill_rate, p.bill_rate)
                END
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
            ELSE COALESCE(deh.bill_rate_override, h.bill_rate)
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

-- Jayson, and only Jayson. Asked for by name.
update public.profiles p
   set bills_as_helper_id = h.id
  from public.helpers h
 where p.full_name = 'Jayson Alvarez'
   and h.name = 'Jayson Alvarez'
   and p.bills_as_helper_id is null;
