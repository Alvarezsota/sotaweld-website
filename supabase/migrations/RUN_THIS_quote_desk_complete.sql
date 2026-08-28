-- ===========================================================================
-- THE QUOTE DESK, ALL OF IT, IN ONE GO
-- ===========================================================================
--
-- This is 20260827_quote_desk.sql and 20260828_desk_invoice_to_quickbooks.sql
-- one after the other, in the order they have to run. It exists because the
-- first of them did not land -- the portal reported
--
--     Could not find the table 'public.quote_desk_state' in the schema cache
--
-- which is Supabase saying that table is not there. Running the two separately
-- leaves room for the first to fail quietly and the second to look fine, so
-- they are together here with a check at the top and a check at the bottom.
--
-- Safe to re-run. Nothing here drops anything or touches an existing table.
--
-- ---------------------------------------------------------------------------
-- WHAT HAS TO BE THERE ALREADY
-- ---------------------------------------------------------------------------
--
-- If any of this is missing the whole script stops on the first statement with
-- a plain message, rather than half-building a desk that fails later.

create or replace function pg_temp.have_fn(p_name text) returns boolean
language sql stable as $have$
  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = p_name);
$have$;

do $prereq$
begin
  if not pg_temp.have_fn('is_admin') then
    raise exception
      'STOP: is_admin() is missing. Every admin-only table in the portal uses it, so something is wrong beyond the quote desk. Send this message back rather than going further.';
  end if;
  if to_regclass('public.invoice_counter') is null then
    raise exception
      'STOP: invoice_counter is missing. Run 20260825_invoice_numbering.sql first -- the desk draws its invoice numbers from that counter.';
  end if;
  if not pg_temp.have_fn('peek_invoice_no') then
    raise exception
      'STOP: peek_invoice_no() is missing. Run 20260825_invoice_numbering.sql first.';
  end if;
  if not pg_temp.have_fn('take_invoice_no') then
    raise exception
      'STOP: take_invoice_no() is missing. Run 20260825_parts_invoice_numbering_and_payload.sql first -- the desk''s invoice numbers come off that same counter.';
  end if;
end
$prereq$;

-- ===========================================================================
-- PART 1 OF 2 -- THE DESK ITSELF
-- ===========================================================================

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


-- ===========================================================================
-- PART 2 OF 2 -- THE QUICKBOOKS SIDE
-- ===========================================================================

-- An invoice raised on the quote desk goes to QuickBooks the same way every
-- other invoice does.
--
-- ---------------------------------------------------------------------------
-- WHY THE DESK'S JSON IS NOT ENOUGH
-- ---------------------------------------------------------------------------
--
-- The desk keeps its working state as one JSON document, which is right for
-- customers, rates and drafts. It is wrong for an invoice going to QuickBooks,
-- for two reasons.
--
-- The push builds its payload in the database, from rows, on purpose. A job
-- week and a parts invoice both work that way so the browser cannot decide what
-- gets billed -- it names a record, and the server works out the money. Letting
-- the desk POST its own figures would put the one number the customer argues
-- about in the hands of whatever is running in the page.
--
-- And an invoice needs somewhere to remember it has already been sent. A blob
-- the desk rewrites on every keystroke is not that place.
--
-- So converting a quote writes a row here as well. The desk keeps its copy for
-- working on; this is the one the books see.
--
-- ---------------------------------------------------------------------------
-- NOTHING IS DUPLICATED
-- ---------------------------------------------------------------------------
--
-- desk_invoice_payload returns field for field what qb_invoice_payload and
-- parts_invoice_payload return, so the preview screen and the push function
-- take a desk invoice with nothing added to either beyond naming it. There is
-- no second QuickBooks client, no second token store, and no second place that
-- knows how to talk to Intuit -- the refresh token rotates, and one place
-- handling that is the only safe number.
--
-- The invoice number is not taken here either. It was already taken from
-- invoice_counter when the desk converted the quote, which is the same counter
-- the approved weeks draw from.
--
-- Safe to re-run.

create table if not exists public.desk_invoices (
  id              uuid primary key default gen_random_uuid(),
  doc_id          text not null unique,      -- the desk's own id for the document
  invoice_no      text,                      -- already issued by take_desk_invoice_no()
  quote_no        text,                      -- the SOTA quote it came from, if any
  invoice_date    date not null default current_date,
  due_date        date,
  customer_name   text not null,
  customer_email  text,
  qb_customer_id  text,
  job_name        text,
  po_number       text,
  memo            text,
  status          text not null default 'open',
  qb_invoice_id    text,                     -- set once QuickBooks has it
  qb_invoice_total numeric(14,2),
  qb_pushed_at     timestamptz,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id)
);

comment on table public.desk_invoices is
  'One row per invoice raised on the quote desk. qb_invoice_id is the guard: '
  'once it is set the invoice is in QuickBooks and must not be sent again.';

create table if not exists public.desk_invoice_lines (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.desk_invoices(id) on delete cascade,
  description text,
  quantity    numeric(14,4) not null default 0,
  unit_price  numeric(14,4) not null default 0,
  qb_item_id  text,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

-- The push writes the same three columns back on every kind of invoice. Named
-- here exactly as they are on job_weeks and parts_invoices, so the write-back
-- needs no idea which kind it just sent. Spelled out again for a desk that was
-- created by an earlier draft of this file.
alter table public.desk_invoices add column if not exists qb_invoice_total numeric(14,2);
alter table public.desk_invoices add column if not exists qb_pushed_at     timestamptz;

create index if not exists desk_invoice_lines_invoice_idx
  on public.desk_invoice_lines (invoice_id, sort_order);

alter table public.desk_invoices      enable row level security;
alter table public.desk_invoice_lines enable row level security;

drop policy if exists desk_invoices_admin on public.desk_invoices;
create policy desk_invoices_admin on public.desk_invoices
  for all using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

drop policy if exists desk_invoice_lines_admin on public.desk_invoice_lines;
create policy desk_invoice_lines_admin on public.desk_invoice_lines
  for all using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- AN INVOICE ALREADY IN QUICKBOOKS CANNOT BE REWRITTEN
-- ---------------------------------------------------------------------------
--
-- Editing the quote afterwards is fine; editing what QuickBooks was told is
-- not. Once qb_invoice_id is set the row is frozen apart from the bookkeeping
-- columns, so the desk cannot quietly disagree with the books.

create or replace function public.tg_desk_invoices_frozen_once_pushed()
returns trigger
language plpgsql
as $$
begin
  if old.qb_invoice_id is not null and new.qb_invoice_id is distinct from old.qb_invoice_id then
    raise exception 'this invoice is already in QuickBooks as %', old.qb_invoice_id;
  end if;

  if old.qb_invoice_id is not null then
    new.invoice_no     := old.invoice_no;
    new.customer_name  := old.customer_name;
    new.qb_customer_id := old.qb_customer_id;
    new.invoice_date   := old.invoice_date;
    new.po_number      := old.po_number;
  end if;

  return new;
end;
$$;

drop trigger if exists desk_invoices_frozen_once_pushed on public.desk_invoices;
create trigger desk_invoices_frozen_once_pushed
  before update on public.desk_invoices
  for each row execute function public.tg_desk_invoices_frozen_once_pushed();

-- The same watermark the other invoice numbers get: a number typed or issued
-- here moves the shared counter past it, so the automatic ones resume after.
create or replace function public.tg_desk_invoices_no_watermark()
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

drop trigger if exists desk_invoices_no_watermark on public.desk_invoices;
create trigger desk_invoices_no_watermark
  after insert or update of invoice_no on public.desk_invoices
  for each row execute function public.tg_desk_invoices_no_watermark();

-- ---------------------------------------------------------------------------
-- THE PAYLOAD
-- ---------------------------------------------------------------------------
--
-- Field for field what parts_invoice_payload returns. Where a parts invoice has
-- a date, this has a date; where it has the customer's own name, so has this.
-- Nothing else differs, so the preview and the push need nothing new.

create or replace function public.desk_invoice_payload(p_invoice_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v      record;
  lines  jsonb := '[]'::jsonb;
  l      record;
  v_peek text;
  v_default_item constant text := '1010000001';
begin
  select * into v from desk_invoices where id = p_invoice_id;
  if not found then
    return jsonb_build_object('error', 'invoice not found');
  end if;
  if coalesce(trim(v.qb_customer_id), '') = '' then
    return jsonb_build_object('error',
      'this invoice has no QuickBooks customer on it -- set one on the customer in the quote desk');
  end if;

  for l in
    select description, quantity, unit_price, qb_item_id,
           round(quantity * unit_price, 2) as amount
    from desk_invoice_lines
    where invoice_id = p_invoice_id
    order by sort_order, created_at
  loop
    -- A zero line is a line he decided against, the same as on a parts invoice.
    if coalesce(l.amount, 0) <> 0 then
      lines := lines || jsonb_build_object(
        'item', jsonb_build_object('id', coalesce(nullif(trim(coalesce(l.qb_item_id,'')), ''), v_default_item)),
        'description', l.description,
        'quantity', to_char(l.quantity, 'FM9999990.00'),
        'unit_price', to_char(l.unit_price, 'FM9999990.00'),
        'amount', to_char(l.amount, 'FM9999990.00'));
    end if;
  end loop;

  if jsonb_array_length(lines) = 0 then
    return jsonb_build_object('error', 'nothing to bill -- every line on this invoice comes to zero');
  end if;

  select (next_no)::text into v_peek from invoice_counter where id = 1;

  return jsonb_build_object(
    'kind',            'desk',
    'desk_invoice_id', p_invoice_id,
    'job_name',        coalesce(nullif(trim(coalesce(v.job_name, '')), ''), 'Quoted work'),
    'week_start',      v.invoice_date,
    'week_end',        v.invoice_date,
    'status',          v.status,
    'billing_type',    'quoted',
    'customer',        jsonb_build_object('id', v.qb_customer_id),
    'customer_name',   v.customer_name,
    'invoice_no',      nullif(trim(coalesce(v.invoice_no, '')), ''),
    'next_invoice_no', v_peek,
    'memo',            coalesce(nullif(trim(coalesce(v.memo, '')), ''),
                         coalesce(nullif(trim(coalesce(v.job_name, '')), ''), 'Quoted work')
                         || case when v.quote_no is not null and trim(v.quote_no) <> ''
                                 then ' - quote ' || v.quote_no else '' end),
    'po_number',       nullif(trim(coalesce(v.po_number, '')), ''),
    'transaction_date', v.invoice_date,
    'lines',           lines,
    -- Both sides of the equality the push checks come from the same lines, so a
    -- desk invoice cannot be stopped by a totals disagreement it cannot have.
    -- Both of them, though: the push reads lines_total and expected_total, and
    -- an absent lines_total reads as zero and blocks every invoice.
    'expected_total',  (select coalesce(sum((l2->>'amount')::numeric),0)
                        from jsonb_array_elements(lines) l2),
    'lines_total',     (select coalesce(sum((l2->>'amount')::numeric),0)
                        from jsonb_array_elements(lines) l2)
  );
end;
$function$;

revoke all on function public.desk_invoice_payload(uuid) from public;
grant execute on function public.desk_invoice_payload(uuid) to authenticated;

-- The error he saw was PostgREST's, not Postgres': the table can exist and the
-- API still not know about it until its cache is reloaded. It reloads on its
-- own, but not always straight away, so it is asked here rather than left to
-- look like the script did not work.
notify pgrst, 'reload schema';

-- ===========================================================================
-- DID IT WORK?
-- ===========================================================================
--
-- Every line below should say yes. Anything saying no means that piece did not
-- get built, and the desk will fail on it.

select 'quote_desk_state table'   as piece, case when to_regclass('public.quote_desk_state')   is not null then 'yes' else 'NO' end as built
union all select 'quote_counter table',      case when to_regclass('public.quote_counter')      is not null then 'yes' else 'NO' end
union all select 'desk_invoices table',      case when to_regclass('public.desk_invoices')      is not null then 'yes' else 'NO' end
union all select 'desk_invoice_lines table', case when to_regclass('public.desk_invoice_lines') is not null then 'yes' else 'NO' end
union all select 'take_quote_no()',          case when pg_temp.have_fn('take_quote_no') then 'yes' else 'NO' end
union all select 'peek_quote_no()',          case when pg_temp.have_fn('peek_quote_no') then 'yes' else 'NO' end
union all select 'take_desk_invoice_no()',   case when pg_temp.have_fn('take_desk_invoice_no') then 'yes' else 'NO' end
union all select 'desk_invoice_payload()',   case when pg_temp.have_fn('desk_invoice_payload') then 'yes' else 'NO' end
union all select 'the one desk state row',   case when exists (select 1 from public.quote_desk_state where id = 1) then 'yes' else 'NO' end;

-- And the two numbers the desk will hand out next, which is the same thing the
-- Quotes page shows once it loads.
select public.peek_quote_no()   as next_quote_no,
       public.peek_invoice_no() as next_invoice_no;
