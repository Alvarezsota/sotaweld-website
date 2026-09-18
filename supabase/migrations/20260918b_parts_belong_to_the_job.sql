-- Parts belonged to a welder's daily ticket, which is the wrong owner.
--
-- Skid blinds cut in the shop for the P66 Viper job are not part of anybody's
-- day. Hanging them on Damian Silva's Thursday entry made the Approvals screen
-- read as though they were his, sitting under his name beside his twelve hours.
-- His hours were never touched and the money was always right, but the ticket
-- said something untrue about who did what, and a ticket that lies is no use
-- for checking a week against.
--
-- Parts now belong to the job and the week, which is what they actually are:
-- material that went to a site, billed on that site's invoice.
--
-- daily_entry_parts stays exactly as it is. It is how a flat-rate ticket prices
-- itself and a welder can still add to his own; the view reads both. This adds
-- a second source rather than moving the old one.
--
-- Applied against the live database in two parts, both already in place:
--   parts_belong_to_the_job_not_to_a_mans_ticket  - the table and the view
--   week_invoice_reads_job_parts_too              - the payload and the move
-- Written here as one file so the repo carries what the database has.

create table if not exists public.job_week_parts (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.jobs(id) on delete cascade,
  week_start  date not null,
  description text not null,
  quantity    numeric not null default 1,
  rate        numeric not null default 0,
  qb_item_id  text,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id)
);

comment on table public.job_week_parts is
  'Material and parts billed to a job for a week, owned by the job rather than '
  'by anybody''s daily ticket. Rolls into v_week_job_parts beside the ticket '
  'parts and onto the week invoice as its own lines.';
comment on column public.job_week_parts.qb_item_id is
  'QuickBooks item this part bills under. Null falls back to Material (23).';

create index if not exists job_week_parts_job_week
  on public.job_week_parts (job_id, week_start);

alter table public.job_week_parts enable row level security;

-- An invoice line carries a customer's price, so this is the office's to read
-- and the office's to write -- the same rule parts_invoices follows. A welder
-- adding material to his own ticket is a different thing and still works.
drop policy if exists job_week_parts_admin_all on public.job_week_parts;
create policy job_week_parts_admin_all on public.job_week_parts
  for all using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- Both sources, summed to the shape the week invoice already reads.
create or replace view public.v_week_job_parts as
  select week_start, job_id, sum(parts_amount) as parts_amount
  from (
    select public.week_start_of(de.entry_date) as week_start,
           coalesce(de.for_job_id, de.job_id)  as job_id,
           sum(dep.quantity * dep.rate)        as parts_amount
      from public.daily_entry_parts dep
      join public.daily_entries de on de.id = dep.daily_entry_id
     group by 1, 2
    union all
    select jwp.week_start, jwp.job_id, sum(jwp.quantity * jwp.rate)
      from public.job_week_parts jwp
     group by 1, 2
  ) both_sources
  group by week_start, job_id;

-- qb_invoice_payload's parts loop reads both sources. Patched in place against
-- the live definition rather than retyped -- it is two hundred lines that price
-- every invoice this company sends, and reproducing it by hand to change six of
-- them is how a digit goes missing.
do $mig$
declare
  src    text;
  newsrc text;
  old_q constant text := $c$    select dep.description                                as description,
           sum(dep.quantity)                              as quantity,
           dep.rate                                       as rate,
           coalesce(dep.qb_item_id, '23')                 as item_id,
           round(sum(dep.quantity * dep.rate), 2)         as amount
      from daily_entry_parts dep
      join daily_entries de on de.id = dep.daily_entry_id
     where week_start_of(de.entry_date) = v.week_start
       and coalesce(de.for_job_id, de.job_id) = v.job_id
     group by dep.description, dep.rate, coalesce(dep.qb_item_id, '23')
     order by dep.description$c$;
  new_q constant text := $d$    select s.description                                  as description,
           sum(s.quantity)                                as quantity,
           s.rate                                         as rate,
           s.item_id                                      as item_id,
           round(sum(s.quantity * s.rate), 2)             as amount
      from (
        -- Material added to the job for the week. Owned by the job, not by
        -- anybody's ticket, which is what a shop-cut blind actually is.
        select jwp.description, jwp.quantity, jwp.rate,
               coalesce(jwp.qb_item_id, '23') as item_id, jwp.sort_order
          from job_week_parts jwp
         where jwp.week_start = v.week_start
           and jwp.job_id = v.job_id
        union all
        -- Material a welder put on his own ticket, which is how a flat-rate
        -- day prices itself.
        select dep.description, dep.quantity, dep.rate,
               coalesce(dep.qb_item_id, '23') as item_id, 0
          from daily_entry_parts dep
          join daily_entries de on de.id = dep.daily_entry_id
         where week_start_of(de.entry_date) = v.week_start
           and coalesce(de.for_job_id, de.job_id) = v.job_id
      ) s
     group by s.description, s.rate, s.item_id
     order by min(s.sort_order), s.description$d$;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'qb_invoice_payload';
  if src is null then raise exception 'qb_invoice_payload not found'; end if;
  if position(old_q in src) = 0 then raise exception 'parts query anchor not found'; end if;

  newsrc := replace(src, old_q, new_q);
  if newsrc = src then raise exception 'nothing changed'; end if;
  if position('job_week_parts' in newsrc) = 0 then
    raise exception 'the new source did not land';
  end if;

  execute newsrc;
end
$mig$;
