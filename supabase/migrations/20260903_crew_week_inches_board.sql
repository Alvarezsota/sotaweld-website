-- The crew's inches for a week, so a man can see where he sits.
--
-- weld_reports is readable only by the welder who filed it, and that is right -
-- a report carries the job, the customer and what was welded for them. None of
-- that belongs to the man at the next station.
--
-- What does is the number. So this returns names and inches and nothing else:
-- no job, no customer, no rate, no hours, no money. A welder can see he is
-- behind without being handed the book.
--
-- security definer because it has to read past the row policy to do that, and
-- it is written so that reading past it can only ever yield those two columns.
--
-- Safe to re-run.

-- The signature gained a column, so the old one has to go first.
drop function if exists public.crew_week_inches(date);

create or replace function public.crew_week_inches(p_week_start date)
returns table (
  welder_id   uuid,
  welder_name text,
  report_date date,
  inches      numeric,
  hours       numeric
)
language sql
stable
security definer
set search_path to 'public'
as $$
  -- Inches alone do not compare two men: a welder on eight hours reads lower
  -- than one on twelve even when he outworked him. So the hours come too, and
  -- the board divides. Both sides are summed on their own before they meet,
  -- because a man can have several reports and several tickets in a day and
  -- joining them raw would multiply one by the other.
  with inches as (
    select wr.welder_id, wr.report_date, sum(wr.total_inches)::numeric as inches
      from weld_reports wr
     where wr.report_date >= p_week_start
       and wr.report_date <  p_week_start + 7
     group by wr.welder_id, wr.report_date
  ),
  hours as (
    select de.welder_id, de.entry_date, sum(de.hours)::numeric as hours
      from daily_entries de
     where de.entry_date >= p_week_start
       and de.entry_date <  p_week_start + 7
     group by de.welder_id, de.entry_date
  )
  select i.welder_id,
         coalesce(p.full_name, 'Unknown welder') as welder_name,
         i.report_date,
         i.inches,
         h.hours
    from inches i
    left join hours h
      on h.welder_id = i.welder_id
     and h.entry_date = i.report_date
    left join profiles p on p.id = i.welder_id
$$;

-- Anybody signed in. That is the point of it.
revoke all on function public.crew_week_inches(date) from public;
grant execute on function public.crew_week_inches(date) to authenticated;

comment on function public.crew_week_inches(date) is
  'Welder names, weld inches and ticket hours for the week starting p_week_start. Read only, and deliberately carries nothing else - no job, no customer, no rate, no money. The crew board is built on this.';

notify pgrst, 'reload schema';
