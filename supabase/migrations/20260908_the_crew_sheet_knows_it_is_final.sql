-- The crew sheet is told whether it is the last one.
--
-- is_final already prints a line on the QuickBooks invoice. The sheet stapled
-- to that invoice never knew about it -- invoice_backup_payload does not select
-- it and does not hand it over -- so the bill said "nothing more is coming" and
-- the backup behind it said nothing at all.
--
-- The sheet is what gets printed, split and passed around their office, so it
-- is the half more likely to be read on its own. It gets the flag, and draws it
-- as a watermark on every page.
--
-- Safe to re-run.

do $bk$
declare
  v_def text;

  v_sel_old text := $q$  select i.*, jw.job_id, jw.week_start as wk, jw.invoice_no,
         j.qb_customer_name, j.billing_type as jbilling, j.company_rep$q$;
  v_sel_new text := $q$  select i.*, jw.job_id, jw.week_start as wk, jw.invoice_no, jw.is_final,
         j.qb_customer_name, j.billing_type as jbilling, j.company_rep$q$;

  v_ret_old text := $q$    'invoice_no',    nullif(btrim(coalesce(v.invoice_no,'')),''),$q$;
  v_ret_new text := $q$    'invoice_no',    nullif(btrim(coalesce(v.invoice_no,'')),''),
    'final_invoice', coalesce(v.is_final, false),$q$;
begin
  select pg_get_functiondef('public.invoice_backup_payload(uuid)'::regprocedure) into v_def;

  if position('final_invoice' in v_def) > 0 then
    raise notice 'invoice_backup_payload already carries the final flag; leaving it alone';
    return;
  end if;

  if position(v_sel_old in v_def) = 0 or position(v_ret_old in v_def) = 0 then
    raise exception
      'STOP: invoice_backup_payload does not read as expected. Nothing has been changed.';
  end if;

  v_def := replace(v_def, v_sel_old, v_sel_new);
  v_def := replace(v_def, v_ret_old, v_ret_new);
  execute v_def;
end
$bk$;

notify pgrst, 'reload schema';
