-- A day she already worked.
--
-- The clock starts today, and the week it starts in is half over. Alexis has
-- worked days that no button was there to catch, and payroll runs Friday
-- regardless. So there is a way to post a day after the fact -- once, to get
-- started, and afterwards for the ordinary Tuesday somebody forgets to tap in.
--
-- WHAT KEEPS THIS HONEST
-- ---------------------------------------------------------------------------
-- A back-entry is a person typing what they say they worked, which is exactly
-- what a timeclock exists to replace. Three things hold it down:
--
--   - Two weeks and no further, for anybody who is not an admin. That is this
--     week and the one before it. Reaching back past that is reaching into a
--     week that has already been paid, and a paid week changing underneath
--     payroll is how a correction becomes a dispute. Log Work holds a welder to
--     the same line, and for the same reason.
--   - It goes through the same three guards every punch does: nothing in the
--     future, nothing overlapping a stretch already on the books, one thing
--     open at a time.
--   - The whole day lands or none of it does. Three writes from the page --
--     morning, lunch, afternoon -- can half-fail and leave a day that reads as
--     four hours worked and a lunch that never ended.
--
-- Times come in as times of day, not as timestamps. The page knows what she
-- typed; it does not know what a browser in the wrong time zone will make of
-- "8:00 on the 24th", and getting that wrong moves the hours to another day.
-- Odessa time is applied here, where it is not a guess.

create or replace function public.office_add_day(
  p_date date,
  p_in time,
  p_out time,
  p_lunch_out time default null,
  p_lunch_in time default null,
  p_employee uuid default null
)
returns table (
  work_date date,
  hours numeric
)
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  who uuid := coalesce(p_employee, auth.uid());
  zone constant text := 'America/Chicago';
  today date := (now() at time zone zone)::date;
  -- Monday of the week before this one: the earliest day anybody but an admin
  -- may post.
  floor_date date := (date_trunc('week', today)::date) - 7;
  t_in timestamptz;
  t_out timestamptz;
  t_lout timestamptz;
  t_lin timestamptz;
  stamp constant text := 'HH12:MI AM';
begin
  if who is null then
    raise exception 'Not signed in.' using errcode = 'insufficient_privilege';
  end if;
  if p_date is null or p_in is null or p_out is null then
    raise exception 'A day needs a date, a time in and a time out.'
      using errcode = 'check_violation';
  end if;
  if p_date > today then
    raise exception 'Nobody has worked %.', to_char(p_date, 'FMDay')
      using errcode = 'check_violation';
  end if;
  if p_date < floor_date and not public.is_admin(auth.uid()) then
    raise exception 'You can post this week and last week. Anything further back has to go through the office.'
      using errcode = 'check_violation';
  end if;
  if p_out <= p_in then
    raise exception 'The time out has to be after the time in.'
      using errcode = 'check_violation';
  end if;

  -- A lunch is both ends or neither. One end alone is a day with a gap in it
  -- that nobody can price.
  if (p_lunch_out is null) <> (p_lunch_in is null) then
    raise exception 'A lunch needs both a start and an end, or neither.'
      using errcode = 'check_violation';
  end if;
  if p_lunch_out is not null then
    if p_lunch_in <= p_lunch_out then
      raise exception 'Lunch has to end after it starts.' using errcode = 'check_violation';
    end if;
    if p_lunch_out < p_in or p_lunch_in > p_out then
      raise exception 'Lunch has to fall inside the day: % to %.',
        to_char(p_in, stamp), to_char(p_out, stamp)
        using errcode = 'check_violation';
    end if;
  end if;

  -- Built in Odessa time, so a day posted from a phone set to another time
  -- zone still lands on the day she means.
  t_in  := (p_date + p_in)  at time zone zone;
  t_out := (p_date + p_out) at time zone zone;

  if p_lunch_out is null then
    insert into public.time_entries (employee_id, kind, clock_in, clock_out)
    values (who, 'work', t_in, t_out);
  else
    t_lout := (p_date + p_lunch_out) at time zone zone;
    t_lin  := (p_date + p_lunch_in)  at time zone zone;
    insert into public.time_entries (employee_id, kind, clock_in, clock_out)
    values (who, 'work',  t_in,  t_lout),
           (who, 'lunch', t_lout, t_lin),
           (who, 'work',  t_lin, t_out);
  end if;

  return query
  select d.work_date, d.hours
  from public.office_time_days d
  where d.employee_id = who and d.work_date = p_date;
end;
$$;

comment on function public.office_add_day(date, time, time, time, time, uuid) is
  'Posts a day already worked, as one transaction: morning, lunch and '
  'afternoon together or not at all. Two weeks back for anybody but an admin, '
  'and through the same guards every tapped punch goes through.';

grant execute on function public.office_add_day(date, time, time, time, time, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The same two weeks, enforced on the table
-- ---------------------------------------------------------------------------
-- The function is the only route the page uses, but it is not the only route
-- there is: anybody signed in can write to time_entries directly through the
-- API. Without this, the insert policy's only rule is "it has to be your own
-- row" -- so a punch could be posted into any week that has ever been paid.

drop policy if exists time_entries_insert_own on public.time_entries;
create policy time_entries_insert_own on public.time_entries
  for insert to authenticated
  with check (
    employee_id = auth.uid()
    and clock_in >= ((date_trunc('week', (now() at time zone 'America/Chicago')::date)::date) - 7)
  );

-- Deleting a day she posted by mistake. Open punches were already hers to drop;
-- this adds the ones she has just typed, inside the same two weeks. Anything
-- older is a record of a week that has been paid, and only an admin removes it.
drop policy if exists time_entries_delete_own_open on public.time_entries;
create policy time_entries_delete_own_recent on public.time_entries
  for delete to authenticated
  using (
    employee_id = auth.uid()
    and (
      clock_out is null
      or clock_in >= ((date_trunc('week', (now() at time zone 'America/Chicago')::date)::date) - 7)
    )
  );
