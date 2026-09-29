-- The week is not the pay period.
--
-- Overtime is a fact about a workweek. This shop's workweek is Monday to
-- Sunday -- it is what the job weeks run on, what Approvals runs on, what the
-- welders' tickets run on -- and over forty hours in it is paid at one and a
-- half. That is settled and this does not change it.
--
-- QuickBooks pays on a different calendar. The pay period is Thursday to
-- Wednesday, paid the Friday after: 09-24 to 09-30, paid 10-02. So every
-- payroll run reaches across two workweeks and takes part of each.
--
-- Both can be true at once -- federal law lets an employer fix any recurring
-- seven-day workweek, and it does not have to match the pay period -- but it
-- means the week's total on screen is NOT the number typed into the run. The
-- run wants the hours that fall inside 09-24 to 09-30. Overtime is still
-- decided by the Monday-to-Sunday week, but only the overtime hours that land
-- inside those seven days belong to that cheque.
--
-- HOW AN OVERTIME HOUR GETS A DATE
-- ---------------------------------------------------------------------------
-- Overtime is the hours past the fortieth in the week, and which day those
-- fall on is not a matter of opinion: they are the last hours worked. So the
-- days of a workweek are run through in order, keeping a running total, and
-- each day's hours are split where that total crosses forty. A week of five
-- ten-hour days puts the overtime on Friday, because that is when it was
-- worked. Then the period simply takes the days that are inside it.

-- Where the pay period starts. One Thursday on file and every period is seven
-- days from it, so this follows QuickBooks rather than guessing, and a change
-- of schedule is one row rather than a code change.
insert into public.app_settings (key, value)
values ('payroll_period_anchor', '2026-09-24')
on conflict (key) do nothing;

insert into public.app_settings (key, value)
values ('payroll_pay_day_offset', '2')
on conflict (key) do nothing;

create or replace function public.office_pay_period(p_for date default null)
returns table (period_start date, period_end date, pay_date date)
language sql stable
set search_path to 'public'
as $$
  with a as (
    select coalesce((select value::date from app_settings where key = 'payroll_period_anchor'),
                    date '2026-09-24') as anchor,
           coalesce((select value::int from app_settings where key = 'payroll_pay_day_offset'), 2) as pay_offset,
           coalesce(p_for, (now() at time zone 'America/Chicago')::date) as d
  )
  -- Modulo, so it works for a date before the anchor as well as after it.
  -- Postgres's % keeps the sign of the left side, which would put a date
  -- earlier than the anchor in the period after the one it belongs to.
  select s, s + 6, s + 6 + a.pay_offset
  from a, lateral (select a.d - (((a.d - a.anchor) % 7 + 7) % 7)) as x(s);
$$;

comment on function public.office_pay_period(date) is
  'The QuickBooks pay period a date falls in, and the day it is paid. Seven '
  'days from the anchor in app_settings, so the schedule is a setting rather '
  'than a number buried in a query.';

create or replace function public.office_period_totals(
  p_employee uuid,
  p_start date,
  p_end date
)
returns table (
  period_start date,
  period_end date,
  hours numeric,
  regular_hours numeric,
  overtime_hours numeric,
  regular_pay numeric,
  overtime_pay numeric,
  gross_pay numeric
)
language sql stable
security invoker
set search_path to 'public'
as $$
  with days as (
    -- Every day of every workweek the period touches, not just the days inside
    -- it: a Thursday's overtime depends on the Monday, Tuesday and Wednesday
    -- before it, which belong to the period before.
    select d.work_date, d.week_start, d.hours
    from office_time_days d
    where d.employee_id = p_employee
      and d.week_start between date_trunc('week', p_start)::date
                           and date_trunc('week', p_end)::date
  ),
  running as (
    select work_date, hours,
           sum(hours) over (partition by week_start order by work_date
                            rows between unbounded preceding and current row) as through_today
    from days
  ),
  split as (
    -- The part of this day that sits past the fortieth hour of its week.
    -- Nothing before the fortieth, all of it once the week is already over.
    select work_date, hours,
           greatest(least(hours, through_today - 40), 0) as ot
    from running
  ),
  inside as (
    select coalesce(sum(hours), 0) as h, coalesce(sum(ot), 0) as o
    from split where work_date between p_start and p_end
  ),
  rate as (
    select coalesce(pay_rate, 0) as r from profiles where id = p_employee
  )
  select p_start, p_end,
         round(inside.h, 2),
         round(inside.h - inside.o, 2),
         round(inside.o, 2),
         round((inside.h - inside.o) * rate.r, 2),
         round(inside.o * rate.r * 1.5, 2),
         round((inside.h - inside.o) * rate.r + inside.o * rate.r * 1.5, 2)
  from inside, rate;
$$;

comment on function public.office_period_totals(uuid, date, date) is
  'What one QuickBooks payroll run should be paid: the hours inside the pay '
  'period, with overtime still decided by the Monday-to-Sunday workweek and '
  'placed on the days it was actually worked. These are the numbers typed '
  'into the run.';

grant execute on function public.office_pay_period(date) to authenticated;
grant execute on function public.office_period_totals(uuid, date, date) to authenticated;
