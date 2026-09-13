-- A finished job comes off the list without being thrown away.
--
-- Jobs and helpers already had `active`, and the pickers on Log Work and the
-- weld report already read only the live ones. What was missing was the other
-- half of the promise: somewhere to SEE what has been put away, and a way to
-- bring it back. A toggle that dims a row in a list of thirty-eight is not a
-- folder, and nobody trusts a switch they cannot undo.
--
-- Welders had nothing at all. The only way to take a man off the crew board
-- was a hand-written update, which is how hide_from_crew_board got set for one
-- person and never used again.
--
-- So: profiles gets the same `active` every other list has, and all three get
-- archived_at, which is the one thing the folder needs that a boolean cannot
-- say -- when. It is maintained by trigger rather than by hand, so there is
-- one truth and not two that can disagree.
--
-- Nothing here hides history. Archiving is about what shows in a PICKER. The
-- views that price the work -- v_work_lines, v_week_job_invoice and the rest --
-- have never filtered on active and still do not, so a week already worked
-- still bills whether or not the job is put away afterwards.

-- ---------------------------------------------------------------- profiles --

alter table public.profiles
  add column if not exists active boolean not null default true;

-- ------------------------------------------------------- when it went away --

alter table public.jobs     add column if not exists archived_at timestamptz;
alter table public.helpers  add column if not exists archived_at timestamptz;
alter table public.profiles add column if not exists archived_at timestamptz;

create or replace function public.tg_stamp_archived_at()
returns trigger
language plpgsql
as $fn$
begin
  -- Derived from `active`, never set directly, so the two cannot drift. A row
  -- that goes away twice keeps the date it first went away; bringing it back
  -- clears the date, because a job that is live has no archived date.
  if new.active is false and coalesce(old.active, true) is true then
    new.archived_at := now();
  elsif new.active is true then
    new.archived_at := null;
  end if;
  return new;
end
$fn$;

drop trigger if exists jobs_stamp_archived_at on public.jobs;
create trigger jobs_stamp_archived_at
  before insert or update of active on public.jobs
  for each row execute function public.tg_stamp_archived_at();

drop trigger if exists helpers_stamp_archived_at on public.helpers;
create trigger helpers_stamp_archived_at
  before insert or update of active on public.helpers
  for each row execute function public.tg_stamp_archived_at();

drop trigger if exists profiles_stamp_archived_at on public.profiles;
create trigger profiles_stamp_archived_at
  before insert or update of active on public.profiles
  for each row execute function public.tg_stamp_archived_at();

-- Rows already switched off before this migration have no date. Say so with
-- the moment we noticed rather than inventing one that looks precise.
update public.jobs    set archived_at = now() where active is false and archived_at is null;
update public.helpers set archived_at = now() where active is false and archived_at is null;

-- ----------------------------------------------------------------- the view --

-- welders_public is what a welder is allowed to see of the crew: a name and an
-- id, never a pay rate. It gains `active` for the same reason helpers_public
-- has it -- the picker needs to know who is still here, and the week panel
-- needs to name somebody who is not.
create or replace view public.welders_public as
  select id, full_name, active
    from public.profiles;
