-- The office punches a clock.
--
-- Everybody in this portal until now is paid for hours against a job: a welder
-- files a ticket, the ticket says which job and how long, and the same hours
-- that pay him bill the customer. Alexis Ramos is the first person paid for
-- being at a desk. There is no job to bill, no per diem, no weld report -- just
-- the time she is here, which means a clock rather than a ticket.
--
-- WHY time_entries AND NOT daily_entries
-- ---------------------------------------------------------------------------
-- A daily_entries row is a statement about a job: hours, job_id, per diem,
-- bill rate, stainless. Typing a desk day in there would mean inventing a job
-- for it and then teaching every invoice query to leave that job out again.
-- time_entries has existed since the first day of this project and has never
-- been used for anything -- one test row from 08-11 and not a single reference
-- in the code. It is exactly the right shape: a person, a time in, a time out.
-- This is that table finally being put to work.
--
-- HOW A DAY IS SHAPED
-- ---------------------------------------------------------------------------
-- One row per stretch, not one row per day:
--
--   work   08:02 -> 12:07
--   lunch  12:07 -> 12:41
--   work   12:41 -> 17:03
--
-- Paid time is the sum of the work rows, so a lunch costs nothing without
-- anybody subtracting it, and a second lunch or a run to the bank is three
-- more rows rather than a column that does not exist. It also lets the screen
-- tell "at lunch" apart from "gone home", which one clock_out per day cannot:
-- both look like nothing open.
--
-- Overtime is not stored. It is the week's hours over forty, and storing it
-- would mean a number that disagrees with the punches the moment one is fixed.
-- office_time_weeks works it out from the rows every time it is asked.

-- ---------------------------------------------------------------------------
-- 1. A person can be office staff
-- ---------------------------------------------------------------------------
-- pay_kind has allowed 'welder' or 'helper' since it was added and is read
-- nowhere -- no function, no view, no line of the site. It is the right place
-- for this because it is the only column that answers "what kind of person is
-- this", and widening a constraint nothing reads cannot break what it does not
-- touch.

alter table public.profiles drop constraint if exists profiles_pay_kind_chk;
alter table public.profiles add constraint profiles_pay_kind_chk
  check (pay_kind = any (array['welder', 'helper', 'office']));

comment on column public.profiles.pay_kind is
  'What kind of person this is: welder or helper (paid by the hour against a '
  'job, billed to a customer) or office (paid for time on the clock, billed to '
  'nobody). Office staff file no ticket and no weld report; their time lives in '
  'time_entries.';

-- Which record this person is in QuickBooks payroll. Alexis already has one --
-- her rate, her W-4 and her filing status are Gilbert's to keep there, not
-- ours to copy. Holding the id means the hours this portal counts can be
-- matched to the right employee without going by name.
alter table public.profiles
  add column if not exists qb_employee_id text;

comment on column public.profiles.qb_employee_id is
  'This person''s employee id in QuickBooks Payroll, where they are on payroll. '
  'The rate, W-4 and filing status stay in QuickBooks; this is only the link.';

-- ---------------------------------------------------------------------------
-- 2. The punch clock
-- ---------------------------------------------------------------------------
alter table public.time_entries
  add column if not exists kind text not null default 'work',
  add column if not exists work_date date,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists edited_by uuid references public.profiles(id),
  add column if not exists edited_at timestamptz;

comment on table public.time_entries is
  'One stretch of an office person''s day: clocked in at, clocked out at. '
  'kind = work is paid, kind = lunch is not. A day is several rows.';
comment on column public.time_entries.kind is
  'work (paid) or lunch (not paid, and the reason the screen can say she is at '
  'lunch rather than gone).';
comment on column public.time_entries.work_date is
  'The day this stretch belongs to, in Odessa time -- set by trigger from '
  'clock_in, never by the page. Without it a punch after 7pm Central files '
  'itself on tomorrow, because UTC has already turned over.';
comment on column public.time_entries.edited_by is
  'Set when somebody other than the person themselves changed the punch, so a '
  'corrected time is visibly a corrected time.';

-- The stale test row from 08-11, the day this project was created. The clock
-- did not exist before today, so nothing before September is a day anybody
-- worked, and left alone it would show up in Alexis's first week.
delete from public.time_entries where clock_in < '2026-09-01';

update public.time_entries set work_date = (clock_in at time zone 'America/Chicago')::date
where work_date is null;

alter table public.time_entries drop constraint if exists time_entries_kind_chk;
alter table public.time_entries add constraint time_entries_kind_chk
  check (kind = any (array['work', 'lunch']));

-- A stretch that ends before it starts is a typo, and it would subtract hours
-- from the week.
alter table public.time_entries drop constraint if exists time_entries_out_after_in;
alter table public.time_entries add constraint time_entries_out_after_in
  check (clock_out is null or clock_out > clock_in);

-- work_date is filled by the database, not the browser, so a phone with the
-- wrong time zone cannot file Tuesday's morning under Monday.
create or replace function public.time_entry_set_work_date()
returns trigger
language plpgsql
as $$
begin
  new.work_date := (new.clock_in at time zone 'America/Chicago')::date;
  return new;
end;
$$;

drop trigger if exists time_entries_work_date on public.time_entries;
create trigger time_entries_work_date
  before insert or update of clock_in on public.time_entries
  for each row execute function public.time_entry_set_work_date();

-- One thing open at a time. Two open punches means the clock has lost track of
-- which one closing applies to, and whichever is left behind becomes a day
-- with no end.
create unique index if not exists time_entries_one_open_per_person
  on public.time_entries (employee_id)
  where clock_out is null;

-- Overlapping stretches are the one error on a timeclock that costs money
-- quietly: nothing looks wrong, the week is simply longer than the day was.
-- The app flow cannot produce one -- it closes what is open before it opens
-- anything -- but a hand-corrected time can, which is exactly when nobody is
-- watching the total.
create or replace function public.time_entry_no_overlap()
returns trigger
language plpgsql
as $$
declare
  clash record;
begin
  select id, clock_in, clock_out into clash
  from public.time_entries
  where employee_id = new.employee_id
    and id <> new.id
    -- An open row has no end yet, so treat it as running to the far future:
    -- anything starting after it started overlaps it.
    and tstzrange(clock_in, coalesce(clock_out, 'infinity'::timestamptz), '[)')
        && tstzrange(new.clock_in, coalesce(new.clock_out, 'infinity'::timestamptz), '[)')
  limit 1;

  if clash.id is not null then
    raise exception 'That time overlaps a punch already on the clock (% to %).',
      to_char(clash.clock_in at time zone 'America/Chicago', 'Mon DD HH12:MI AM'),
      coalesce(to_char(clash.clock_out at time zone 'America/Chicago', 'Mon DD HH12:MI AM'), 'still open')
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists time_entries_no_overlap on public.time_entries;
create trigger time_entries_no_overlap
  before insert or update of clock_in, clock_out on public.time_entries
  for each row execute function public.time_entry_no_overlap();

-- Nobody has worked the future. This is not a hypothetical: the way a punch
-- lands on the wrong day is a corrected time typed with the wrong date, and a
-- clock-out next Tuesday would quietly hand this week thirty extra hours.
-- A couple of minutes of slack because the browser's clock and the database's
-- clock are never quite the same.
create or replace function public.time_entry_not_in_future()
returns trigger
language plpgsql
as $$
begin
  if new.clock_in > now() + interval '2 minutes' then
    raise exception 'A punch cannot start in the future.'
      using errcode = 'check_violation';
  end if;
  if new.clock_out is not null and new.clock_out > now() + interval '2 minutes' then
    raise exception 'A punch cannot end in the future.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists time_entries_not_in_future on public.time_entries;
create trigger time_entries_not_in_future
  before insert or update of clock_in, clock_out on public.time_entries
  for each row execute function public.time_entry_not_in_future();

-- ---------------------------------------------------------------------------
-- 3. Who may punch, and whose punches anyone can see
-- ---------------------------------------------------------------------------
-- The three policies already on this table are right as far as they go: a
-- person inserts and updates their own rows, and reads their own or everything
-- if they are an admin. What is missing is the office correcting a punch --
-- somebody forgets to clock out and goes home, and only an admin can fix it.

-- Her own punches: she opens one, and she closes the one that is open. Once it
-- is closed it is a record of a day worked and she cannot reach back into it --
-- USING reads the row as it stands, so a row with an end already on it fails
-- the policy before any new value is considered. Correcting a closed punch is
-- the office's job, below.
drop policy if exists time_entries_update_own on public.time_entries;
create policy time_entries_update_own on public.time_entries
  for update to authenticated
  using (employee_id = auth.uid() and clock_out is null)
  with check (employee_id = auth.uid());

drop policy if exists time_entries_admin_write on public.time_entries;
create policy time_entries_admin_write on public.time_entries
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- Deleting your own punch is allowed while it is still open -- tapping Clock in
-- by accident should not need the office. A closed stretch is a record of a day
-- worked and only an admin removes it.
drop policy if exists time_entries_delete_own_open on public.time_entries;
create policy time_entries_delete_own_open on public.time_entries
  for delete to authenticated
  using (employee_id = auth.uid() and clock_out is null);

-- ---------------------------------------------------------------------------
-- 4. The day and the week
-- ---------------------------------------------------------------------------
-- security_invoker so these read as whoever asked. Without it a view owned by
-- the database owner sees past row-level security, and Alexis would be able to
-- read the whole company's clock through it.

create or replace view public.office_time_days
with (security_invoker = true) as
select
  t.employee_id,
  t.work_date,
  -- Monday, the same week the shop already runs on: job_weeks.week_start is a
  -- Monday and date_trunc('week') returns Monday.
  date_trunc('week', t.work_date)::date as week_start,
  round(sum(
    case when t.kind = 'work'
      then extract(epoch from (coalesce(t.clock_out, now()) - t.clock_in)) / 3600.0
      else 0 end
  )::numeric, 2) as hours,
  round(sum(
    case when t.kind = 'lunch'
      then extract(epoch from (coalesce(t.clock_out, now()) - t.clock_in)) / 3600.0
      else 0 end
  )::numeric, 2) as lunch_hours,
  min(t.clock_in) filter (where t.kind = 'work') as first_in,
  max(t.clock_out) filter (where t.kind = 'work') as last_out,
  count(*) filter (where t.clock_out is null) > 0 as on_the_clock
from public.time_entries t
group by t.employee_id, t.work_date;

comment on view public.office_time_days is
  'One row per person per day: hours paid, lunch taken, first in and last out. '
  'A stretch still open counts up to right now, so the screen can show today '
  'filling in as it happens.';

create or replace view public.office_time_weeks
with (security_invoker = true) as
select
  d.employee_id,
  p.full_name,
  p.pay_rate,
  p.qb_employee_id,
  d.week_start,
  (d.week_start + 6) as week_end,
  round(sum(d.hours), 2) as hours,
  round(sum(d.lunch_hours), 2) as lunch_hours,
  -- Overtime in Texas is federal: over forty in the workweek, at one and a
  -- half. Not over eight in a day -- a nine-hour Tuesday and a seven-hour
  -- Wednesday is a forty-hour week and no overtime in it.
  least(round(sum(d.hours), 2), 40) as regular_hours,
  greatest(round(sum(d.hours), 2) - 40, 0) as overtime_hours,
  round(least(round(sum(d.hours), 2), 40) * p.pay_rate, 2) as regular_pay,
  round(greatest(round(sum(d.hours), 2) - 40, 0) * p.pay_rate * 1.5, 2) as overtime_pay,
  round(least(round(sum(d.hours), 2), 40) * p.pay_rate
      + greatest(round(sum(d.hours), 2) - 40, 0) * p.pay_rate * 1.5, 2) as gross_pay,
  bool_or(d.on_the_clock) as on_the_clock,
  count(*) as days_worked
from public.office_time_days d
join public.profiles p on p.id = d.employee_id
group by d.employee_id, p.full_name, p.pay_rate, p.qb_employee_id, d.week_start;

comment on view public.office_time_weeks is
  'The week as payroll needs it: regular hours, overtime hours over forty at '
  'time and a half, and what that comes to at this person''s rate. These are '
  'the two numbers typed into the QuickBooks payroll run.';

grant select on public.office_time_days to authenticated;
grant select on public.office_time_weeks to authenticated;
