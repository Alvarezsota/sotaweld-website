-- Sending a held-open invoice has to take the weeks that billed onto it.
--
-- ---------------------------------------------------------------------------
-- WHAT WENT WRONG
-- ---------------------------------------------------------------------------
--
-- James Lake PSV. Aug 20 and Aug 23 on one week, the last 4 hours on Sep 04,
-- the week of 08-17 holding the invoice open so the two would bill together.
-- They do bill together -- and then there is no way to send it.
--
-- The Approvals page offers no push on a week whose invoice is open. It says
-- "close the invoice above when the job is done, and it can be sent", which is
-- the trap: billing_week_for finds the later work by looking for an OPEN week,
-- so closing it is what un-joins the very hours you closed it to send. Close
-- and the invoice drops back to its own week. Leave it open and there is no
-- button. The job cannot be finished either way.
--
-- Underneath that is the real fault: the join was only ever a live calculation.
-- Even if the button existed, pushing sets qb_invoice_id, billing_week_for
-- skips a week that has been pushed, and the moment the invoice went over there
-- the later weeks would have come loose again -- approved, unnumbered, looking
-- unbilled, and ready to take a second number for work already on 2987.
--
-- ---------------------------------------------------------------------------
-- HOW IT WORKS NOW
-- ---------------------------------------------------------------------------
--
-- The join stops being a calculation at the moment it stops being true. When a
-- week that was holding its invoice open is pushed, every later week that was
-- billing onto it is written down as billed on it: the invoice number, synced,
-- and a pointer home. Nothing has to be recomputed afterwards, and nothing can
-- quietly come loose.
--
-- The QuickBooks id is NOT copied. qb_invoice_id is unique across job_weeks --
-- one row per real invoice over there -- and it is what reconcile reads when it
-- asks QuickBooks whether an invoice still exists. A child holding a copy would
-- both break the constraint and make one deleted invoice look like three. The
-- pointer home is what says where the work went; the parent alone holds the id.
--
-- It reverses too. Unsync the parent -- which is what happens when the invoice
-- is deleted in QuickBooks -- and the children come back with it: approved,
-- unnumbered, and the parent open again, which is exactly where they all stood
-- before the push.
--
-- The hold clears itself on the way out. An invoice that has been sent is not
-- open, and the tick that made it so has no further work to do.
--
-- This lives in a trigger rather than in the push function on purpose. The rule
-- is about what the row means, not about who wrote it, and the push function is
-- one plain update away from the same mistake being made again by hand.
--
-- The button is the other half of this, in employee/approvals.js: a held-open
-- week now offers Preview invoice & send like any other approved week.
--
-- Safe to re-run.

alter table public.job_weeks
  add column if not exists billed_on_job_week_id uuid
    references public.job_weeks(id) on delete set null;

comment on column public.job_weeks.billed_on_job_week_id is
  'This week''s work went out on another week''s invoice -- the week that was holding it open when it was pushed. Set once, at push time, so the link does not depend on invoice_open still being true.';

create index if not exists job_weeks_billed_on_idx
  on public.job_weeks (billed_on_job_week_id)
  where billed_on_job_week_id is not null;

create or replace function public.tg_job_weeks_carry_the_open_invoice()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_carried int;
begin
  -- ---- the invoice went out --------------------------------------------
  if new.qb_invoice_id is not null then
    -- Only a week that was holding its invoice open has anything hanging off
    -- it. Every other push is one week, one invoice, and nothing to carry.
    if not coalesce(old.invoice_open, false) then
      return null;
    end if;

    -- Every later week of this job that had not been invoiced. While this week
    -- was open, billing_week_for sent all of them here -- it takes the earliest
    -- open week, so none of them can have been pointed anywhere else.
    --
    -- No qb_invoice_id: it is unique, one row per invoice over there, and it is
    -- what reconcile checks against QuickBooks. The pointer home carries the
    -- meaning without pretending there are three invoices.
    update job_weeks child
       set invoice_no            = new.invoice_no,
           status                = 'synced',
           qb_pushed_at          = new.qb_pushed_at,
           synced_at             = coalesce(new.synced_at, new.qb_pushed_at, now()),
           invoice_open          = false,
           billed_on_job_week_id = new.id
     where child.job_id = new.job_id
       and child.week_start > new.week_start
       and child.qb_invoice_id is null
       and child.billed_on_job_week_id is null
       and child.id <> new.id;

    get diagnostics v_carried = row_count;

    -- Sent, so no longer open. This re-enters the trigger for this row and the
    -- WHEN clause turns it away, because qb_invoice_id is already set by then.
    update job_weeks set invoice_open = false where id = new.id;

    if v_carried > 0 then
      raise notice 'invoice % carried % later week(s) of job %',
        coalesce(new.invoice_no, new.qb_invoice_id), v_carried, new.job_id;
    end if;
    return null;
  end if;

  -- ---- the invoice came back -------------------------------------------
  -- unsync_job_week, off the back of an invoice deleted in QuickBooks. The
  -- children were only ever billed because this one was; put them back.
  if not exists (select 1 from job_weeks c where c.billed_on_job_week_id = new.id) then
    return null;
  end if;

  -- REOPEN FIRST, AND THEN RELEASE THEM. Order is not a detail here.
  --
  -- Sending a child back to 'approved' wakes tg_job_weeks_number_on_approve,
  -- which hands an unnumbered approved week the next invoice number -- unless
  -- billing_week_for says its work bills on some other week. That check is the
  -- only thing standing between an unsync and two invoice numbers spent on work
  -- that is already on one bill, and it only answers correctly once this week
  -- is open again. Release the children first and they take real numbers off
  -- the counter on their way past. Found exactly that way, on a scratch job.
  update job_weeks set invoice_open = true where id = new.id;

  update job_weeks child
     set invoice_no            = null,
         status                = 'approved',
         qb_pushed_at          = null,
         synced_at             = null,
         billed_on_job_week_id = null
   where child.billed_on_job_week_id = new.id;

  get diagnostics v_carried = row_count;
  raise notice 'invoice % released % later week(s) of job %',
    coalesce(old.invoice_no, old.qb_invoice_id), v_carried, new.job_id;

  return null;
end;
$function$;

comment on function public.tg_job_weeks_carry_the_open_invoice() is
  'When a week holding its invoice open is pushed, marks the later weeks that billed onto it as billed on it -- and releases them again if that invoice is unsynced.';

drop trigger if exists job_weeks_carry_the_open_invoice on public.job_weeks;
create trigger job_weeks_carry_the_open_invoice
  after update on public.job_weeks
  for each row
  when (old.qb_invoice_id is distinct from new.qb_invoice_id)
  execute function public.tg_job_weeks_carry_the_open_invoice();

notify pgrst, 'reload schema';
