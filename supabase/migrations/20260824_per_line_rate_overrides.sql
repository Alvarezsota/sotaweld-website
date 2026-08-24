-- Per-line rate overrides.
--
-- A rate on a finished ticket sometimes has to change for that ticket alone: a
-- day billed at a number agreed on the phone, a man paid something different for
-- one job. Changing his standing rate to get it would rewrite every other week
-- he appears on, so the one-off number lives on the line itself.
--
-- Blank is the normal state and means "resolve it the way it always was":
-- the job's rate first, then the person's own. A number here, and only a number
-- here, departs from that.
--
-- ---------------------------------------------------------------------------
-- WHY ONLY ONE VIEW CHANGES
-- ---------------------------------------------------------------------------
--
-- Every rate in this system is resolved once, in v_work_lines. The per diem
-- views, the invoice, both payroll summaries, week_job_detail, week_person_detail
-- and therefore get_week_summary and rebuild_week_summaries all read their rates
-- from it and none of them compute their own. Teaching that one view the
-- overrides carries them everywhere at the same instant, which is the point:
-- a rate that reached the invoice but not payroll would be worse than no
-- override at all.
--
-- approvals.js resolves the same rates a second time, in JavaScript, to draw the
-- job log. That copy has to match this one line for line or the job log and the
-- invoice quote different money for the same day. If you change the chain here,
-- change it there.
--
-- ---------------------------------------------------------------------------
-- A JOB RATE IS A WELDING RATE
-- ---------------------------------------------------------------------------
--
-- jobs.bill_rate and jobs.stainless_bill_rate are what the welding goes out at.
-- Neither touches a helper: a helper bills at his own rate whatever the welder
-- beside him is going out at, so the only thing that can move a helper line is an
-- override entered on that line.
--
-- This view always had that right. approvals.js did not -- it fell helpers back
-- to the job bill rate, so ten of Jayson Alvarez's hours on Targa Yeti Temp Flare
-- read $125/hr on the job log against the $25/hr the invoice was charging. The
-- job log was the wrong one and has been corrected to match; no invoice moves.
--
-- ---------------------------------------------------------------------------
-- FROZEN WEEKS
-- ---------------------------------------------------------------------------
--
-- Approving a week writes a snapshot into week_summaries, and the Summary page
-- reads the snapshot rather than the views. Overriding a rate on an already
-- approved week therefore changes the invoice and changes nothing on screen
-- until rebuild_week_summaries(week_start) is run for it. That function feeds off
-- these same views, so it needs no change of its own -- just running.

-- ---------------------------------------------------------------------------
-- COLUMNS
-- ---------------------------------------------------------------------------

alter table public.daily_entries
  add column if not exists pay_rate_override       numeric,
  add column if not exists bill_rate_override      numeric,
  add column if not exists stainless_rate_override numeric,
  add column if not exists per_diem_override       numeric;

alter table public.daily_entry_helpers
  add column if not exists pay_rate_override  numeric,
  add column if not exists bill_rate_override numeric,
  add column if not exists per_diem_override  numeric;

comment on column public.daily_entries.pay_rate_override is
  'What this welder is paid per hour on this ticket only. Null = his profile rate.';
comment on column public.daily_entries.bill_rate_override is
  'What this ticket bills per hour. Null = the job bill rate, then his profile rate.';
comment on column public.daily_entries.stainless_rate_override is
  'Bill rate for this ticket when it is stainless. Null = bill_rate_override, then the job stainless rate, then his profile rate.';
comment on column public.daily_entries.per_diem_override is
  'Per diem for this ticket only. Null = the job per diem. Applies to what is paid and what is billed.';
comment on column public.daily_entry_helpers.pay_rate_override is
  'What this helper is paid per hour on this line only. Null = his helper rate.';
comment on column public.daily_entry_helpers.bill_rate_override is
  'What this helper line bills per hour. Null = his helper rate. The job bill rate is a welding rate and never applies to a helper.';
comment on column public.daily_entry_helpers.per_diem_override is
  'Per diem for this helper line only. Null = the job per diem.';

-- A negative rate is always a typo, and one that quietly subtracts from an
-- invoice. Zero is allowed: a line billed at nothing is a real thing to want.
do $$
declare
  t text;
  c text;
begin
  foreach t in array array['daily_entries', 'daily_entry_helpers'] loop
    foreach c in array array['pay_rate_override', 'bill_rate_override',
                             'stainless_rate_override', 'per_diem_override'] loop
      if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = t and column_name = c
      ) and not exists (
        select 1 from pg_constraint
        where conrelid = ('public.' || t)::regclass
          and conname = t || '_' || c || '_nonneg'
      ) then
        execute format(
          'alter table public.%I add constraint %I check (%I is null or %I >= 0)',
          t, t || '_' || c || '_nonneg', c, c);
      end if;
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- THE ONE PLACE RATES RESOLVE
-- ---------------------------------------------------------------------------
--
-- Unchanged from the previous definition apart from the rate expressions:
--   pay_rate       line override, then the person's own rate
--   bill_rate      welders: line override, then the job rate, then his own rate.
--                  On a stainless ticket the stainless override is tried first and
--                  the job's stainless rate stands in for the job rate; a plain
--                  bill rate override still counts, so setting one on a stainless
--                  line does something rather than nothing.
--                  helpers: line override, then his own rate. No job rate --
--                  see above.
--   per_diem_rate  line override, then the job per diem, then nothing
--
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
            WHEN b.is_stainless THEN COALESCE(b.stainless_rate_override, b.bill_rate_override, bj.stainless_bill_rate, p.bill_rate)
            ELSE COALESCE(b.bill_rate_override, bj.bill_rate, p.bill_rate)
        END AS bill_rate,
    b.welder_per_diem AS per_diem_flag,
    COALESCE(b.per_diem_override, bj.per_diem, 0::numeric) AS per_diem_rate,
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
    COALESCE(deh.bill_rate_override, h.bill_rate) AS bill_rate,
    deh.per_diem AS per_diem_flag,
    COALESCE(deh.per_diem_override, bj.per_diem, 0::numeric) AS per_diem_rate,
    b.bid_item_id,
    b.bid_item_name
   FROM base b
     JOIN daily_entry_helpers deh ON deh.daily_entry_id = b.entry_id
     JOIN helpers h ON h.id = deh.helper_id
     LEFT JOIN jobs wj ON wj.id = b.work_job_id
     LEFT JOIN jobs foj ON foj.id = b.for_job_id
     LEFT JOIN jobs bj ON bj.id = b.bill_job_id
     LEFT JOIN jobs cj ON cj.id = b.cost_job_id;
