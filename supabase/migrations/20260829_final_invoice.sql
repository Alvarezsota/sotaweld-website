-- "This is the last one for this job."
--
-- A customer receiving a weekly invoice has no way of knowing whether another
-- is coming. Marking the week final says so on the bill itself, so their
-- accounts can close the job out instead of holding it open waiting for one
-- that never arrives -- which is a phone call we get instead of a payment.
--
-- It is a property of the week, not the job: a job can go quiet for a month and
-- come back. The week that was the last one carries the mark, and unticking it
-- takes the mark off again.
--
-- Applied to the live project on 2026-08-31 in two steps, the second repairing
-- the first. Both are kept here because the repair is the interesting half.

alter table public.job_weeks
  add column if not exists is_final boolean not null default false;

comment on column public.job_weeks.is_final is
  'Marks this week''s invoice as the last one for the job, so the customer can close it out. Shown on the invoice and on the preview before it is sent.';

-- ---------------------------------------------------------------------------
-- THE PAYLOAD CARRIES IT
-- ---------------------------------------------------------------------------
--
-- Patched from the definition actually running rather than pasted from a copy,
-- so nothing another change added to it is quietly reverted, and it refuses
-- rather than guessing if the shape is not what was expected.
--
-- The first attempt added 'final_invoice', coalesce(v.is_final, false) to what
-- the function returns and stopped there, on the assumption that v held the
-- whole job_weeks row. It does not -- it is a named list of columns -- so every
-- call raised
--
--     record "v" has no field "is_final"
--
-- which is every invoice preview and every push, for about a minute, until
-- jw.is_final was added to the select. A field has to be selected before it can
-- be returned, and "add it to the output" is only ever half the change.

do $rebuild$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'qb_invoice_payload';

  if v_def is null then
    raise exception 'STOP: qb_invoice_payload not found. Nothing has been changed.';
  end if;

  -- Select it first.
  if position('jw.is_final' in v_def) = 0 then
    if position('j.billing_type as jbilling, jw.invoice_no' in v_def) = 0 then
      raise exception 'STOP: the select list is not what this expected. Nothing has been changed.';
    end if;
    v_def := replace(v_def,
      'j.billing_type as jbilling, jw.invoice_no',
      'j.billing_type as jbilling, jw.invoice_no, jw.is_final');
  end if;

  -- Then return it.
  if position('final_invoice' in v_def) = 0 then
    if position('''transaction_date''' in v_def) = 0 then
      raise exception 'STOP: the returned object is not what this expected. Nothing has been changed.';
    end if;
    v_def := replace(v_def, '''transaction_date''',
      '''final_invoice'', coalesce(v.is_final, false),
    ''transaction_date''');
  end if;

  execute v_def;
end
$rebuild$;

notify pgrst, 'reload schema';

select
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='job_weeks' and column_name='is_final') as flag_added,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='qb_invoice_payload'
      and pg_get_functiondef(p.oid) like '%jw.is_final%'
      and pg_get_functiondef(p.oid) like '%final_invoice%') as payload_selects_and_returns_it;
