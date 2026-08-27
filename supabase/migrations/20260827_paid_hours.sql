-- Hours billed and hours paid are not the same number.
--
-- Jayson Alvarez, 18 August. He sat an OSHA 10 class the customer is invoiced
-- eight hours for, and he got through it quicker than that. He helped on the
-- Yeti temp flare line, ten hours, invoiced ten. He is paid eleven and a half
-- hours for the day.
--
-- Nothing here could say that. One `hours` column drove the invoice and the
-- cheque together, so making his stub right meant making the invoice wrong, and
-- the other way about. The office had been squaring it by hand.
--
-- ---------------------------------------------------------------------------
-- WHICH ONE IS THE OVERRIDE
-- ---------------------------------------------------------------------------
--
-- `hours` keeps meaning what it has always meant -- what goes on the invoice --
-- and the new column is what the man is paid for. Null means they are the same,
-- which is the ordinary case and every row already on file. So nothing that
-- exists moves by a cent when this lands: the override is null everywhere, and
-- coalesce hands back `hours`.
--
-- Doing it the other way round -- `hours` becomes paid, an override for billed
-- -- would have been just as correct and would have rewritten the meaning of
-- every row in the table on the way past. Not worth it.
--
-- ---------------------------------------------------------------------------
-- WHERE IT HAD TO BE TAUGHT
-- ---------------------------------------------------------------------------
--
-- Six places multiplied hours by a pay rate. All six now use pay_hours, and
-- every place that multiplies by a bill rate is deliberately untouched:
--
--   v_work_lines            pay_hours resolves here, once, like every rate
--   v_week_welder_summary   what the man is owed
--   v_week_helper_summary   the same
--   v_week_job_invoice      the cost side of a job's margin
--   week_person_detail      the day-by-day lines on his pay statement
--   week_job_detail         the cost column on the job log
--
-- and in JavaScript, approvals.js, which draws the job log a second time.

alter table public.daily_entries
  add column if not exists pay_hours_override numeric
    check (pay_hours_override is null or pay_hours_override >= 0);

alter table public.daily_entry_helpers
  add column if not exists pay_hours_override numeric
    check (pay_hours_override is null or pay_hours_override >= 0);

comment on column public.daily_entries.pay_hours_override is
  'Hours this welder is paid for on this ticket, when that differs from the hours invoiced. Null = paid for the hours billed, which is the ordinary case.';
comment on column public.daily_entry_helpers.pay_hours_override is
  'Hours this helper is paid for on this line, when that differs from the hours invoiced. Null = paid for the hours billed.';

-- pay_hours is appended at the end on purpose: create or replace will not let a
-- column be inserted in the middle, and every dependent view stays attached.
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
    b.bid_item_name,
    COALESCE(b.welder_pay_hours_override, b.welder_hours) AS pay_hours
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
    b.bid_item_name,
    COALESCE(deh.pay_hours_override, deh.hours) AS pay_hours
   FROM base b
     JOIN daily_entry_helpers deh ON deh.daily_entry_id = b.entry_id
     JOIN helpers h ON h.id = deh.helper_id
     LEFT JOIN jobs wj ON wj.id = b.work_job_id
     LEFT JOIN jobs foj ON foj.id = b.for_job_id
     LEFT JOIN jobs bj ON bj.id = b.bill_job_id
     LEFT JOIN jobs cj ON cj.id = b.cost_job_id;

-- ---------------------------------------------------------------------------
-- THE FIVE THINGS THAT MULTIPLY BY A PAY RATE
-- ---------------------------------------------------------------------------
--
-- Each keeps its own column list exactly as it was, so create or replace holds
-- and nothing downstream needs rebuilding. Only the cost expressions move.

-- A person's own week. total_hours becomes what he is paid for, because this is
-- what his pay statement is drawn from and 19.5 on a stub he is paid 11.5 for
-- is worse than useless. hours_billed is money and stays on billed hours.
create or replace view public.v_week_welder_summary as
 WITH hrs AS (
         SELECT v_work_lines.week_start, v_work_lines.person_id,
            max(v_work_lines.person_name) AS person_name,
            sum(v_work_lines.pay_hours) AS total_hours,
            sum((v_work_lines.pay_hours * v_work_lines.pay_rate)) AS hours_paid,
            sum((v_work_lines.hours * v_work_lines.bill_rate)) AS hours_billed,
            count(DISTINCT v_work_lines.entry_date) AS days_worked,
            count(DISTINCT v_work_lines.cost_job_id) AS jobs_worked
           FROM v_work_lines
          WHERE (v_work_lines.person_kind = 'welder'::text)
          GROUP BY v_work_lines.week_start, v_work_lines.person_id
        ), pd_paid AS (
         SELECT v_per_diem_days_by_person.week_start, v_per_diem_days_by_person.person_id,
            count(*) AS per_diem_days,
            sum(v_per_diem_days_by_person.per_diem_rate) AS per_diem_paid
           FROM v_per_diem_days_by_person
          WHERE (v_per_diem_days_by_person.person_kind = 'welder'::text)
          GROUP BY v_per_diem_days_by_person.week_start, v_per_diem_days_by_person.person_id
        ), pd_bill AS (
         SELECT v_per_diem_days_by_job.week_start, v_per_diem_days_by_job.person_id,
            count(*) AS per_diem_charges,
            sum(v_per_diem_days_by_job.per_diem_rate) AS per_diem_billed
           FROM v_per_diem_days_by_job
          WHERE (v_per_diem_days_by_job.person_kind = 'welder'::text)
          GROUP BY v_per_diem_days_by_job.week_start, v_per_diem_days_by_job.person_id
        )
 SELECT h.week_start, (h.week_start + 6) AS week_end,
    h.person_id AS welder_id, h.person_name AS welder_name,
    h.days_worked, h.jobs_worked, h.total_hours,
    round(h.hours_paid, 2) AS hours_paid,
    round(h.hours_billed, 2) AS hours_billed,
    COALESCE(pp.per_diem_days, (0)::bigint) AS per_diem_days,
    round(COALESCE(pp.per_diem_paid, (0)::numeric), 2) AS per_diem_amount,
    COALESCE(pb.per_diem_charges, (0)::bigint) AS per_diem_charges,
    round(COALESCE(pb.per_diem_billed, (0)::numeric), 2) AS per_diem_billed,
    round((h.hours_paid + COALESCE(pp.per_diem_paid, (0)::numeric)), 2) AS total_paid,
    round((h.hours_billed + COALESCE(pb.per_diem_billed, (0)::numeric)), 2) AS total_billed
   FROM ((hrs h
     LEFT JOIN pd_paid pp ON (((pp.week_start = h.week_start) AND (pp.person_id = h.person_id))))
     LEFT JOIN pd_bill pb ON (((pb.week_start = h.week_start) AND (pb.person_id = h.person_id))));

create or replace view public.v_week_helper_summary as
 WITH hrs AS (
         SELECT v_work_lines.week_start, v_work_lines.person_id,
            max(v_work_lines.person_name) AS person_name,
            sum(v_work_lines.pay_hours) AS total_hours,
            sum((v_work_lines.pay_hours * v_work_lines.pay_rate)) AS hours_paid,
            sum((v_work_lines.hours * v_work_lines.bill_rate)) AS hours_billed,
            count(DISTINCT v_work_lines.entry_date) AS days_worked,
            count(DISTINCT v_work_lines.cost_job_id) AS jobs_worked
           FROM v_work_lines
          WHERE (v_work_lines.person_kind = 'helper'::text)
          GROUP BY v_work_lines.week_start, v_work_lines.person_id
        ), pd_paid AS (
         SELECT v_per_diem_days_by_person.week_start, v_per_diem_days_by_person.person_id,
            count(*) AS per_diem_days,
            sum(v_per_diem_days_by_person.per_diem_rate) AS per_diem_paid
           FROM v_per_diem_days_by_person
          WHERE (v_per_diem_days_by_person.person_kind = 'helper'::text)
          GROUP BY v_per_diem_days_by_person.week_start, v_per_diem_days_by_person.person_id
        ), pd_bill AS (
         SELECT v_per_diem_days_by_job.week_start, v_per_diem_days_by_job.person_id,
            count(*) AS per_diem_charges,
            sum(v_per_diem_days_by_job.per_diem_rate) AS per_diem_billed
           FROM v_per_diem_days_by_job
          WHERE (v_per_diem_days_by_job.person_kind = 'helper'::text)
          GROUP BY v_per_diem_days_by_job.week_start, v_per_diem_days_by_job.person_id
        )
 SELECT h.week_start, (h.week_start + 6) AS week_end,
    h.person_id AS helper_id, h.person_name AS helper_name,
    h.days_worked, h.jobs_worked, h.total_hours,
    round(h.hours_paid, 2) AS hours_paid,
    round(h.hours_billed, 2) AS hours_billed,
    COALESCE(pp.per_diem_days, (0)::bigint) AS per_diem_days,
    round(COALESCE(pp.per_diem_paid, (0)::numeric), 2) AS per_diem_amount,
    COALESCE(pb.per_diem_charges, (0)::bigint) AS per_diem_charges,
    round(COALESCE(pb.per_diem_billed, (0)::numeric), 2) AS per_diem_billed,
    round((h.hours_paid + COALESCE(pp.per_diem_paid, (0)::numeric)), 2) AS total_paid,
    round((h.hours_billed + COALESCE(pb.per_diem_billed, (0)::numeric)), 2) AS total_billed
   FROM ((hrs h
     LEFT JOIN pd_paid pp ON (((pp.week_start = h.week_start) AND (pp.person_id = h.person_id))))
     LEFT JOIN pd_bill pb ON (((pb.week_start = h.week_start) AND (pb.person_id = h.person_id))));

-- The day-by-day lines on a pay statement. `hours` here is what he is paid for,
-- because that is the column the stub prints beside the money.
create or replace function public.week_person_detail(p_week date, p_kind text, p_person uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(d order by d->>'date'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'date', wl.entry_date, 'day', to_char(wl.entry_date,'Dy'),
      'job', coalesce(wl.cost_job_name, wl.one_off_name),
      'worked_at', wl.work_job_name,
      'bills_to', wl.bill_job_name,
      'bid_item', wl.bid_item_name,
      'hours', wl.pay_hours, 'pay_rate', wl.pay_rate, 'bill_rate', wl.bill_rate,
      'hours_billed', wl.hours,
      'per_diem', wl.per_diem_flag, 'per_diem_rate', wl.per_diem_rate,
      'paid', round(wl.pay_hours * wl.pay_rate, 2),
      'billed', round(wl.hours * wl.bill_rate, 2),
      'description', wl.description
    ) as d
    from public.v_work_lines wl
    where wl.week_start = p_week and wl.person_kind = p_kind and wl.person_id = p_person
  ) s;
$function$;

-- The job log. `hours` stays the invoiced hours -- this is what the customer is
-- charged for -- and the cost column beside it uses what the man is paid.
create or replace function public.week_job_detail(p_week date, p_job uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(d order by d->>'date', d->>'name'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'date', wl.entry_date, 'day', to_char(wl.entry_date,'Dy'),
      'kind', wl.person_kind, 'name', wl.person_name,
      'hours', wl.hours, 'pay_rate', wl.pay_rate, 'bill_rate', wl.bill_rate,
      'pay_hours', wl.pay_hours,
      'stainless', wl.is_stainless,
      'per_diem', (wl.per_diem_flag and wl.bill_job_id = p_job),
      'per_diem_rate', wl.per_diem_rate,
      'on_invoice', (wl.bill_job_id = p_job),
      'billed', case when wl.bill_job_id = p_job then round(wl.hours * wl.bill_rate, 2) else 0 end,
      'paid',   round(wl.pay_hours * wl.pay_rate, 2),
      'worked_at', coalesce(wl.work_job_name, wl.one_off_name),
      'bills_to',  wl.bill_job_name,
      'bid_item',  wl.bid_item_name,
      'description', wl.description
    ) as d
    from public.v_work_lines wl
    where wl.week_start = p_week
      and (wl.bill_job_id = p_job or wl.cost_job_id = p_job)
  ) s;
$function$;

-- A job's margin. Revenue is unchanged -- billable_hours, welder_hours,
-- helper_hours and hours_value all stay on invoiced hours, because that is what
-- the customer is charged. Only the cost CTE moves to what the men are paid.
create or replace view public.v_week_job_invoice as
 WITH rev AS (
         SELECT v_work_lines.week_start,
            v_work_lines.bill_job_id AS job_id,
            sum(v_work_lines.hours) AS billable_hours,
            sum(CASE WHEN (v_work_lines.person_kind = 'welder'::text) THEN v_work_lines.hours ELSE (0)::numeric END) AS welder_hours,
            sum(CASE WHEN (v_work_lines.person_kind = 'helper'::text) THEN v_work_lines.hours ELSE (0)::numeric END) AS helper_hours,
            sum((v_work_lines.hours * v_work_lines.bill_rate)) AS hours_value,
            count(DISTINCT v_work_lines.entry_date) AS days_worked
           FROM v_work_lines
          WHERE (v_work_lines.bill_job_id IS NOT NULL)
          GROUP BY v_work_lines.week_start, v_work_lines.bill_job_id
        ), rev_pd AS (
         SELECT v_per_diem_days_by_job.week_start,
            v_per_diem_days_by_job.bill_job_id AS job_id,
            count(*) AS per_diem_person_days,
            count(DISTINCT v_per_diem_days_by_job.entry_date) AS per_diem_days,
            count(DISTINCT v_per_diem_days_by_job.person_id) AS per_diem_crew,
            sum(v_per_diem_days_by_job.per_diem_rate) AS per_diem_amount,
            max(v_per_diem_days_by_job.per_diem_rate) AS per_diem_rate
           FROM v_per_diem_days_by_job
          GROUP BY v_per_diem_days_by_job.week_start, v_per_diem_days_by_job.bill_job_id
        ), cost AS (
         SELECT v_work_lines.week_start,
            v_work_lines.cost_job_id AS job_id,
            sum(v_work_lines.pay_hours) AS cost_hours,
            sum((v_work_lines.pay_hours * v_work_lines.pay_rate)) AS hours_paid,
            count(DISTINCT v_work_lines.person_id) AS crew_count,
            count(DISTINCT v_work_lines.entry_date) AS cost_days
           FROM v_work_lines
          WHERE (v_work_lines.cost_job_id IS NOT NULL)
          GROUP BY v_work_lines.week_start, v_work_lines.cost_job_id
        ), cost_pd AS (
         SELECT v_per_diem_cost_alloc.week_start,
            v_per_diem_cost_alloc.cost_job_id AS job_id,
            sum(v_per_diem_cost_alloc.per_diem_cost) AS per_diem_paid
           FROM v_per_diem_cost_alloc
          GROUP BY v_per_diem_cost_alloc.week_start, v_per_diem_cost_alloc.cost_job_id
        ), keys AS (
         SELECT rev.week_start, rev.job_id FROM rev
        UNION
         SELECT cost.week_start, cost.job_id FROM cost
        UNION
         SELECT v_week_bid_billing.week_start, v_week_bid_billing.job_id FROM v_week_bid_billing
        )
 SELECT k.week_start,
    (k.week_start + 6) AS week_end,
    k.job_id,
    j.name AS job_name,
    j.bill_to,
    j.operator,
    j.billing_type,
    j.bid_number,
    j.bid_date,
    COALESCE(r.days_worked, c.cost_days, (0)::bigint) AS days_worked,
    COALESCE(c.crew_count, (0)::bigint) AS crew_count,
    COALESCE(r.welder_hours, (0)::numeric) AS welder_hours,
    COALESCE(r.helper_hours, (0)::numeric) AS helper_hours,
    COALESCE(c.cost_hours, (0)::numeric) AS total_hours,
    round(COALESCE(r.hours_value, (0)::numeric), 2) AS hours_value,
    round(CASE WHEN (j.billing_type = 'flat'::text) THEN (0)::numeric
               ELSE COALESCE(r.hours_value, (0)::numeric) END, 2) AS hours_billed,
    COALESCE(rp.per_diem_days, (0)::bigint) AS per_diem_days,
    COALESCE(rp.per_diem_person_days, (0)::bigint) AS per_diem_person_days,
    COALESCE(rp.per_diem_crew, (0)::bigint) AS per_diem_crew,
    round(COALESCE(rp.per_diem_rate, (0)::numeric), 2) AS per_diem_rate,
    round(COALESCE(rp.per_diem_amount, (0)::numeric), 2) AS per_diem_amount,
    round(COALESCE(cp.per_diem_paid, (0)::numeric), 2) AS per_diem_paid,
    round(COALESCE(pr.parts_amount, (0)::numeric), 2) AS parts_amount,
    round(COALESCE(b.bid_amount, (0)::numeric), 2) AS bid_amount,
    COALESCE(b.bid_lines, (0)::bigint) AS bid_lines,
    round(COALESCE(jw.flat_amount, (0)::numeric), 2) AS flat_amount,
    round(((CASE WHEN (j.billing_type = 'flat'::text)
                 THEN (COALESCE(b.bid_amount, (0)::numeric) + COALESCE(jw.flat_amount, (0)::numeric))
                 ELSE (COALESCE(r.hours_value, (0)::numeric) + COALESCE(jw.flat_amount, (0)::numeric))
            END + COALESCE(rp.per_diem_amount, (0)::numeric)) + COALESCE(pr.parts_amount, (0)::numeric)), 2) AS total_billed,
    round((COALESCE(c.hours_paid, (0)::numeric) + COALESCE(cp.per_diem_paid, (0)::numeric)), 2) AS total_paid,
    round((((CASE WHEN (j.billing_type = 'flat'::text)
                  THEN (COALESCE(b.bid_amount, (0)::numeric) + COALESCE(jw.flat_amount, (0)::numeric))
                  ELSE (COALESCE(r.hours_value, (0)::numeric) + COALESCE(jw.flat_amount, (0)::numeric))
             END + COALESCE(rp.per_diem_amount, (0)::numeric)) + COALESCE(pr.parts_amount, (0)::numeric))
           - (COALESCE(c.hours_paid, (0)::numeric) + COALESCE(cp.per_diem_paid, (0)::numeric))), 2) AS margin,
    jw.id AS job_week_id,
    COALESCE(jw.status, 'open'::text) AS status,
    jw.invoice_no,
    jw.approved_at
   FROM ((((((((keys k
     JOIN jobs j ON ((j.id = k.job_id)))
     LEFT JOIN rev r ON (((r.week_start = k.week_start) AND (r.job_id = k.job_id))))
     LEFT JOIN rev_pd rp ON (((rp.week_start = k.week_start) AND (rp.job_id = k.job_id))))
     LEFT JOIN cost c ON (((c.week_start = k.week_start) AND (c.job_id = k.job_id))))
     LEFT JOIN cost_pd cp ON (((cp.week_start = k.week_start) AND (cp.job_id = k.job_id))))
     LEFT JOIN v_week_job_parts pr ON (((pr.week_start = k.week_start) AND (pr.job_id = k.job_id))))
     LEFT JOIN v_week_bid_billing b ON (((b.week_start = k.week_start) AND (b.job_id = k.job_id))))
     LEFT JOIN job_weeks jw ON (((jw.job_id = k.job_id) AND (jw.week_start = k.week_start))));
