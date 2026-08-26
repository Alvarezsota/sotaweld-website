-- An invoice for parts cut, with no week of labour behind it.
--
-- A lot of the work never goes near a job week: plate goes on the laser, parts
-- come off, they get handed over. There is nobody's hours to approve and no
-- week to close, so the whole job-week machine has nothing to say about it --
-- but it still has to be billed, and billed out of the same book of numbers, or
-- two invoices go out with the same number on them.
--
-- ---------------------------------------------------------------------------
-- ONE NUMBER SERIES, TWO KINDS OF INVOICE
-- ---------------------------------------------------------------------------
--
-- Both kinds draw from invoice_counter. take_invoice_no() is the single place a
-- number is spent, and it is spent under a row lock, so a parts invoice raised
-- at the same moment a week is approved cannot come out holding the same
-- number. Splitting the series -- a letter prefix, a second counter -- would
-- have been easier and would have put two numbering schemes in front of the
-- same customer.
--
-- ---------------------------------------------------------------------------
-- THE PAYLOAD IS THE SAME SHAPE
-- ---------------------------------------------------------------------------
--
-- parts_invoice_payload returns exactly what qb_invoice_payload returns. That is
-- not tidiness: it means the preview screen and the push function already
-- understand a parts invoice without being taught anything. One preview, one
-- push, one set of refusals, two sources.

-- ---------------------------------------------------------------------------
-- WHAT QUICKBOOKS KNOWS
-- ---------------------------------------------------------------------------
--
-- An invoice raised here has to name a customer QuickBooks already has, and
-- every line has to point at one of its products or services, or QuickBooks
-- rejects the lot. Keeping both lists here means the page can offer them
-- without a round trip, and means a parts invoice can be written on a phone in
-- the shop with no QuickBooks session anywhere near it.

create table if not exists public.qb_customers (
  id           text not null,
  environment  text not null default 'production',
  display_name text not null,
  company_name text,
  active       boolean not null default true,
  synced_at    timestamptz not null default now(),
  primary key (environment, id)
);

create table if not exists public.qb_items (
  id           text not null,
  environment  text not null default 'production',
  name         text not null,
  item_type    text,
  active       boolean not null default true,
  synced_at    timestamptz not null default now(),
  primary key (environment, id)
);

alter table public.qb_customers enable row level security;
alter table public.qb_items enable row level security;

drop policy if exists qb_customers_admin_read on public.qb_customers;
create policy qb_customers_admin_read on public.qb_customers
  for select using (is_admin(auth.uid()));

drop policy if exists qb_items_admin_read on public.qb_items;
create policy qb_items_admin_read on public.qb_items
  for select using (is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- THE INVOICE
-- ---------------------------------------------------------------------------

create table if not exists public.parts_invoices (
  id               uuid primary key default gen_random_uuid(),
  invoice_no       text,
  qb_customer_id   text not null,
  qb_customer_name text not null,
  environment      text not null default 'production',
  invoice_date     date not null default current_date,
  po_number        text,
  notes            text,
  status           text not null default 'draft'
                     check (status in ('draft', 'ready', 'synced')),
  qb_invoice_id    text,
  qb_invoice_total numeric,
  qb_pushed_at     timestamptz,
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.parts_invoice_lines (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references public.parts_invoices(id) on delete cascade,
  sort_order   integer not null default 0,
  description  text not null,
  quantity     numeric not null default 1 check (quantity >= 0),
  unit_price   numeric not null default 0 check (unit_price >= 0),
  qb_item_id   text,
  created_at   timestamptz not null default now()
);

create index if not exists parts_invoice_lines_invoice on public.parts_invoice_lines (invoice_id, sort_order);
create index if not exists parts_invoices_recent on public.parts_invoices (invoice_date desc, created_at desc);

alter table public.parts_invoices enable row level security;
alter table public.parts_invoice_lines enable row level security;

-- Billing is the office's business. A welder has no reason to see or raise one.
drop policy if exists parts_invoices_admin_all on public.parts_invoices;
create policy parts_invoices_admin_all on public.parts_invoices
  for all using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

drop policy if exists parts_invoice_lines_admin_all on public.parts_invoice_lines;
create policy parts_invoice_lines_admin_all on public.parts_invoice_lines
  for all using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

-- A synced invoice is on a customer's books. Changing it here afterwards would
-- leave the two disagreeing with nothing on either side saying so.
create or replace function public.tg_parts_invoices_locked_once_synced()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'synced' and new.status <> 'synced' then
    raise exception
      'This invoice is in QuickBooks and cannot be reopened here. Void or delete it in QuickBooks first.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists parts_invoices_locked_once_synced on public.parts_invoices;
create trigger parts_invoices_locked_once_synced
  before update on public.parts_invoices
  for each row execute function public.tg_parts_invoices_locked_once_synced();

-- The lines are guarded separately, because deleting a line never touches the
-- invoice row and would otherwise slip past the trigger above.
create or replace function public.tg_parts_invoice_lines_guard()
returns trigger
language plpgsql
as $$
declare
  v_status text;
begin
  select status into v_status from parts_invoices
   where id = coalesce(new.invoice_id, old.invoice_id);
  if v_status = 'synced' then
    raise exception 'This invoice is in QuickBooks. Its lines cannot be changed here.';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists parts_invoice_lines_guard on public.parts_invoice_lines;
create trigger parts_invoice_lines_guard
  before insert or update or delete on public.parts_invoice_lines
  for each row execute function public.tg_parts_invoice_lines_guard();
