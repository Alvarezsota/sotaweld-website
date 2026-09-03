-- The customer's PO number, on the invoice.
--
-- A customer's accounts department matches a bill against the PO they raised
-- for it. Without that number on the invoice it sits in a queue until somebody
-- rings up and asks, which is days on a payment for the sake of a field.
--
-- jobs.bid_number is ours -- our quote number for the job. This is theirs.
-- Different things, and a bid number in a PO field gets an invoice rejected
-- just as surely as a blank one.
--
-- ---------------------------------------------------------------------------
-- NO DEPLOY NEEDED, AND THAT IS NOT LUCK
-- ---------------------------------------------------------------------------
--
-- qb-push-invoice already reads payload.po_number and puts it in CustomerMemo,
-- the line QuickBooks prints on the invoice for the customer to read. It was
-- written that way for parts invoices and desk invoices, both of which return
-- po_number. qb_invoice_payload -- the job week one -- never did, so on every
-- labour invoice that branch was dead code and CustomerMemo was never set.
--
-- So the whole change is to return the field. The push has been ready for it
-- all along.
--
-- Safe to re-run.

alter table public.jobs
  add column if not exists po_number text;

comment on column public.jobs.po_number is
  'The customer''s purchase order number for this job, printed on the invoice so their accounts can match it. Theirs, not ours -- bid_number is our own quote number and is a different field.';

do $rebuild$
declare
  v_def text;
  v_old text := 'return jsonb_build_object(
    ''job_week_id''';
  v_new text := 'return jsonb_build_object(
    ''po_number'', nullif(btrim(coalesce(v.po_number, '''')), ''''),
    ''job_week_id''';
  v_hits int;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'qb_invoice_payload';

  if v_def is null then
    raise exception 'STOP: qb_invoice_payload not found. Nothing has been changed.';
  end if;
  if position('po_number' in v_def) > 0 then
    raise notice 'qb_invoice_payload already returns po_number; leaving it alone';
    return;
  end if;

  -- It must select the column before it can return it. That is exactly the
  -- mistake the final_invoice change made here, and it broke every invoice
  -- preview and push for a minute.
  if position('j.billing_type as jbilling, jw.invoice_no' in v_def) = 0 then
    raise exception 'STOP: the select list is not what this expected. Nothing has been changed.';
  end if;
  v_def := replace(v_def,
    'j.billing_type as jbilling, jw.invoice_no',
    'j.billing_type as jbilling, j.po_number, jw.invoice_no');

  v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_hits <> 1 then
    raise exception 'STOP: expected exactly one payload return, found %. Nothing has been changed.', v_hits;
  end if;

  execute replace(v_def, v_old, v_new);
end
$rebuild$;

notify pgrst, 'reload schema';
