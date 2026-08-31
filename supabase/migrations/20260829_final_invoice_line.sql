-- FINAL INVOICE, where the customer actually reads it.
--
-- job_weeks.is_final and the red block on the preview came first, but the
-- preview is ours. The customer sees the QuickBooks invoice, and nothing on
-- that said anything at all -- which leaves the one person who has to decide
-- whether to close the job out no way of knowing.
--
-- ---------------------------------------------------------------------------
-- WHY NOT CustomerMemo
-- ---------------------------------------------------------------------------
--
-- CustomerMemo is the line QuickBooks prints for the customer, and it is the
-- obvious home for this. It is set in qb-push-invoice, and that function cannot
-- be changed a line at a time: a deploy replaces the whole bundle, which here
-- means the push plus 440 lines of crew-sheet drawing code -- coordinates, page
-- breaks, column widths -- re-uploaded by hand. A slip in that which still
-- parses deploys clean and quietly breaks the sheet attached to every invoice.
-- That is a bad trade for one line of text, so it was not taken.
--
-- (Worth knowing for whoever reads this next: qb_invoice_payload returns no
-- po_number at all, so for a job week CustomerMemo is never set. The slot is
-- empty, and the day this function is being redeployed for another reason,
-- that is where this belongs.)
--
-- ---------------------------------------------------------------------------
-- SO IT IS A LINE
-- ---------------------------------------------------------------------------
--
-- The invoice lines are built here, in SQL, and they print. The notice is a
-- line of its own at the bottom, at zero -- which is how a note on a bill is
-- normally carried anyway.
--
-- It adds nothing to the money: amount is 0.00, so lines_total still equals
-- expected_total and the push's totals check cannot be tripped by it. Quantity
-- and unit price are empty strings, which the push reads as falsy and leaves
-- off the line, so it prints as a sentence rather than as 0 x $0.00.
--
-- Anchored on the payload return's own first key. The first attempt anchored on
-- "return jsonb_build_object(" and was refused by its own guard, because the
-- refusals use that too -- which is the difference between patching a function
-- and mangling one.
--
-- Safe to re-run.

do $rebuild$
declare
  v_def text;
  v_anchor text := 'return jsonb_build_object(
    ''job_week_id''';
  v_add text := 'if coalesce(v.is_final, false) then
    lines := lines || jsonb_build_object(
      ''item'', jsonb_build_object(''id'', ''1010000001''),
      ''description'', ''FINAL INVOICE - no further invoices will be issued for this job'',
      ''quantity'', '''',
      ''unit_price'', '''',
      ''amount'', ''0.00'');
  end if;

  return jsonb_build_object(
    ''job_week_id''';
  v_hits int;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'qb_invoice_payload';

  if v_def is null then
    raise exception 'STOP: qb_invoice_payload not found. Nothing has been changed.';
  end if;

  if position('FINAL INVOICE' in v_def) > 0 then
    raise notice 'the final-invoice line is already there; leaving it alone';
    return;
  end if;

  if position('jw.is_final' in v_def) = 0 then
    raise exception
      'STOP: qb_invoice_payload is not selecting jw.is_final, so it cannot know. Nothing has been changed.';
  end if;

  v_hits := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  if v_hits <> 1 then
    raise exception
      'STOP: expected exactly one payload return, found %. Nothing has been changed.', v_hits;
  end if;

  execute replace(v_def, v_anchor, v_add);
end
$rebuild$;

notify pgrst, 'reload schema';
