-- Giving an invoice number back when the document that took it is deleted.
--
-- The quote desk spends a number the moment a quote is turned into an invoice.
-- Change your mind and the document could only be marked "void", which left it
-- in the list forever with a number nobody could ever use again. Voiding is the
-- right answer for an invoice a customer has seen. It is the wrong answer for
-- one made by mistake five minutes ago.
--
-- WHEN A NUMBER CAN COME BACK
--
-- Only the number most recently handed out, and only when nothing is on it.
-- Those two conditions are not fussiness:
--
--   * Rolling the counter back onto a number in the middle of the run would
--     re-issue every number above it too, so the next three invoices would
--     collide with three that already exist.
--   * A number still written on a job week, a parts invoice or a desk invoice
--     is not free no matter what the counter says.
--
-- Anything else leaves a gap in the sequence, and a gap costs nothing. Two
-- invoices carrying the same number costs an argument with a customer about
-- which one they are paying.
--
-- Nothing here asks QuickBooks. It does not need to: the counter is only ever
-- rolled back to a number this portal issued and nothing holds, and if
-- QuickBooks turns out to have that number anyway, sync_invoice_no pushes the
-- counter straight back past it on the next page load.

create or replace function public.release_invoice_no(p_no integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_next integer;
  v_used text;
begin
  if not is_admin(auth.uid()) then
    raise exception 'admins only';
  end if;
  if p_no is null then
    return jsonb_build_object('freed', false, 'reason', 'no number given');
  end if;

  select src into v_used from (
    select 'a job week'      as src from job_weeks      where invoice_no = p_no::text
    union all
    select 'a parts invoice' as src from parts_invoices where invoice_no = p_no::text
    union all
    select 'a desk invoice'  as src from desk_invoices  where invoice_no = p_no::text
  ) x limit 1;

  if v_used is not null then
    return jsonb_build_object('freed', false,
      'reason', 'invoice ' || p_no || ' is still on ' || v_used);
  end if;

  select next_no into v_next from invoice_counter where id = 1;
  if v_next is null then
    raise exception 'invoice counter is missing';
  end if;

  if v_next <> p_no + 1 then
    return jsonb_build_object('freed', false,
      'reason', 'the numbers have moved on since ' || p_no || ' -- the next one is ' || v_next);
  end if;

  update invoice_counter set next_no = p_no where id = 1;
  return jsonb_build_object('freed', true, 'next_no', p_no);
end;
$$;

comment on function public.release_invoice_no(integer) is
  'Hands an invoice number back to the counter when the document holding it is '
  'deleted. Only the most recently issued number, and only when no job week, '
  'parts invoice or desk invoice still carries it. Returns {freed, reason|next_no}.';

revoke all on function public.release_invoice_no(integer) from public, anon;
grant execute on function public.release_invoice_no(integer) to authenticated;
