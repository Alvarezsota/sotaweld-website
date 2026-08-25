-- Invoice numbers that carry on by themselves.
--
-- The office typed 2974 on the Vaquero Antelope week and asked for the rest to
-- follow on their own. So the number now comes from a counter rather than from
-- memory, and it is handed out at the moment a week is approved -- the moment
-- the week is finished and going to be billed.
--
-- ---------------------------------------------------------------------------
-- WHY A COUNTER AND NOT max(invoice_no) + 1
-- ---------------------------------------------------------------------------
--
-- max() + 1 reads the numbers already used, which means a number that has been
-- handed out but whose week was later deleted gets handed out again, and two
-- approvals a second apart can read the same max and take the same number. A
-- duplicate invoice number is the one mistake in this whole system that the
-- customer sees. The counter is a row that is locked, read and bumped, so a
-- number leaves it exactly once whatever else is happening.
--
-- A number is never reused and never reissued: assign_invoice_no on a week that
-- already has one gives back the one it has.
--
-- ---------------------------------------------------------------------------
-- TYPING A NUMBER IN BY HAND STILL WORKS
-- ---------------------------------------------------------------------------
--
-- The field is still his. If he types a number at or above what the counter was
-- going to give out next, the counter moves past it, so the automatic ones
-- resume after his and never collide with it. Typing a lower number -- fixing a
-- typo, matching an invoice already written -- leaves the counter alone.
--
-- ---------------------------------------------------------------------------
-- QUICKBOOKS HAS THE FINAL SAY
-- ---------------------------------------------------------------------------
--
-- What is here is a proposal. It goes out as the invoice's DocNumber, and
-- whatever QuickBooks actually puts on the invoice is written back over it, so
-- the portal and the books can never quote different numbers for the same week.

create table if not exists public.invoice_counter (
  id      integer primary key default 1 check (id = 1),
  next_no integer not null,
  note    text
);

comment on table public.invoice_counter is
  'One row. next_no is the invoice number the next approved week will be given.';

-- Seeded past every number already on a week, and never below 2975, which is the
-- one after the number the office entered by hand.
insert into public.invoice_counter (id, next_no, note)
select 1,
       greatest(
         2975,
         coalesce((select max((invoice_no)::integer) + 1
                   from public.job_weeks
                   where invoice_no ~ '^[0-9]+$'), 0)
       ),
       'seeded from the highest number already used, floor 2975'
where not exists (select 1 from public.invoice_counter where id = 1);

alter table public.invoice_counter enable row level security;

-- Nobody reads or writes this directly. It moves only through the functions
-- below, which are the only things that know how to move it correctly.
drop policy if exists invoice_counter_admin_read on public.invoice_counter;
create policy invoice_counter_admin_read on public.invoice_counter
  for select using (is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- PEEK
-- ---------------------------------------------------------------------------
-- What the next week would be given, without spending it. The preview shows
-- this on a week that has not been numbered yet.
create or replace function public.peek_invoice_no()
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select (next_no)::text from invoice_counter where id = 1;
$$;

revoke all on function public.peek_invoice_no() from public;
grant execute on function public.peek_invoice_no() to authenticated;

-- ---------------------------------------------------------------------------
-- TAKE ONE
-- ---------------------------------------------------------------------------
create or replace function public.assign_invoice_no(p_job_week_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_existing text;
  v_no       integer;
begin
  if not is_admin(auth.uid()) then
    raise exception 'admins only';
  end if;

  select invoice_no into v_existing from job_weeks where id = p_job_week_id;
  if not found then
    raise exception 'job week not found';
  end if;

  -- Already numbered. Giving it a second number would leave the first one on a
  -- customer's invoice and nothing here pointing at it.
  if v_existing is not null and length(trim(v_existing)) > 0 then
    return v_existing;
  end if;

  -- The lock is the whole point: two approvals at the same instant queue here
  -- instead of both reading the same number.
  update invoice_counter set next_no = next_no + 1
   where id = 1
   returning next_no - 1 into v_no;

  if v_no is null then
    raise exception 'invoice counter is missing';
  end if;

  update job_weeks set invoice_no = (v_no)::text where id = p_job_week_id;
  return (v_no)::text;
end;
$$;

revoke all on function public.assign_invoice_no(uuid) from public;
grant execute on function public.assign_invoice_no(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- KEEP THE COUNTER AHEAD OF ANYTHING TYPED IN
-- ---------------------------------------------------------------------------
create or replace function public.tg_job_weeks_invoice_no_watermark()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_typed integer;
begin
  if new.invoice_no is null or new.invoice_no !~ '^[0-9]+$' then
    return new;
  end if;
  v_typed := (new.invoice_no)::integer;

  update invoice_counter
     set next_no = v_typed + 1
   where id = 1 and next_no <= v_typed;

  return new;
end;
$$;

drop trigger if exists job_weeks_invoice_no_watermark on public.job_weeks;
create trigger job_weeks_invoice_no_watermark
  after insert or update of invoice_no on public.job_weeks
  for each row execute function public.tg_job_weeks_invoice_no_watermark();

-- ---------------------------------------------------------------------------
-- HAND ONE OUT WHEN A WEEK IS APPROVED
-- ---------------------------------------------------------------------------
--
-- Before, not after: the row is still being written, so the number goes on in
-- the same statement rather than in a second update that could fail on its own.
-- A week approved with a number already on it keeps that number.
create or replace function public.tg_job_weeks_number_on_approve()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_no integer;
begin
  if new.status <> 'approved' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'approved' then
    return new;                        -- already was approved; nothing new here
  end if;
  if new.invoice_no is not null and length(trim(new.invoice_no)) > 0 then
    return new;                        -- the office gave it one
  end if;

  update invoice_counter set next_no = next_no + 1
   where id = 1
   returning next_no - 1 into v_no;

  if v_no is not null then
    new.invoice_no := (v_no)::text;
  end if;

  return new;
end;
$$;

drop trigger if exists job_weeks_number_on_approve on public.job_weeks;
create trigger job_weeks_number_on_approve
  before insert or update of status on public.job_weeks
  for each row execute function public.tg_job_weeks_number_on_approve();
