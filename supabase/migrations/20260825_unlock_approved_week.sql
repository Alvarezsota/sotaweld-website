-- Unlocking an approved week, so a mistake found after approval can be fixed.
--
-- Applied to production 2026-08-25.
--
-- Approved is not final. Nothing has gone to QuickBooks at that point, so a wrong
-- rate or a missed ticket is still just a mistake; it becomes expensive only once
-- the invoice is over there. The Approvals page now offers "Unlock to edit" on an
-- approved week, and does not offer it on a synced one.
--
-- ---------------------------------------------------------------------------
-- WHY THE FILING CLAIM HAS TO BE RELEASED
-- ---------------------------------------------------------------------------
--
-- Approving the last job of a week files that week's pay statements to OneDrive.
-- The onedrive_file_log row recording that is also the lock which stops two
-- approvals filing the same week twice - it is claimed with
-- "on conflict do nothing".
--
-- That lock is right within one approval and wrong across an unlock. Left alone, a
-- week unlocked, corrected and approved again would find its claim already taken,
-- quietly skip the filing, and leave the statements in OneDrive showing the
-- numbers from before the correction. Nothing on screen would suggest it: the week
-- says approved and the folder has files in it. Somebody gets paid off the old
-- sheet.
--
-- So unlocking deletes the row, and this policy is what lets the page do it. The
-- row is a record of a filing that is about to be superseded; the next approval
-- writes it again.
drop policy if exists onedrive_file_log_delete_admin on public.onedrive_file_log;
create policy onedrive_file_log_delete_admin on public.onedrive_file_log
  for delete using (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- A SYNCED WEEK IS NOT UNLOCKABLE, AND NOT ONLY IN THE BROWSER
-- ---------------------------------------------------------------------------
--
-- Once an invoice is in QuickBooks the money has left this system's control.
-- Reopening the week behind it would put the two out of step with nothing on
-- either side saying so, and the disagreement would surface whenever somebody
-- next compared them - probably at month end, probably not calmly.
--
-- The page only shows the button on 'approved'. This is the second lock, so the
-- rule holds even if a future page forgets, or somebody reaches the table another
-- way. It refuses in words a person can act on rather than a constraint name.
create or replace function public.tg_job_weeks_no_unsync()
returns trigger
language plpgsql
as $function$
begin
  if old.status = 'synced' and new.status <> 'synced' then
    raise exception
      'This week has been synced to QuickBooks and cannot be unlocked here. Reverse it in QuickBooks first.';
  end if;
  return new;
end;
$function$;

drop trigger if exists job_weeks_no_unsync on public.job_weeks;
create trigger job_weeks_no_unsync
  before update on public.job_weeks
  for each row execute function public.tg_job_weeks_no_unsync();

-- Both paths tested at the database, not just through the page:
--   approved -> open   allowed
--   synced   -> open   refused, with that message
