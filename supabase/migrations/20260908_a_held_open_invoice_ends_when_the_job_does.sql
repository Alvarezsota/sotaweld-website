-- An invoice held open across weeks should be dated when the work stopped.
--
-- ---------------------------------------------------------------------------
-- WHAT WENT WRONG
-- ---------------------------------------------------------------------------
--
-- Invoice 2987, James Lake PSV. The week of 08-17 was approved and numbered,
-- then the job was left to finish: 4 more hours on 09-04. Those hours did land
-- on 2987 once that week was told to hold its invoice open -- billing_week_for
-- already does that job and does it correctly.
--
-- But week_end did not move. It is week_start + 6 everywhere, so an invoice
-- covering work through 09-04 still called itself the week of 08-17 to 08-23,
-- and -- worse -- was dated 08-23, because transaction_date is week_end. On
-- Net 30 that starts the customer's clock twelve days before the job was
-- finished, and puts a date on the bill that is earlier than work on it.
--
-- ---------------------------------------------------------------------------
-- HOW IT WORKS NOW
-- ---------------------------------------------------------------------------
--
-- week_end is the last day actually billed on that invoice, or the end of the
-- week, whichever is later. For every invoice that is not held open those are
-- the same day and nothing changes at all -- the work in a week ends inside it.
-- Only a held-open invoice moves, and it moves to the truth.
--
-- The wording follows: a bill covering three weeks does not say "week of".
--
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. The view
-- ---------------------------------------------------------------------------
--
-- create or replace keeps the column list and its order, so week_end stays the
-- second column and stays a date. Everything reading this view goes on reading
-- the same shape.

do $view$
declare
  v_def text;
  v_old text := $q$k.week_start + 6 AS week_end,$q$;
  v_new text := $q$GREATEST(k.week_start + 6, ( SELECT max(w.entry_date) AS max
           FROM v_work_lines_billing w
          WHERE w.week_start = k.week_start AND w.bill_job_id = k.job_id)) AS week_end,$q$;
begin
  select pg_get_viewdef('public.v_week_job_invoice'::regclass, true) into v_def;

  if position('GREATEST(k.week_start + 6' in v_def) > 0 then
    raise notice 'v_week_job_invoice already ends where the work does; leaving it alone';
    return;
  end if;
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception
      'STOP: expected the week_end expression exactly once in v_week_job_invoice. Nothing has been changed.';
  end if;

  execute 'create or replace view public.v_week_job_invoice as ' || replace(v_def, v_old, v_new);
end
$view$;

comment on view public.v_week_job_invoice is
  'One row per job week for billing. week_end is the last day billed on that invoice -- the end of the week for an ordinary one, later for a week holding its invoice open.';

-- ---------------------------------------------------------------------------
-- 2. What the invoice calls itself
-- ---------------------------------------------------------------------------
--
-- Three places said "week of" about a period that may no longer be a week: the
-- two labour lines and the memo. One phrase, worked out once, used by all three.

do $qb$
declare
  v_def text;

  v_decl_old text := $q$  v_we   text;
begin$q$;
  v_decl_new text := $q$  v_we   text;
  v_span text;
begin$q$;

  v_span_old text := $q$  v_we := to_char(v.week_end,   'MM-DD-YYYY');
$q$;
  v_span_new text := $q$  v_we := to_char(v.week_end,   'MM-DD-YYYY');

  -- A held-open invoice covers more than its week, and must not claim otherwise.
  v_span := case when v.week_end > v.week_start + 6
                 then format('work of %s to %s', v_ws, v_we)
                 else format('week of %s', v_ws) end;
$q$;

  v_weld_old text := $q$'Welder labor - %s, week of %s', v.job_name, v_ws$q$;
  v_weld_new text := $q$'Welder labor - %s, %s', v.job_name, v_span$q$;

  v_help_old text := $q$'Helper labor - %s, week of %s', v.job_name, v_ws$q$;
  v_help_new text := $q$'Helper labor - %s, %s', v.job_name, v_span$q$;

  v_memo_old text := $q$format('%s - week of %s to %s%s',
                        v.job_name, v_ws, v_we,$q$;
  v_memo_new text := $q$format('%s - %s%s',
                        v.job_name, v_span,$q$;
begin
  select pg_get_functiondef('public.qb_invoice_payload(uuid)'::regprocedure) into v_def;

  if position('v_span' in v_def) > 0 then
    raise notice 'qb_invoice_payload already spans a held-open invoice; leaving it alone';
    return;
  end if;

  if position(v_decl_old in v_def) = 0
     or position(v_span_old in v_def) = 0
     or position(v_weld_old in v_def) = 0
     or position(v_help_old in v_def) = 0
     or position(v_memo_old in v_def) = 0 then
    raise exception
      'STOP: qb_invoice_payload does not read as expected. Nothing has been changed.';
  end if;

  v_def := replace(v_def, v_decl_old, v_decl_new);
  v_def := replace(v_def, v_span_old, v_span_new);
  v_def := replace(v_def, v_weld_old, v_weld_new);
  v_def := replace(v_def, v_help_old, v_help_new);
  v_def := replace(v_def, v_memo_old, v_memo_new);

  execute v_def;
end
$qb$;

notify pgrst, 'reload schema';
