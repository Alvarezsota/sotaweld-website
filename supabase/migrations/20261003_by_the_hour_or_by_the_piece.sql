-- By the hour, or by the piece -- chosen on the day.
--
-- "If they're working by the day, give them an option to work by the hour. If
-- they're working contract by the piece, give them the option to click by the
-- piece... There are going to be days they're going to work and build the
-- fucking platform, and it's going to take them 2 days. On the second day, when
-- they finish, they should be able to put on their by-piece, and then they can
-- log the platform that they built and the price that I gave them."
--
-- And: "But never log hours with the fucking part that they built."
--
-- So it is a choice on the TICKET, not a mode on the man and not a flag on the
-- job. Armando keeps $50/hr on his profile and works to it most weeks; the
-- morning he finishes a platform he taps By the piece and types what he built
-- and the price he was given. Nothing has to be set up in advance -- which is
-- what was wrong with the version built before this one, where a price had to
-- exist as a job_bid_item and the office credited men against it. That is gone.
--
-- The two never share a day, enforced in the database rather than on the page,
-- because a rule only the page knows is not a rule: a cached script on a phone
-- walks round it, and a ticket the office corrects never goes through the page.

create table if not exists daily_entry_pieces (
  id             uuid primary key default gen_random_uuid(),
  daily_entry_id uuid not null references daily_entries(id) on delete cascade,
  description    text not null default '',
  qty            numeric(12,2) not null default 1,
  unit_price     numeric(12,2) not null default 0,
  amount         numeric(12,2) generated always as (round(qty * unit_price, 2)) stored,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now()
);

create index if not exists daily_entry_pieces_by_entry
  on daily_entry_pieces (daily_entry_id, sort_order);

alter table daily_entry_pieces enable row level security;

-- A man's pieces are his ticket's: same reach as the ticket itself.
drop policy if exists daily_entry_pieces_select on daily_entry_pieces;
create policy daily_entry_pieces_select on daily_entry_pieces
  for select to authenticated
  using (exists (select 1 from daily_entries d
                 where d.id = daily_entry_pieces.daily_entry_id
                   and (d.welder_id = auth.uid() or d.supervisor_id = auth.uid()
                        or is_admin(auth.uid()))));

drop policy if exists daily_entry_pieces_write on daily_entry_pieces;
create policy daily_entry_pieces_write on daily_entry_pieces
  for all to authenticated
  using (exists (select 1 from daily_entries d
                 where d.id = daily_entry_pieces.daily_entry_id
                   and (d.welder_id = auth.uid()
                        or (d.welder_id is null and d.supervisor_id = auth.uid())
                        or is_admin(auth.uid()))))
  with check (exists (select 1 from daily_entries d
                 where d.id = daily_entry_pieces.daily_entry_id
                   and (d.welder_id = auth.uid()
                        or (d.welder_id is null and d.supervisor_id = auth.uid())
                        or is_admin(auth.uid()))));

-- Hours or pieces, never both -- guarded from each side.
create or replace function public.day_is_hours_or_pieces()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_entry uuid; v_mode text; v_hours numeric;
begin
  v_entry := coalesce(new.daily_entry_id, old.daily_entry_id);
  select d.pay_mode, d.hours into v_mode, v_hours from daily_entries d where d.id = v_entry;
  if v_mode is distinct from 'piece' then
    raise exception 'That day is logged by the hour. Switch it to by the piece before adding what was built.'
      using errcode = 'check_violation';
  end if;
  if coalesce(v_hours, 0) <> 0 then
    raise exception 'A day is paid by the hour or by the piece, never both. That day has % hours on it.', v_hours
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end; $$;

create or replace function public.pay_mode_is_one_or_the_other()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare n_pieces int;
begin
  if coalesce(new.pay_mode, 'hourly') = 'piece' then
    if coalesce(new.hours, 0) <> 0 then
      raise exception 'A day is paid by the hour or by the piece, never both. Clear the hours, or put the day back on hourly.'
        using errcode = 'check_violation';
    end if;
  else
    select count(*) into n_pieces from daily_entry_pieces where daily_entry_id = new.id;
    if n_pieces > 0 then
      raise exception 'That day has % line(s) of work built on it. Take those off before putting it back on hourly.', n_pieces
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end; $$;

-- (the two triggers themselves were created separately; DROP TRIGGER does not
--  complete over the MCP connection, so they are not re-dropped here)
--   create trigger pieces_need_a_piece_day     before insert or update on daily_entry_pieces ...
--   create trigger daily_entries_pay_mode_check before insert or update on daily_entries ...

/* The weekly piece figure, repointed off the day instead of the old
   bid_piece_credits/job_bid_items pair. The SHAPE is unchanged, so
   v_week_welder_summary, v_week_helper_summary and the pay statements pick it
   up with no edit of their own -- they were already plumbed for piece pay from
   the earlier attempt, they were simply reading the wrong source. */
create or replace view v_week_piece_pay as
select
  week_start_of(de.entry_date)                                     as week_start,
  case when p.bills_as_helper_id is not null then 'helper' else 'welder' end as person_kind,
  coalesce(p.bills_as_helper_id, p.id)                             as person_id,
  coalesce(de.for_job_id, de.job_id)                               as job_id,
  round(sum(dep.amount), 2)                                        as piece_paid,
  sum(dep.qty)                                                     as pieces
from daily_entry_pieces dep
join daily_entries de on de.id = dep.daily_entry_id
join profiles p       on p.id = de.welder_id
group by 1, 2, 3, 4;

-- week_person_detail and job_burn were updated in place to match; see the
-- functions themselves for their current text.
