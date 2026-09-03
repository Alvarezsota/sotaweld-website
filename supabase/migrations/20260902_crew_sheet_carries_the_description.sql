-- What they welded, day by day, on the sheet that goes with the invoice.
--
-- The crew sheet answers "who were those ninety-six hours, and on what days".
-- It does not answer "and what did they do", which is the other half of the
-- same phone call. The description is on every ticket already -- 4" tie ins,
-- Andector 20" inlet, whatever the man typed that morning -- and it has simply
-- never been carried through to the sheet.
--
-- This is the payload half. The drawing half is in _shared/invoice-backup-pdf.ts
-- and reaches the customer only once qb-push-invoice is redeployed.
--
-- ---------------------------------------------------------------------------
-- READ THIS BEFORE PUTTING IT ON THE ATTACHED SHEET
-- ---------------------------------------------------------------------------
--
-- These descriptions were on the sheet once and were taken off, because they
-- are free text a man types on a phone at the end of a shift and the sheet goes
-- to the customer. Seven invoices went out carrying them, and "Also helped at
-- the yard in the valtek bench" reached MasTec. Replacing the attachment on
-- invoices already sent is why the "Replace their crew sheets" button exists.
--
-- They are back because the office asked for them by name, knowing that. The
-- safeguards are that a description can be corrected on Approvals before the
-- week is approved, and the sheet can be read with the Crew time sheet button
-- before the invoice is pushed. Neither is automatic; both are the office's.
--
-- Safe to re-run.

do $rebuild$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'invoice_backup_payload';

  if v_def is null then
    raise exception 'STOP: invoice_backup_payload not found. Nothing has been changed.';
  end if;
  if position('''description''' in v_def) > 0 then
    raise notice 'the sheet payload already carries the description; leaving it alone';
    return;
  end if;

  -- Select it before returning it.
  if position('wl.hours, wl.bill_rate, wl.is_stainless,' in v_def) = 0 then
    raise exception 'STOP: the src CTE is not what this expected. Nothing has been changed.';
  end if;
  v_def := replace(v_def,
    'wl.hours, wl.bill_rate, wl.is_stainless,',
    'wl.hours, wl.bill_rate, wl.is_stainless, wl.description,');

  if position('''billed'', l.billed, ''stainless'', l.is_stainless)' in v_def) = 0 then
    raise exception 'STOP: the day rows are not what this expected. Nothing has been changed.';
  end if;
  v_def := replace(v_def,
    '''billed'', l.billed, ''stainless'', l.is_stainless)',
    '''billed'', l.billed, ''stainless'', l.is_stainless,
             ''description'', nullif(btrim(coalesce(l.description, '''')), ''''))');

  execute v_def;
end
$rebuild$;

notify pgrst, 'reload schema';
