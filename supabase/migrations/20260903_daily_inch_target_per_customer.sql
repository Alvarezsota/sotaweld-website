-- A day's expected production, per customer.
--
-- Rocking Double S expects 180 inches a day out of a welder, BT Constructors
-- expects 220. The welder is told where he stands as he logs, so a short day is
-- a conversation on the day rather than a surprise a week later.
--
-- Keyed on the QuickBooks customer, not the job, for the same reason the weld
-- log is: Rocking Double S has twenty jobs and a target set twenty times would
-- drift the first time one of them was edited.
--
-- Safe to re-run.

create table if not exists public.customer_weld_targets (
  qb_customer_id     text primary key,
  qb_customer_name   text,
  min_inches_per_day numeric not null check (min_inches_per_day > 0),
  baseline_hours     numeric not null default 10 check (baseline_hours > 0),
  updated_at         timestamptz not null default now()
);

-- Added after the table existed, so an older database gets it too.
alter table public.customer_weld_targets
  add column if not exists baseline_hours numeric not null default 10
    check (baseline_hours > 0);

comment on table public.customer_weld_targets is
  'Inches a welder is expected to turn in per day for this customer. Shown to the welder as he logs, as a warning only - it never stops him submitting what he actually did.';

comment on column public.customer_weld_targets.min_inches_per_day is
  'Inches expected across baseline_hours worth of work. Scaled by the hours actually on the time ticket before a welder is measured against it.';

comment on column public.customer_weld_targets.baseline_hours is
  'The length of day min_inches_per_day was quoted for. 180 inches over 10 hours is 18 an hour, so a 12 hour day asks 216.';

insert into public.customer_weld_targets (qb_customer_id, qb_customer_name, min_inches_per_day)
values ('8',   'ROCKING DOUBLE S LLC', 180),
       ('195', 'BT Constructors',      220)
on conflict (qb_customer_id) do update
  set min_inches_per_day = excluded.min_inches_per_day,
      qb_customer_name   = excluded.qb_customer_name,
      updated_at         = now();

alter table public.customer_weld_targets enable row level security;

-- Every welder reads it, because the warning is drawn in his browser.
drop policy if exists customer_weld_targets_read on public.customer_weld_targets;
create policy customer_weld_targets_read on public.customer_weld_targets
  for select to authenticated using (true);

-- Only an admin sets the number.
drop policy if exists customer_weld_targets_write on public.customer_weld_targets;
create policy customer_weld_targets_write on public.customer_weld_targets
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

grant select on public.customer_weld_targets to authenticated;
grant insert, update, delete on public.customer_weld_targets to authenticated;

notify pgrst, 'reload schema';
