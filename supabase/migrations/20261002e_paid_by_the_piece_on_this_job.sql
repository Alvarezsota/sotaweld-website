-- Money out that never came through a logged day.
--
-- "I need his hourly rate to be set because sometimes he's going to work by the
-- hour, but for this job, he's getting paid by the piece. That's the fucking
-- difference."
--
-- That is the whole design. How a man is paid is a fact about the JOB, not
-- about the man. Armando Chavez carries $50/hr on his profile like everybody
-- else and works to it wherever he is on the clock; on P66 Viper platforms and
-- stairs he built three platforms at $1,300 and three sets of stairs at $350,
-- and that $4,950 comes off the bid. Nothing on his profile changes, there is
-- no pay mode to switch him in and out of, and the portal never asks anybody to
-- choose between "price per piece" and "hourly" -- which is what he had already
-- rejected three times.
--
-- The same list carries material, because that was the other half of the ask:
-- "some of that stuff is definitely going to be material purchased. Not on all
-- jobs, but I need it to be an option because on some jobs I do buy the
-- material." jobs.material_counts decides whether the Setup page offers the
-- material side at all. It deliberately does NOT decide whether a row counts --
-- every row in this list counts, because a cost that was entered and then
-- quietly left out of the total is worse than one that was never entered.
--
-- Admin only. What the company pays for steel, and what it pays a man, is
-- nobody else's business.

alter table jobs add column if not exists material_counts boolean not null default false;

create table if not exists job_materials (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references jobs(id) on delete cascade,
  bought_on   date not null default (now() at time zone 'America/Chicago')::date,
  kind        text not null default 'material',
  paid_to     text,
  description text not null default '',
  vendor      text,
  qty         numeric(12,2) not null default 1,
  unit_price  numeric(12,2),
  amount      numeric(12,2) not null default 0,
  note        text,
  created_by  uuid references profiles(id) default auth.uid(),
  created_at  timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'job_materials_kind_ck') then
    alter table job_materials add constraint job_materials_kind_ck
      check (kind in ('material', 'labour', 'other'));
  end if;
end $$;

create index if not exists job_materials_by_job on job_materials (job_id, bought_on desc);
alter table job_materials enable row level security;

drop policy if exists job_materials_admin on job_materials;
create policy job_materials_admin on job_materials
  for all to authenticated
  using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

-- job_burn supersedes job_spend: same burn, plus the ledger split into steel
-- and men. A new name rather than a replacement because changing a function's
-- OUT columns needs a DROP, and DROP does not complete over this connection.
-- The body is in 20261002d_a_price_is_a_price.sql with the ledger folded in;
-- see the function itself for the current text.
