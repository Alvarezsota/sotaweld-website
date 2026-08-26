-- One book of numbers, and one shape of invoice.
--
-- ---------------------------------------------------------------------------
-- take_invoice_no()
-- ---------------------------------------------------------------------------
--
-- The counter was being incremented in three places by the time parts invoices
-- turned up. Three copies of "lock it, read it, bump it" is three chances for
-- one of them to be written slightly wrong, and the symptom of getting it wrong
-- is two customers holding the same invoice number. So it is one function now
-- and the callers just ask.

create or replace function public.take_invoice_no()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_no integer;
begin
  -- The update itself is the lock: two callers at the same instant queue here
  -- rather than both reading the same value.
  update invoice_counter set next_no = next_no + 1
   where id = 1
   returning next_no - 1 into v_no;

  if v_no is null then
    raise exception 'invoice counter is missing';
  end if;
  return v_no;
end;
$$;

revoke all on function public.take_invoice_no() from public;

-- Rewritten to go through it. Behaviour is unchanged.
create or replace function public.assign_invoice_no(p_job_week_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_existing text;
begin
  if not is_admin(auth.uid()) then
    raise exception 'admins only';
  end if;

  select invoice_no into v_existing from job_weeks where id = p_job_week_id;
  if not found then
    raise exception 'job week not found';
  end if;

  if v_existing is not null and length(trim(v_existing)) > 0 then
    return v_existing;
  end if;

  v_existing := (take_invoice_no())::text;
  update job_weeks set invoice_no = v_existing where id = p_job_week_id;
  return v_existing;
end;
$$;

revoke all on function public.assign_invoice_no(uuid) from public;
grant execute on function public.assign_invoice_no(uuid) to authenticated;

create or replace function public.tg_job_weeks_number_on_approve()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status <> 'approved' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'approved' then
    return new;
  end if;
  if new.invoice_no is not null and length(trim(new.invoice_no)) > 0 then
    return new;
  end if;

  new.invoice_no := (take_invoice_no())::text;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- A PARTS INVOICE TAKES ITS NUMBER WHEN IT IS FINISHED
-- ---------------------------------------------------------------------------
--
-- Not when it is started. A draft that gets abandoned -- a customer who changes
-- his mind, a price that turns out wrong -- would otherwise swallow a number
-- and leave a hole in the run for the accountant to explain.
create or replace function public.tg_parts_invoices_number_when_ready()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status = 'draft' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status <> 'draft' then
    return new;
  end if;
  if new.invoice_no is not null and length(trim(new.invoice_no)) > 0 then
    return new;
  end if;

  new.invoice_no := (take_invoice_no())::text;
  return new;
end;
$$;

drop trigger if exists parts_invoices_number_when_ready on public.parts_invoices;
create trigger parts_invoices_number_when_ready
  before insert or update of status on public.parts_invoices
  for each row execute function public.tg_parts_invoices_number_when_ready();

-- A number typed in by hand pushes the counter past it, exactly as on a job
-- week, so the automatic ones resume after it instead of colliding with it.
create or replace function public.tg_parts_invoices_invoice_no_watermark()
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

drop trigger if exists parts_invoices_invoice_no_watermark on public.parts_invoices;
create trigger parts_invoices_invoice_no_watermark
  after insert or update of invoice_no on public.parts_invoices
  for each row execute function public.tg_parts_invoices_invoice_no_watermark();

-- ---------------------------------------------------------------------------
-- THE SAME SHAPE AS A JOB WEEK'S INVOICE
-- ---------------------------------------------------------------------------
--
-- Field for field what qb_invoice_payload returns, so the preview screen and
-- the push function handle a parts invoice with nothing added to either. Where
-- a job week has a week, this has a date; where it has a job, this has the
-- customer's own name. Nothing else differs.
--
-- The default item is Welding Services, the same one the job-week payload books
-- parts and materials against, so a line with nothing chosen still lands
-- somewhere sensible in the books rather than being refused by QuickBooks.
create or replace function public.parts_invoice_payload(p_invoice_id uuid)
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
  select * into v from parts_invoices where id = p_invoice_id;
  if not found then
    return jsonb_build_object('error', 'invoice not found');
  end if;
  if coalesce(trim(v.qb_customer_id), '') = '' then
    return jsonb_build_object('error', 'this invoice has no customer on it');
  end if;

  for l in
    select description, quantity, unit_price, qb_item_id,
           round(quantity * unit_price, 2) as amount
    from parts_invoice_lines
    where invoice_id = p_invoice_id
    order by sort_order, created_at
  loop
    -- A zero line is a line he decided against. Sending it would put a $0.00
    -- row in front of the customer for no reason.
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
    'kind',          'parts',
    'parts_invoice_id', p_invoice_id,
    'job_name',      'Parts cut',
    'week_start',    v.invoice_date,
    'week_end',      v.invoice_date,
    'status',        v.status,
    'billing_type',  'parts',
    'customer',      jsonb_build_object('id', v.qb_customer_id),
    'customer_name', v.qb_customer_name,
    'invoice_no',    nullif(trim(coalesce(v.invoice_no, '')), ''),
    'next_invoice_no', v_peek,
    'memo',          coalesce(nullif(trim(coalesce(v.notes, '')), ''),
                       'Parts cut' || case when v.po_number is not null and trim(v.po_number) <> ''
                                           then ' - PO ' || v.po_number else '' end),
    'po_number',     nullif(trim(coalesce(v.po_number, '')), ''),
    'transaction_date', v.invoice_date,
    'lines',         lines,
    -- Both sides of the equality the push checks are computed from the same
    -- lines here, so a parts invoice can never be stopped by a totals
    -- disagreement it has no way to have.
    'expected_total', (select coalesce(sum((l2->>'amount')::numeric),0)
                       from jsonb_array_elements(lines) l2),
    'lines_total',   (select coalesce(sum((l2->>'amount')::numeric),0)
                      from jsonb_array_elements(lines) l2)
  );
end;
$function$;

revoke all on function public.parts_invoice_payload(uuid) from public;
grant execute on function public.parts_invoice_payload(uuid) to authenticated;
