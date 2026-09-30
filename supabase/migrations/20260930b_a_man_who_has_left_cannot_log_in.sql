-- A man who has left cannot log in.
--
-- Archiving took a man out of the pickers and off the crew board and did
-- nothing else. His account still worked. Jose Franco was archived by mistake
-- on 15 September and carried on filing tickets and weld reports for two weeks
-- without anything stopping him -- which is how we found out, and which is the
-- benign version. The other version is a man who has actually left still
-- holding a working login to the company's job list, rates and weld history.
--
-- Three layers, because each one covers what the others cannot.
--
--   1. The account is banned in auth when he is archived. That is the real
--      lock: no new session, and no refresh of an old one. It lives in the
--      admin-set-active function, which holds the service role.
--
--   2. Every page signs an archived man straight back out. That is manners
--      rather than security -- it means he sees "your access has been turned
--      off, call the office" instead of a screen that half works.
--
--   3. This file: the database refuses his writes. A signed-in session stays
--      valid until its token expires, so between being archived and his token
--      running out there is a window where layer 1 has not bitten yet. This
--      closes it, and it is also the layer that does not care what the page is
--      running or whether the ban call succeeded.

create or replace function public.is_active_person(p_id uuid)
returns boolean
language sql stable
security definer
set search_path to 'public'
as $$
  select coalesce((select active from profiles where id = p_id), false);
$$;

comment on function public.is_active_person(uuid) is
  'Is this person still on the books. security definer so a welder can be '
  'judged by it without being able to read anybody''s profile row.';

-- One function, three tables. Each of them is a thing a man who has left has
-- no business writing: hours that will be billed, welds that go on a
-- customer's report, time on a clock.
create or replace function public.writer_must_be_active()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  -- No signed-in person behind it means cron, the service role or a migration.
  -- Those are not who this is for.
  if auth.uid() is null or public.is_active_person(auth.uid()) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  raise exception
    'Your access has been turned off. Call the office on (432) 248-1455.'
    using errcode = 'insufficient_privilege';
end;
$$;

-- Named "access_check" on purpose. Postgres fires BEFORE triggers in
-- alphabetical order, and this has to go first: a man who has left, filing a
-- weld report for a day with no hours on it, should be told his access is off,
-- not told to go and log his hours. Named "writer_active" it sorted after
-- weld_reports_need_a_ticket and he got the wrong answer.
drop trigger if exists daily_entries_writer_active on public.daily_entries;
drop trigger if exists daily_entries_access_check on public.daily_entries;
create trigger daily_entries_access_check
  before insert or update or delete on public.daily_entries
  for each row execute function public.writer_must_be_active();

drop trigger if exists weld_reports_writer_active on public.weld_reports;
drop trigger if exists weld_reports_access_check on public.weld_reports;
create trigger weld_reports_access_check
  before insert or update or delete on public.weld_reports
  for each row execute function public.writer_must_be_active();

drop trigger if exists time_entries_writer_active on public.time_entries;
drop trigger if exists time_entries_access_check on public.time_entries;
create trigger time_entries_access_check
  before insert or update or delete on public.time_entries
  for each row execute function public.writer_must_be_active();

grant execute on function public.is_active_person(uuid) to authenticated;
