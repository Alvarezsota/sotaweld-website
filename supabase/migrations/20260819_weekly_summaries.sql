-- Weekly summaries: invoices by job, payroll by welder and helper.
--
-- The full DDL for this system was applied through Supabase's migration history
-- (18 migrations dated 2026-08-19, from `weekly_summary_base_views` through
-- `week_summary_carries_warnings`). That history is the source of truth and is
-- what `supabase db pull` will reproduce. This file adds the realtime publication
-- the Summary page needs, and documents the rules the math follows so the next
-- person reading this repo doesn't have to reverse-engineer them from SQL.
--
-- ---------------------------------------------------------------------------
-- THE TWO RULES THAT SURPRISE PEOPLE
-- ---------------------------------------------------------------------------
--
-- 1. Per diem is PAID once per person per day, but BILLED once per job per day.
--
--    A welder who works six hours on Vaquero and six on Targa collects one $100
--    per diem. Both customers are charged $100. The spread is margin, not an
--    error, and the Summary page shows both numbers side by side.
--
--    Paid   -> v_per_diem_days_by_person  (distinct person + date)
--    Billed -> v_per_diem_days_by_job     (distinct person + date + billing job)
--    Cost   -> v_per_diem_cost_alloc      (the paid per diem split across the
--                                          jobs it covered, so job costs still
--                                          sum to real payroll)
--
--    This also means two tickets for the same person, same day never double a
--    per diem. It does NOT dedupe hours -- see v_possible_duplicate_tickets.
--
-- 2. Hours have two different owners: who pays, and who gets billed.
--
--    bill_job_id -> revenue. Yard and shop hours move to the "for job" ONLY when
--                   that job is billed hourly. Hard-bid work stays on its own
--                   invoice because the customer is invoiced off the bid, not
--                   the clock.
--    cost_job_id -> labor cost. Always follows the "for job", so a hard bid
--                   carries the yard hours spent on it and margin stays honest.
--
--    Both live on v_work_lines, one row per person per ticket.
--
-- ---------------------------------------------------------------------------
-- OBJECTS
-- ---------------------------------------------------------------------------
--
-- Views
--   v_work_lines                 one row per person per ticket, with rates
--   v_per_diem_days_by_job       per diem as billed
--   v_per_diem_days_by_person    per diem as paid
--   v_per_diem_cost_alloc        paid per diem allocated across jobs
--   v_week_job_parts             parts/materials rolled to job + week
--   v_week_bid_billing           bid dollars completed in a week
--   v_job_bid_status             bid vs completed to date, per line item
--   v_week_job_invoice           the invoice per job per week
--   v_week_welder_summary        welder payroll per week
--   v_week_helper_summary        helper payroll per week
--   v_possible_duplicate_tickets same welder + job + day, more than one ticket
--
-- Tables
--   week_summaries               frozen snapshots, written on approval
--   job_bid_items                what you bid: description, qty, unit price
--   job_week_bid_progress        how much of each bid line finished, per week
--   summary_email_recipients     who gets the weekly crew email
--   summary_email_log            what went out and when
--   app_settings                 company_name, email on/off, hook secret
--
-- Admin RPCs (all gated on is_admin(auth.uid()))
--   get_week_summary(week, snapshot?)   everything for a week, incl. warnings
--   get_job_week_invoice(job, week)     one job's invoice with daily lines
--   get_job_bid_status(job)             bid vs completed to date
--   set_bid_progress(item, week, qty)   record completed quantity
--   upsert_bid_item(...)                add or edit a bid line item
--   set_job_bid_number(job, number)     the bid number shown on the invoice
--   rebuild_week_summaries(week)        regenerate after editing a ticket
--   list_summary_weeks()                weeks that have anything in them
--   get_duplicate_tickets(week?)        the duplicate warnings
--
-- Triggers on job_weeks
--   job_week_generate_summaries  writes week_summaries when a week is approved
--   job_week_email_summaries     posts to the week-summary-email function.
--                                No-op while app_settings.summary_emails_enabled
--                                is 'false', which is where it ships.
--
-- Edge functions
--   week-invoice        printable invoice; &internal=1 adds cost and margin
--   week-summary-email  the crew email; sends nothing until a Resend key and
--                       at least one active recipient exist
--
-- ---------------------------------------------------------------------------

-- Publish the new tables so the Summary page updates as bid progress is entered.
-- Safe to re-run: each table is added only if it isn't published already.
do $$
declare
  t text;
begin
  foreach t in array array[
    'job_bid_items',
    'job_week_bid_progress',
    'week_summaries'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Confirmation: expect all three.
select tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename in ('job_bid_items', 'job_week_bid_progress', 'week_summaries')
order by tablename;
