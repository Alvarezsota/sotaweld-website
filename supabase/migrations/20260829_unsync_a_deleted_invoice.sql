-- A week can come back when the invoice behind it is gone.
--
-- job_weeks_no_unsync refuses to move a week off 'synced' and tells the office
-- to reverse it in QuickBooks first. That guard is right: a week unlocked while
-- its invoice is still on their books is a second invoice waiting to happen.
--
-- But it has no way of knowing when the reversal has actually happened. Delete
-- invoice 2982 over there and the portal still holds qb_invoice_id 2174, still
-- reads synced, and still refuses to be touched -- a pointer to a document that
-- does not exist, and no way back short of editing the table by hand.
--
-- So the guard stays and gains a door: a named function that opens it for one
-- statement, in one transaction, and logs what it did. Nothing else can move a
-- synced week, and the ordinary UPDATE path is refused exactly as before.
--
-- The caller is responsible for having established that the invoice is gone.
-- qb-push-invoice does that by asking QuickBooks before it calls this.

create or replace function public.tg_job_weeks_no_unsync()
returns trigger
language plpgsql
as $function$
begin
  -- The flag is transaction-local and set only by unsync_job_week, so it cannot
  -- be left switched on for the next statement or leak across a pooled session.
  if old.status = 'synced' and new.status <> 'synced'
     and coalesce(current_setting('sota.unsync_ok', true), '') <> '1' then
    raise exception
      'This week has been synced to QuickBooks and cannot be unlocked here. Reverse it in QuickBooks first.';
  end if;
  return new;
end;
$function$;

-- Puts a week back to approved after its invoice has been deleted in QuickBooks.
-- The number is deliberately kept: it was spent, it is on nothing now, and the
-- week should go back out under it rather than burn a second one.
create or replace function public.unsync_job_week(p_job_week_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_before record;
begin
  select id, invoice_no, status, qb_invoice_id, qb_invoice_total
    into v_before
  from job_weeks where id = p_job_week_id;

  if v_before is null then
    return jsonb_build_object('ok', false, 'error', 'job week not found');
  end if;
  if v_before.status <> 'synced' then
    return jsonb_build_object('ok', true, 'changed', false,
      'note', format('That week is already "%s". Nothing to undo.', v_before.status));
  end if;

  perform set_config('sota.unsync_ok', '1', true);

  update job_weeks
     set qb_invoice_id = null,
         qb_invoice_total = null,
         qb_pushed_at = null,
         status = 'approved'
   where id = p_job_week_id;

  insert into qb_push_log (job_week_id, action, status, qb_invoice_id, amount, detail)
  values (p_job_week_id, 'unsync', 'sent',
          v_before.qb_invoice_id, v_before.qb_invoice_total,
          coalesce(nullif(btrim(coalesce(p_reason, '')), ''),
                   'invoice deleted in QuickBooks')::text);

  return jsonb_build_object(
    'ok', true, 'changed', true,
    'invoice_no', v_before.invoice_no,
    'was_on_quickbooks_invoice', v_before.qb_invoice_id,
    'status', 'approved');
end;
$function$;

revoke all on function public.unsync_job_week(uuid, text) from public, anon;
grant execute on function public.unsync_job_week(uuid, text) to service_role;
