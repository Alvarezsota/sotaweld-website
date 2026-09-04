-- The representative goes on the invoice, not only on the sheet behind it.
--
-- It was printing on the crew sheet, which is an attachment. Whoever opens the
-- invoice in the customer's office sees the invoice; the attachment is a second
-- click, and a name that needs a second click is a name nobody reads.
--
-- So it goes into the labour payload, and the push puts it in CustomerMemo -
-- the block QuickBooks prints on the face of the invoice, where the PO number
-- already goes. There is one of that field, so the two share it, one per line.
--
-- Only the labour payload carries it. A parts invoice and a desk invoice have
-- no job behind them and so have no representative to name.
--
-- The anchors below are dollar-quoted. Doubling quotes by hand is what made the
-- first attempt at this fail its own guard, and what left the sibling function
-- with coalesce(..., '''') - a string holding one apostrophe where an empty
-- string was meant. That is corrected here too. It happened to behave
-- correctly, which is the worst way for a mistake to sit in a schema.
--
-- Safe to re-run.

-- 1. Correct the sibling that was patched with the bad escaping.
do $fix$
declare
  v_def text;
  v_bad text := $q$nullif(btrim(coalesce(v.company_rep, '''')), '''')$q$;
  v_ok  text := $q$nullif(btrim(coalesce(v.company_rep, '')), '')$q$;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'invoice_backup_payload';

  if v_def is null then
    raise exception 'STOP: invoice_backup_payload not found. Nothing changed.';
  end if;
  if position(v_bad in v_def) = 0 then
    raise notice 'invoice_backup_payload is already written correctly; leaving it alone';
  else
    execute replace(v_def, v_bad, v_ok);
  end if;
end
$fix$;

-- 2. The labour payload gains the field.
do $patch$
declare
  v_def text;
  v_sel_old text := $q$j.billing_type as jbilling, j.po_number, jw.invoice_no, jw.is_final$q$;
  v_sel_new text := $q$j.billing_type as jbilling, j.po_number, j.company_rep, jw.invoice_no, jw.is_final$q$;
  v_out_old text := $q$'po_number', nullif(btrim(coalesce(v.po_number, '')), ''),$q$;
  v_out_new text := $q$'po_number', nullif(btrim(coalesce(v.po_number, '')), ''),
    'company_rep', nullif(btrim(coalesce(v.company_rep, '')), ''),$q$;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'qb_invoice_payload';

  if v_def is null then
    raise exception 'STOP: qb_invoice_payload not found. Nothing changed.';
  end if;

  if position('company_rep' in v_def) > 0 then
    raise notice 'qb_invoice_payload already carries company_rep; leaving it alone';
    return;
  end if;

  -- Both halves or neither. Adding the output without the select is exactly the
  -- mistake that once broke every preview and every push on this function with
  -- "record v has no field is_final".
  if position(v_sel_old in v_def) = 0 then
    raise exception 'STOP: the select in qb_invoice_payload is not shaped as expected. Nothing changed.';
  end if;
  if position(v_out_old in v_def) = 0 then
    raise exception 'STOP: the output block in qb_invoice_payload is not shaped as expected. Nothing changed.';
  end if;

  v_def := replace(v_def, v_sel_old, v_sel_new);
  v_def := replace(v_def, v_out_old, v_out_new);
  execute v_def;
end
$patch$;

notify pgrst, 'reload schema';
