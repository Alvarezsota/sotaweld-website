-- The quote desk, and the two number series it draws on.
--
-- ---------------------------------------------------------------------------
-- WHERE THE QUOTES LIVE
-- ---------------------------------------------------------------------------
--
-- The desk hands its whole state over in one piece -- customers, contacts,
-- rates, saved documents, the draft in progress -- and asks for it back the
-- same way. So it is stored the same way: one row holding one JSON document,
-- rather than a set of tables shaped around a structure the module owns and
-- may change. Nothing else in the portal reads inside it.
--
-- It is admin-only. Quotes carry rates and margins, and the crew have no
-- business in them.
--
-- ---------------------------------------------------------------------------
-- QUOTE NUMBERS
-- ---------------------------------------------------------------------------
--
-- SOTA-MM-DD-YYYY-NN. Month before day, which is how the office writes them
-- and is not to be reordered. NN counts up within that date, so the second
-- quote written on the 27th is -02 whoever writes it.
--
-- The count comes from a table rather than from reading the quotes already
-- stored, for the same reason the invoice counter exists: two people saving at
-- the same instant would otherwise read the same highest number and both take
-- it.
--
-- ---------------------------------------------------------------------------
-- INVOICE NUMBERS
-- ---------------------------------------------------------------------------
--
-- Nothing new here. An invoice raised on the desk calls take_invoice_no(), the
-- counter the approved weeks already draw from, so the two cannot collide.
-- This migration only opens that function to the desk; it does not change how
-- it works, and QuickBooks still has the final say over what the invoice ends
-- up numbered.
--
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- STATE
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- A QUOTE DESK TABLE THAT IS THE WRONG SHAPE
-- ---------------------------------------------------------------------------
--
-- One was found in the live database keyed on a text id with the JSON in a
-- column called data. The portal reads id = 1 and a column called state, so the
-- table was there and the page still could not use it -- which is worse than
-- not having it, because "create table if not exists" then quietly does
-- nothing and the error only changes shape.
--
-- So a table that is not the right shape is replaced, unless it is holding
-- something, in which case this stops and says so rather than throwing away
-- quotes to make a migration run.

do $shape$
declare
  v_rows bigint;
begin
  if to_regclass('public.quote_desk_state') is null then
    return;                                     -- nothing there yet; carry on
  end if;

  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'quote_desk_state'
                and column_name = 'state') then
    return;                                     -- already the right shape
  end if;

  -- Counted without naming a column, because the shape is the thing in
  -- question. Any jsonb column with something in it counts as a desk with
  -- work in it.
  select count(*) into v_rows
    from public.quote_desk_state t,
         lateral jsonb_each(to_jsonb(t)) kv
   where jsonb_typeof(kv.value) = 'object'
     and kv.value <> '{}'::jsonb;

  if v_rows > 0 then
    raise exception
      'STOP: public.quote_desk_state is the wrong shape for the portal but has % row(s) with something in them. Send this message back rather than running further -- the quotes in it would be thrown away.', v_rows;
  end if;

  raise notice 'replacing an empty quote_desk_state that was the wrong shape';
  drop table public.quote_desk_state cascade;
end
$shape$;

create table if not exists public.quote_desk_state (
  id         integer primary key default 1 check (id = 1),
  state      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

comment on table public.quote_desk_state is
  'One row. The quote desk''s entire state as it hands it over.';

insert into public.quote_desk_state (id, state)
select 1, '{}'::jsonb
where not exists (select 1 from public.quote_desk_state where id = 1);

alter table public.quote_desk_state enable row level security;

drop policy if exists quote_desk_state_admin_read on public.quote_desk_state;
create policy quote_desk_state_admin_read on public.quote_desk_state
  for select using (is_admin(auth.uid()));

drop policy if exists quote_desk_state_admin_write on public.quote_desk_state;
create policy quote_desk_state_admin_write on public.quote_desk_state
  for update using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- QUOTE NUMBER COUNTER
-- ---------------------------------------------------------------------------

create table if not exists public.quote_counter (
  quote_date date primary key,
  next_seq   integer not null default 1
);

comment on table public.quote_counter is
  'One row per date. next_seq is the NN the next quote written that day gets.';

alter table public.quote_counter enable row level security;
-- Moves only through take_quote_no() below, which is the only thing that knows
-- how to move it correctly.

-- The format lives in exactly one place.
create or replace function public.format_quote_no(p_date date, p_seq integer)
returns text
language sql
immutable
as $$
  select 'SOTA-' || to_char(p_date, 'MM-DD-YYYY') || '-' || lpad(p_seq::text, 2, '0');
$$;

-- What the next quote on a given day would be called, without spending it.
create or replace function public.peek_quote_no(p_date date default current_date)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.format_quote_no(
    p_date,
    coalesce((select next_seq from public.quote_counter where quote_date = p_date), 1)
  );
$$;

create or replace function public.take_quote_no(p_date date default current_date)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_seq integer;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admins only';
  end if;

  -- The upsert is the lock: two callers at the same instant queue here rather
  -- than both reading the same sequence.
  insert into public.quote_counter (quote_date, next_seq)
  values (p_date, 2)
  on conflict (quote_date) do update
    set next_seq = public.quote_counter.next_seq + 1
  returning next_seq - 1 into v_seq;

  return public.format_quote_no(p_date, v_seq);
end;
$$;

revoke all on function public.take_quote_no(date) from public;
grant execute on function public.take_quote_no(date) to authenticated;
grant execute on function public.peek_quote_no(date) to authenticated;

-- ---------------------------------------------------------------------------
-- INVOICE NUMBERS FOR THE DESK
-- ---------------------------------------------------------------------------
--
-- take_invoice_no() is deliberately closed to everyone. The desk needs a
-- number when an invoice is raised, so it gets a gated wrapper rather than the
-- function itself -- same counter, same guarantees, admin only.

create or replace function public.take_desk_invoice_no()
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admins only';
  end if;
  return (public.take_invoice_no())::text;
end;
$$;

revoke all on function public.take_desk_invoice_no() from public;
grant execute on function public.take_desk_invoice_no() to authenticated;

-- Confirmation: the next quote number for today, and the next invoice number.
select public.peek_quote_no() as next_quote_no,
       public.peek_invoice_no() as next_invoice_no;
