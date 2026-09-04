-- The customer's man on the job.
--
-- P66's representative on the RF Fuel line is Roy Ramos. When the invoice and
-- its crew sheet reach the customer's office, whoever opens it needs to know
-- whose job it was on their side - otherwise it goes round the building looking
-- for an owner, and an invoice looking for an owner is an invoice sitting
-- unpaid.
--
-- On the job rather than on the customer, because it changes per job. P66 has
-- several running and they are not all Roy's.
--
-- Every job gets the field. Empty is the normal case and prints nothing.
--
-- Safe to re-run.

alter table public.jobs
  add column if not exists company_rep text;

comment on column public.jobs.company_rep is
  'The customer''s representative on this job - their man, not ours. Prints on the crew sheet that goes out attached to the invoice.';

-- Patched from the definition actually running rather than rewritten, so
-- nothing else in a 90-line function can drift while one line is added.
do $patch$
declare
  v_def text;
  v_sel_old text := 'j.qb_customer_name, j.billing_type as jbilling';
  v_sel_new text := 'j.qb_customer_name, j.billing_type as jbilling, j.company_rep';
  v_out_old text := '''operator'',      v.operator,';
  v_out_new text := '''operator'',      v.operator,' || chr(10) || '    ''company_rep'',   nullif(btrim(coalesce(v.company_rep, '''''''')), ''''''''),';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'invoice_backup_payload';

  if v_def is null then
    raise exception 'STOP: invoice_backup_payload not found. Nothing changed.';
  end if;

  if position('company_rep' in v_def) > 0 then
    raise notice 'invoice_backup_payload already carries company_rep; leaving it alone';
    return;
  end if;

  if position(v_sel_old in v_def) = 0 then
    raise exception 'STOP: the select in invoice_backup_payload is not shaped as expected. Nothing changed.';
  end if;
  if position(v_out_old in v_def) = 0 then
    raise exception 'STOP: the output block in invoice_backup_payload is not shaped as expected. Nothing changed.';
  end if;

  v_def := replace(v_def, v_sel_old, v_sel_new);
  v_def := replace(v_def, v_out_old, v_out_new);
  execute v_def;
end
$patch$;

notify pgrst, 'reload schema';
