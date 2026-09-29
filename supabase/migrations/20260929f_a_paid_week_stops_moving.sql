-- A paid week stops moving.
--
-- Her hours reach QuickBooks through a person: Gilbert reads the two numbers
-- off the clock and types them into the payroll run. There is no API that puts
-- time into a QuickBooks payroll run, so there is no link to break -- but there
-- is also nothing holding the two together once he has typed them.
--
-- And she can still reach back. Posting a day she already worked is bounded to
-- this week and last, which is what let her catch up when the clock started. It
-- also means that on the Monday after payday she could add a day into the week
-- that was paid on Friday. Nothing would look wrong. The cheque would simply
-- stop agreeing with the clock, and the first anyone would know is a number
-- that does not reconcile weeks later.
--
-- So a week gets marked paid, once, by the man who paid it, and after that it
-- is history to everybody but him. He can still fix anything -- a correction
-- after payday is real and it happens -- and the next run is where it lands.
--
-- Deliberately not automatic. Nothing here knows when a payroll run was
-- submitted; only Gilbert knows that, because only Gilbert did it. A lock that
-- guessed would either free a week he had paid or freeze one he had not.

create table if not exists public.office_week_locks (
  employee_id uuid not null references public.profiles(id) on delete cascade,
  week_start date not null,
  locked_at timestamptz not null default now(),
  locked_by uuid references public.profiles(id),
  primary key (employee_id, week_start),
  -- Mondays only. A lock on a Wednesday would cover half of two weeks and
  -- neither of them would be the week anybody was looking at.
  constraint office_week_locks_monday check (extract(isodow from week_start) = 1)
);

comment on table public.office_week_locks is
  'A week that has been paid. The person it belongs to can no longer add to it, '
  'change it or delete from it; an admin still can, because a correction after '
  'payday is a real thing that happens.';

alter table public.office_week_locks enable row level security;

drop policy if exists office_week_locks_select on public.office_week_locks;
create policy office_week_locks_select on public.office_week_locks
  for select to authenticated
  using (employee_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists office_week_locks_admin on public.office_week_locks;
create policy office_week_locks_admin on public.office_week_locks
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

grant select on public.office_week_locks to authenticated;
grant insert, delete on public.office_week_locks to authenticated;

create or replace function public.office_week_is_paid(p_employee uuid, p_at timestamptz)
returns boolean
language sql stable
set search_path to 'public'
as $$
  select exists (
    select 1 from office_week_locks l
    where l.employee_id = p_employee
      and l.week_start = date_trunc('week', (p_at at time zone 'America/Chicago')::date)::date
  );
$$;

-- Enforced on the table, not in the page. The page is one way in; the API is
-- another, and a rule that only the page knows is not a rule.
--
-- auth.uid() null means this is not a signed-in person -- the service role, a
-- cron job, a migration. Those are not who this is protecting the week from,
-- and stopping them would break maintenance that has nothing to do with her.
create or replace function public.time_entry_week_not_paid()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  paid_week date;
begin
  if auth.uid() is null or public.is_admin(auth.uid()) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- Both ends of a change. Moving a punch OUT of a paid week alters that week
  -- just as surely as moving one in, and only checking the new side would let
  -- a paid day be dragged into an open week and disappear from the cheque.
  if tg_op in ('INSERT', 'UPDATE')
     and office_week_is_paid(new.employee_id, new.clock_in) then
    paid_week := date_trunc('week', (new.clock_in at time zone 'America/Chicago')::date)::date;
  elsif tg_op in ('UPDATE', 'DELETE')
     and office_week_is_paid(old.employee_id, old.clock_in) then
    paid_week := date_trunc('week', (old.clock_in at time zone 'America/Chicago')::date)::date;
  end if;

  if paid_week is not null then
    raise exception 'The week of % has already been paid. Call the office if something on it is wrong.',
      to_char(paid_week, 'FMMon FMDD')
      using errcode = 'check_violation';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists time_entries_week_not_paid on public.time_entries;
create trigger time_entries_week_not_paid
  before insert or update or delete on public.time_entries
  for each row execute function public.time_entry_week_not_paid();
