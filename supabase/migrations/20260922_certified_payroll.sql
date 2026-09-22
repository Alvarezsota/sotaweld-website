-- Certified payroll for prevailing wage work.
--
-- Infinium's Project Roadrunner (Electric Hydrogen's site at 264 Shaw Rd, Pecos)
-- runs under the IRA prevailing wage rules, and every week the crew is on site
-- a certified payroll report goes into LCPtracker: who was there, what they
-- are classified as, the hours each day, the rate, gross, deductions and net,
-- plus a signed Statement of Compliance. That is the federal WH-347 form, and
-- the office was going to be typing it up by hand from the pay statements.
--
-- Everything the form needs is already in the tickets except three things per
-- man (his classification on the job, the last four of his SSN, his address)
-- and a few things per job (that it is prevailing wage at all, the project
-- name and site, the wage determination rates). This adds those, a table that
-- remembers what was submitted and under which payroll number, and one RPC
-- that assembles the report for a job and a week.
--
-- ---------------------------------------------------------------------------
-- WHAT COUNTS
-- ---------------------------------------------------------------------------
--
-- Hours ON THE PROJECT are the tickets logged against the job itself
-- (work_job_id): the man was physically at the site. Shop hours "for" the job
-- are not site work and are left off the certified report, though they still
-- count toward his 40 for the week, because overtime is a fact about the week
-- and not about one customer.
--
-- Overtime is anything past 40 hours in the Monday-to-Sunday week, taken in
-- date order: the day that crosses 40 is split, and that day's overtime is
-- shared between the project and whatever else he did that day in proportion
-- to the hours. The crew is paid straight time, so the report shows what was
-- paid and the page flags the premium the rules expect on top.
--
-- The last four of the SSN is all that is stored here. LCPtracker holds the
-- full number in its own employee record, which is where Infinium asked for
-- it; it has no business in this database.

-- ---------------------------------------------------------------------------
-- 1. What the form needs to know about a man
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists ssn_last4 text,
  add column if not exists home_address text,
  add column if not exists pw_classification text;

alter table public.helpers
  add column if not exists ssn_last4 text,
  add column if not exists home_address text,
  add column if not exists pw_classification text;

comment on column public.profiles.ssn_last4 is 'Last four of the SSN, for the identifying number on certified payroll. Never the full number.';
comment on column public.profiles.pw_classification is 'Job classification on prevailing wage work (Pipefitter, Welder, Laborer...). Defaults onto every report he appears on.';
comment on column public.helpers.ssn_last4 is 'Last four of the SSN, for the identifying number on certified payroll. Never the full number.';
comment on column public.helpers.pw_classification is 'Job classification on prevailing wage work. Defaults onto every report he appears on.';

-- ---------------------------------------------------------------------------
-- 2. What the form needs to know about a job
-- ---------------------------------------------------------------------------
alter table public.jobs
  add column if not exists prevailing_wage boolean not null default false,
  add column if not exists pw_project_name text,
  add column if not exists pw_project_number text,
  add column if not exists pw_contracting_agency text,
  add column if not exists pw_site_address text,
  add column if not exists pw_rates jsonb not null default '{}'::jsonb;

comment on column public.jobs.prevailing_wage is 'True when the job is under prevailing wage rules and needs a certified payroll report each week the crew is on site.';
comment on column public.jobs.pw_rates is 'Wage determination by classification: {"Pipefitter": {"base": 32.5, "fringe": 12.1}}. The page compares what each man is paid against base + fringe.';

-- ---------------------------------------------------------------------------
-- 3. What was submitted, and as which payroll number
-- ---------------------------------------------------------------------------
-- Payroll numbers run 1, 2, 3 per project in the order the weeks are submitted,
-- and the number is taken the moment a report is marked submitted, never
-- before, so a draft that is never sent does not leave a hole in the sequence.
create table if not exists public.certified_payroll_reports (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  week_start date not null,
  payroll_no integer,
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  pay_date date,
  signer_name text,
  signer_title text,
  notes text,
  snapshot jsonb,
  submitted_at timestamptz,
  submitted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, week_start)
);

alter table public.certified_payroll_reports enable row level security;

drop policy if exists certified_payroll_reports_admin on public.certified_payroll_reports;
create policy certified_payroll_reports_admin on public.certified_payroll_reports
  for all using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- 4. The report
-- ---------------------------------------------------------------------------
create or replace function public.get_certified_payroll(p_job uuid, p_week date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_job     jobs%rowtype;
  v_report  certified_payroll_reports%rowtype;
  v_next_no integer;
  v_company jsonb;
  v_workers jsonb;
begin
  if not is_admin(auth.uid()) then
    raise exception 'Certified payroll is for admins only';
  end if;

  select * into v_job from jobs where id = p_job;
  if not found then
    raise exception 'No such job';
  end if;

  select * into v_report
  from certified_payroll_reports
  where job_id = p_job and week_start = p_week;

  select coalesce(max(payroll_no), 0) + 1 into v_next_no
  from certified_payroll_reports
  where job_id = p_job and payroll_no is not null;

  select jsonb_object_agg(key, value) into v_company
  from app_settings
  where key in ('company_name', 'company_address', 'company_phone');

  with lines as (
    -- Every line of the week for every man who set foot on the project. The
    -- other jobs he worked ride along because his 40 and his week's gross
    -- are about all of it, not just this site.
    select wl.person_kind, wl.person_id, wl.person_name, wl.entry_date,
           wl.pay_hours as hours, wl.pay_rate,
           (wl.work_job_id = p_job) as on_project,
           wl.per_diem_flag, wl.per_diem_rate
    from v_work_lines wl
    where wl.week_start = p_week
      and (wl.person_kind, wl.person_id) in (
        select x.person_kind, x.person_id
        from v_work_lines x
        where x.week_start = p_week and x.work_job_id = p_job
      )
  ),
  days as (
    select person_kind, person_id, entry_date,
           sum(hours) as day_all,
           coalesce(sum(hours) filter (where on_project), 0) as day_proj
    from lines
    group by 1, 2, 3
  ),
  cum as (
    select d.*,
           coalesce(sum(day_all) over (
             partition by person_kind, person_id
             order by entry_date
             rows between unbounded preceding and 1 preceding), 0) as before_today
    from days d
  ),
  split as (
    -- Overtime is the part of the day that lands past hour 40 of the week.
    select c.*,
           greatest(0, least(day_all, before_today + day_all - 40)) as ot_all
    from cum c
  ),
  split2 as (
    select s.*,
           case when day_all > 0 then round(ot_all * day_proj / day_all, 2) else 0 end as ot_proj
    from split s
  ),
  people as (
    select person_kind, person_id, max(person_name) as person_name
    from lines where on_project
    group by 1, 2
  ),
  rates as (
    select person_kind, person_id,
           array_agg(distinct pay_rate order by pay_rate) as rates,
           max(pay_rate) as rate
    from lines where on_project
    group by 1, 2
  ),
  pd as (
    -- Per diem is paid once per man per day whatever else he did that day.
    select person_kind, person_id, entry_date,
           max(per_diem_rate) as pd_rate,
           bool_or(on_project) as pd_on_project
    from lines
    where per_diem_flag
    group by 1, 2, 3
  ),
  pd_sum as (
    select person_kind, person_id,
           sum(pd_rate) as per_diem_week,
           coalesce(sum(pd_rate) filter (where pd_on_project), 0) as per_diem_project
    from pd
    group by 1, 2
  ),
  gross as (
    select person_kind, person_id,
           sum(hours * pay_rate) as gross_week_hours,
           coalesce(sum(hours * pay_rate) filter (where on_project), 0) as gross_project,
           sum(hours) as hours_week,
           coalesce(sum(hours) filter (where on_project), 0) as hours_project
    from lines
    group by 1, 2
  ),
  ot as (
    select person_kind, person_id,
           sum(ot_proj) as ot_project,
           sum(ot_all) as ot_week
    from split2
    group by 1, 2
  )
  select jsonb_agg(
           jsonb_build_object(
             'kind', p.person_kind,
             'person_id', p.person_id,
             'name', p.person_name,
             'ssn_last4', coalesce(pr.ssn_last4, h.ssn_last4),
             'home_address', coalesce(pr.home_address, h.home_address),
             'classification', coalesce(pr.pw_classification, h.pw_classification),
             'rate', r.rate,
             'rates', to_jsonb(r.rates),
             'hours_project', g.hours_project,
             'ot_project', coalesce(o.ot_project, 0),
             'st_project', g.hours_project - coalesce(o.ot_project, 0),
             'hours_week', g.hours_week,
             'ot_week', coalesce(o.ot_week, 0),
             'gross_project', round(g.gross_project, 2),
             'gross_week_hours', round(g.gross_week_hours, 2),
             'per_diem_project', round(coalesce(ps.per_diem_project, 0), 2),
             'per_diem_week', round(coalesce(ps.per_diem_week, 0), 2),
             'gross_week', round(g.gross_week_hours + coalesce(ps.per_diem_week, 0), 2),
             'days', (
               select jsonb_agg(jsonb_build_object(
                        'date', d::date,
                        'hours', coalesce(s.day_proj, 0),
                        'ot', coalesce(s.ot_proj, 0),
                        'st', coalesce(s.day_proj, 0) - coalesce(s.ot_proj, 0),
                        'hours_all', coalesce(s.day_all, 0)
                      ) order by d)
               from generate_series(p_week, p_week + 6, interval '1 day') d
               left join split2 s
                 on s.person_kind = p.person_kind
                and s.person_id = p.person_id
                and s.entry_date = d::date
             )
           )
           order by p.person_kind desc, p.person_name
         )
  into v_workers
  from people p
  join gross g on g.person_kind = p.person_kind and g.person_id = p.person_id
  join rates r on r.person_kind = p.person_kind and r.person_id = p.person_id
  left join ot o on o.person_kind = p.person_kind and o.person_id = p.person_id
  left join pd_sum ps on ps.person_kind = p.person_kind and ps.person_id = p.person_id
  left join profiles pr on p.person_kind = 'welder' and pr.id = p.person_id
  left join helpers h on p.person_kind = 'helper' and h.id = p.person_id;

  return jsonb_build_object(
    'job', jsonb_build_object(
      'id', v_job.id,
      'name', v_job.name,
      'bill_to', v_job.bill_to,
      'operator', v_job.operator,
      'po_number', v_job.po_number,
      'prevailing_wage', v_job.prevailing_wage,
      'pw_project_name', v_job.pw_project_name,
      'pw_project_number', v_job.pw_project_number,
      'pw_contracting_agency', v_job.pw_contracting_agency,
      'pw_site_address', v_job.pw_site_address,
      'pw_rates', v_job.pw_rates
    ),
    'company', coalesce(v_company, '{}'::jsonb),
    'week_start', p_week,
    'week_end', p_week + 6,
    'report', case when v_report.id is null then null else to_jsonb(v_report) - 'snapshot' end,
    'next_payroll_no', v_next_no,
    'workers', coalesce(v_workers, '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Remembering what went to LCPtracker
-- ---------------------------------------------------------------------------
-- Marking a week submitted takes the next payroll number for the project and
-- freezes a copy of the figures as they were sent, so a ticket corrected later
-- does not silently rewrite a report that has already been certified. Reopening
-- keeps the number: a corrected resubmission is the same payroll, amended.
create or replace function public.save_certified_payroll(
  p_job uuid,
  p_week date,
  p_status text,
  p_pay_date date default null,
  p_signer_name text default null,
  p_signer_title text default null,
  p_notes text default null,
  p_snapshot jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row certified_payroll_reports%rowtype;
  v_no  integer;
begin
  if not is_admin(auth.uid()) then
    raise exception 'Certified payroll is for admins only';
  end if;
  if p_status not in ('draft', 'submitted') then
    raise exception 'Status must be draft or submitted';
  end if;

  insert into certified_payroll_reports (job_id, week_start, status, pay_date, signer_name, signer_title, notes)
  values (p_job, p_week, 'draft', p_pay_date, p_signer_name, p_signer_title, p_notes)
  on conflict (job_id, week_start) do update
    set pay_date     = coalesce(excluded.pay_date, certified_payroll_reports.pay_date),
        signer_name  = coalesce(excluded.signer_name, certified_payroll_reports.signer_name),
        signer_title = coalesce(excluded.signer_title, certified_payroll_reports.signer_title),
        notes        = coalesce(excluded.notes, certified_payroll_reports.notes),
        updated_at   = now()
  returning * into v_row;

  if p_status = 'submitted' then
    if v_row.payroll_no is null then
      select coalesce(max(payroll_no), 0) + 1 into v_no
      from certified_payroll_reports
      where job_id = p_job and payroll_no is not null;
    else
      v_no := v_row.payroll_no;
    end if;
    update certified_payroll_reports
       set status = 'submitted', payroll_no = v_no,
           snapshot = coalesce(p_snapshot, snapshot),
           submitted_at = now(), submitted_by = auth.uid(), updated_at = now()
     where id = v_row.id
    returning * into v_row;
  elsif v_row.status = 'submitted' then
    update certified_payroll_reports
       set status = 'draft', updated_at = now()
     where id = v_row.id
    returning * into v_row;
  end if;

  return to_jsonb(v_row) - 'snapshot';
end;
$$;

-- Weeks that have anything to report for a job: the ones with site hours, plus
-- any that were submitted, so a week that was certified and then had its
-- tickets moved still shows up rather than vanishing from the list.
create or replace function public.list_certified_payroll_weeks(p_job uuid)
returns table (week_start date, week_end date, people integer, hours numeric, status text, payroll_no integer)
language sql
stable
security definer
set search_path to 'public'
as $$
  with weeks as (
    select wl.week_start,
           count(distinct (wl.person_kind, wl.person_id))::integer as people,
           sum(wl.pay_hours) as hours
    from v_work_lines wl
    where wl.work_job_id = p_job
    group by wl.week_start
  ),
  reports as (
    select r.week_start, r.status, r.payroll_no
    from certified_payroll_reports r
    where r.job_id = p_job
  )
  select coalesce(w.week_start, r.week_start) as week_start,
         coalesce(w.week_start, r.week_start) + 6 as week_end,
         coalesce(w.people, 0) as people,
         coalesce(w.hours, 0) as hours,
         coalesce(r.status, 'none') as status,
         r.payroll_no
  from weeks w
  full outer join reports r on r.week_start = w.week_start
  where is_admin(auth.uid())
  order by 1 desc;
$$;

grant execute on function public.get_certified_payroll(uuid, date) to authenticated;
grant execute on function public.save_certified_payroll(uuid, date, text, date, text, text, text, jsonb) to authenticated;
grant execute on function public.list_certified_payroll_weeks(uuid) to authenticated;
