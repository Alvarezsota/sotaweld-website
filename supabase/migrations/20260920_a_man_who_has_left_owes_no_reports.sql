-- A man who has been put away cannot owe you a weld report.
--
-- Seven welders were archived on 16 September. Every one of them kept showing
-- as outstanding -- missing his report, missing his hours -- every night since,
-- because all three of these functions ask profiles for role = 'employee' and
-- reminders_enabled and never once ask whether he still works here.
--
-- Worse than a list: supabase/functions/daily-reminder reads profiles the same
-- way and emailed them. reminder_log has the receipts -- Elias Robles, Homero
-- Montoya, Manuel Elguezabal, Mark Ronquillo and Tulio Floriano were each sent
-- "You still owe your weld report and your hours" on the 16th, 17th, 18th and
-- 19th, days after they left. Jose Franco got the 16th and 17th. That function
-- is fixed alongside this (version 15) with the same test: still here.
--
-- The archive feature gave profiles an `active` column in September and none of
-- this was taught to read it. That is the whole fault.
--
-- Two different rules, because these answer two different questions:
--
--   missing_weld_reports is a list of debts. A man who has left owes nothing,
--   so he is simply not on it.
--
--   crew_day_status and weld_report_status are the state of a day. A man who
--   filed something that day belongs in it whether or not he is still on the
--   crew -- that is history, and hiding it would be a lie about what happened.
--   He drops off only when there is nothing of his to show, which is exactly
--   the outstanding row that should never have been there.
--
-- crew_week_inches is deliberately left alone. It is driven off weld_reports
-- rows rather than off the roster, so an archived man appears there only for
-- weeks he actually filed, which is history and not a debt. It already honours
-- hide_from_crew_board.

create or replace function public.missing_weld_reports(p_date date)
returns table(welder_id uuid, full_name text)
language sql stable security definer
set search_path to 'public'
as $function$
  select p.id, p.full_name
  from profiles p
  where p.role = 'employee'
    and coalesce(p.active, true)
    and coalesce(p.submits_weld_report, false)
    and coalesce(p.reminders_enabled, false)
    and not exists (select 1 from weld_reports w
                    where w.welder_id = p.id
                      and w.report_date = p_date)
  order by p.full_name;
$function$;

create or replace function public.weld_report_status(p_date date)
returns table(full_name text, filed boolean, total_inches numeric)
language sql stable security definer
set search_path to 'public'
as $function$
  select p.full_name, (w.id is not null), w.total_inches
  from profiles p
  left join weld_reports w
    on w.welder_id = p.id and w.report_date = p_date
  where p.role = 'employee'
    and coalesce(p.submits_weld_report, false)
    and coalesce(p.reminders_enabled, false)
    -- Still here, or gone but with something filed for this day.
    and (coalesce(p.active, true) or w.id is not null)
  order by (w.id is not null), p.full_name;
$function$;

create or replace function public.crew_day_status(p_date date)
returns table(full_name text, expects_report boolean, expects_hours boolean,
              filed_report boolean, filed_hours boolean,
              total_inches numeric, hours numeric)
language sql stable security definer
set search_path to 'public'
as $function$
  select p.full_name,
         coalesce(p.submits_weld_report, false),
         coalesce(p.submits_time, false),
         exists (select 1 from weld_reports w
                 where w.welder_id = p.id and w.report_date = p_date),
         exists (select 1 from daily_entries d
                 where d.welder_id = p.id and d.entry_date = p_date),
         (select round(sum(w.total_inches), 2) from weld_reports w
          where w.welder_id = p.id and w.report_date = p_date),
         (select round(sum(d.hours), 2) from daily_entries d
          where d.welder_id = p.id and d.entry_date = p_date)
  from profiles p
  where p.role = 'employee'
    and coalesce(p.reminders_enabled, false)
    and (coalesce(p.submits_weld_report, false) or coalesce(p.submits_time, false))
    -- Still here, or gone but with a report or a ticket on this day.
    and (coalesce(p.active, true)
         or exists (select 1 from weld_reports w
                    where w.welder_id = p.id and w.report_date = p_date)
         or exists (select 1 from daily_entries d
                    where d.welder_id = p.id and d.entry_date = p_date))
  order by p.full_name;
$function$;
