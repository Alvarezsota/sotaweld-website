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

create or replace function public.crew_week_inches(p_week_start date)
returns table (
  welder_id   uuid,
  welder_name text,
  report_date date,
  inches      numeric
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select wr.welder_id,
         coalesce(p.full_name, 'Unknown welder') as welder_name,
         wr.report_date,
         sum(wr.total_inches)::numeric as inches
    from weld_reports wr
    left join profiles p on p.id = wr.welder_id
   where wr.report_date >= p_week_start
     and wr.report_date <  p_week_start + 7
   group by wr.welder_id, p.full_name, wr.report_date
$$;

-- Anybody signed in. That is the point of it.
revoke all on function public.crew_week_inches(date) from public;
grant execute on function public.crew_week_inches(date) to authenticated;

comment on function public.crew_week_inches(date) is
  'Welder names and weld inches for the week starting p_week_start. Read only, and deliberately carries nothing but the name and the number - the crew board is built on this.';

notify pgrst, 'reload schema';
