-- One tap is one punch.
--
-- Going to lunch is two writes: close the stretch that is running, open a lunch
-- stretch. Coming back is two more. Done from the page that is two requests
-- with a gap in the middle, and the gap is where the damage lives -- a phone
-- that loses signal between them leaves the day with nothing open and no lunch
-- row, which reads as "went home at 12:07" and quietly pays four hours short.
--
-- It also puts the time on the clock that is nearest to hand, which is the
-- phone's. A phone whose clock is twenty minutes out writes a day twenty
-- minutes wrong, and nobody finds out until the week is short.
--
-- So the page does not write times. It says what happened -- in, lunch, back,
-- out -- and this decides, in one transaction, with the database's own clock.
--
-- security invoker, so it is not a way round row-level security: Alexis
-- punching herself passes her own policies, an admin punching on her behalf
-- passes the admin policy, and nobody else can do either.

create or replace function public.office_punch(
  p_action text,
  p_employee uuid default null
)
returns table (
  state text,
  entry_id uuid,
  since timestamptz
)
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  who uuid := coalesce(p_employee, auth.uid());
  open_row public.time_entries%rowtype;
  made uuid;
begin
  if who is null then
    raise exception 'Not signed in.' using errcode = 'insufficient_privilege';
  end if;

  select * into open_row
  from public.time_entries
  where employee_id = who and clock_out is null
  -- Two taps landing together would otherwise both see the same open row and
  -- both try to close it. The second waits here and then finds it already shut.
  for update;

  if p_action = 'in' then
    if open_row.id is not null then
      raise exception 'Already on the clock since %.',
        to_char(open_row.clock_in at time zone 'America/Chicago', 'HH12:MI AM')
        using errcode = 'check_violation';
    end if;
    insert into public.time_entries (employee_id, kind, clock_in)
    values (who, 'work', now()) returning id into made;

  elsif p_action = 'lunch' then
    if open_row.id is null or open_row.kind <> 'work' then
      raise exception 'You have to be on the clock to go to lunch.'
        using errcode = 'check_violation';
    end if;
    update public.time_entries set clock_out = now() where id = open_row.id;
    insert into public.time_entries (employee_id, kind, clock_in)
    values (who, 'lunch', now()) returning id into made;

  elsif p_action = 'back' then
    if open_row.id is null or open_row.kind <> 'lunch' then
      raise exception 'You are not at lunch.' using errcode = 'check_violation';
    end if;
    update public.time_entries set clock_out = now() where id = open_row.id;
    insert into public.time_entries (employee_id, kind, clock_in)
    values (who, 'work', now()) returning id into made;

  elsif p_action = 'out' then
    if open_row.id is null then
      raise exception 'You are not on the clock.' using errcode = 'check_violation';
    end if;
    -- Clocking out straight from lunch closes the lunch and nothing else. The
    -- day ends where the last work stretch ended, which is what happened.
    update public.time_entries set clock_out = now() where id = open_row.id;

  else
    raise exception 'Unknown action %.', p_action using errcode = 'check_violation';
  end if;

  -- Hand back the state the page should now be showing, rather than leaving it
  -- to ask again and draw whatever a second round trip happens to find.
  select * into open_row
  from public.time_entries
  where employee_id = who and clock_out is null;

  state := coalesce(open_row.kind, 'out');
  entry_id := coalesce(open_row.id, made);
  since := open_row.clock_in;
  return next;
end;
$$;

comment on function public.office_punch(text, uuid) is
  'The only way the clock is written from the page. One action in -- in, lunch, '
  'back, out -- one transaction out, timed by the database rather than by '
  'whatever clock the phone happens to be keeping.';

grant execute on function public.office_punch(text, uuid) to authenticated;
