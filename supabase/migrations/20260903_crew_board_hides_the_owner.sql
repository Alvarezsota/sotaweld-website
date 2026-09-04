-- The owner welds, but he does not belong on a board the crew is measured by.
-- Ranking the man who sets the target against the men held to it makes the
-- board about him instead of about them.
--
-- A flag rather than the admin role, because the two are not the same question:
-- a foreman given admin access still welds and still belongs on the board, and
-- an owner who was never made an admin would still not.
--
-- Safe to re-run.

alter table public.profiles
  add column if not exists hide_from_crew_board boolean not null default false;

comment on column public.profiles.hide_from_crew_board is
  'Kept off the crew board entirely - not listed, and not counted in its totals. For the owner, so the board stays about the crew.';

update public.profiles
   set hide_from_crew_board = true
 where full_name = 'Gilbert Alvarez';

-- The board's read gains the exclusion. Full definition in
-- 20260903_crew_week_inches_board.sql; repeated here so either file can be run
-- last and the result is the same.
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
   -- Off the board means off it completely: not a row, and not in the totals.
   where not coalesce(p.hide_from_crew_board, false)
$$;

revoke all on function public.crew_week_inches(date) from public;
grant execute on function public.crew_week_inches(date) to authenticated;

notify pgrst, 'reload schema';
