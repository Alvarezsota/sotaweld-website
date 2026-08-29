-- Quote desk, part 2: the invoice tables the QuickBooks push reads.
-- Part 1 is already applied. Safe to run twice. Nothing here touches time
-- tickets, job logs or existing invoices.

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
    'expected_total',  (select coalesce(sum((l2->>'amount')::numeric),0)
                        from jsonb_array_elements(lines) l2),
    'lines_total',     (select coalesce(sum((l2->>'amount')::numeric),0)
                        from jsonb_array_elements(lines) l2)
  );
end;
$function$;

revoke all on function public.desk_invoice_payload(uuid) from public;
grant execute on function public.desk_invoice_payload(uuid) to authenticated;

notify pgrst, 'reload schema';

select 'desk_invoices table'      as piece, case when to_regclass('public.desk_invoices')      is not null then 'yes' else 'NO' end as built
union all select 'desk_invoice_lines table', case when to_regclass('public.desk_invoice_lines') is not null then 'yes' else 'NO' end
union all select 'desk_invoice_payload()',   case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='desk_invoice_payload') then 'yes' else 'NO' end
union all select 'frozen-once-pushed guard', case when exists (select 1 from pg_trigger where tgname='desk_invoices_frozen_once_pushed') then 'yes' else 'NO' end
union all select 'invoice-number watermark', case when exists (select 1 from pg_trigger where tgname='desk_invoices_no_watermark') then 'yes' else 'NO' end;
