-- A day billed on a different week's invoice.
--
-- A job week is one week and an invoice is a job week, so a ticket in another
-- week is another invoice. Right nearly always, wrong at the end of a job: the
-- last day runs into the following week and the customer should get one final
-- bill, not a second invoice for one day.
--
-- The portal already says "this ticket bills somewhere else" with for_job_id,
-- which sends yard work to the job it was for. This is the same idea on the
-- other axis -- which week it bills on rather than which job.
--
-- ---------------------------------------------------------------------------
-- THE WEEK IT WAS WORKED IS NOT THE WEEK IT IS BILLED
-- ---------------------------------------------------------------------------
--
-- Two different things now, and only the billing one moves. A man is paid for
-- the week he actually worked, so the pay statements, the weld log, the per
-- diem allocation and the weekly summaries all keep reading week_start and are
-- untouched. The crew sheet still prints the real date, because that is when
-- the work happened.
--
-- Rather than teach every invoice-side object about a second week -- and
-- v_week_job_invoice alone mentions week_start twenty-seven times -- the
-- invoice side gets its own view of the same rows, in which week_start already
-- IS the billing week. Each consumer then changes by one word: where it reads
-- from. Twenty-seven careful edits become three obvious ones.
--
-- The column list is built from the view itself, so it cannot fall behind when
-- v_work_lines gains a column.
--
-- Safe to re-run.

alter table public.daily_entries
  add column if not exists bill_week_start date;

comment on column public.daily_entries.bill_week_start is
  'Bill this ticket on the invoice for this week instead of its own. Null is the ordinary case. The ticket keeps its real date everywhere else -- pay, the weld log and the crew sheet are all unaffected.';

create index if not exists daily_entries_bill_week_idx
  on public.daily_entries (bill_week_start) where bill_week_start is not null;

do $lines$
declare v_def text;
begin
  select pg_get_viewdef('public.v_work_lines'::regclass, true) into v_def;

  if position('bill_week_start' in v_def) > 0 then
    raise notice 'v_work_lines already carries bill_week_start; leaving it alone';
  else
    if position('de.bid_item_id,' in v_def) = 0 then
      raise exception 'STOP: the base CTE is not what this expected. Nothing has been changed.';
    end if;
    if (length(v_def) - length(replace(v_def, 'AS pay_hours', ''))) / 12 <> 2 then
      raise exception 'STOP: expected two pay_hours columns in v_work_lines. Nothing has been changed.';
    end if;

    v_def := replace(v_def, 'de.bid_item_id,', 'de.bid_item_id,
            de.bill_week_start,');
    v_def := replace(v_def, 'AS pay_hours',
                            'AS pay_hours,
    COALESCE(b.bill_week_start, b.week_start) AS bill_week_start');

    execute 'create or replace view public.v_work_lines as ' || v_def;
  end if;
end
$lines$;

do $billing$
declare cols text;
begin
  select string_agg(
           case column_name
             when 'week_start'      then 'bill_week_start AS week_start'
             when 'bill_week_start' then 'week_start AS worked_week_start'
             else quote_ident(column_name)
           end, ', ' order by ordinal_position)
    into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'v_work_lines';

  if cols is null or position('bill_week_start AS week_start' in cols) = 0 then
    raise exception 'STOP: v_work_lines has no bill_week_start to build on. Nothing has been changed.';
  end if;

  execute 'create or replace view public.v_work_lines_billing as select '
          || cols || ' from public.v_work_lines';
end
$billing$;

comment on view public.v_work_lines_billing is
  'v_work_lines with week_start meaning the week the work is BILLED on. The week it was worked is worked_week_start. Only the invoice side reads this; pay reads v_work_lines.';

-- ---------------------------------------------------------------------------
-- The three that decide what goes on an invoice
-- ---------------------------------------------------------------------------
--
-- v_week_job_invoice builds the totals, week_job_detail lists the lines behind
-- them, invoice_backup_payload draws the crew sheet. Everything else is left
-- alone on purpose, so a day moved onto another invoice does not move pay.

do $swap$
declare
  r      record;
  v_def  text;
  v_hits int;
begin
  for r in
    select 'view' as kind, 'v_week_job_invoice' as name
    union all select 'func', 'week_job_detail'
    union all select 'func', 'invoice_backup_payload'
  loop
    if r.kind = 'view' then
      select pg_get_viewdef(('public.' || r.name)::regclass, true) into v_def;
    else
      select pg_get_functiondef(p.oid) into v_def
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = r.name;
    end if;

    if v_def is null then
      raise exception 'STOP: % not found. Nothing has been changed.', r.name;
    end if;
    if position('v_work_lines_billing' in v_def) > 0 then
      raise notice '% already reads the billing view; leaving it alone', r.name;
      continue;
    end if;

    v_hits := (length(v_def) - length(replace(v_def, 'v_work_lines', ''))) / 12;
    if v_hits = 0 then
      raise exception 'STOP: % does not read v_work_lines. Nothing has been changed.', r.name;
    end if;

    if r.kind = 'view' then
      execute 'create or replace view public.' || quote_ident(r.name) || ' as '
              || replace(v_def, 'v_work_lines', 'v_work_lines_billing');
    else
      execute replace(v_def, 'v_work_lines', 'v_work_lines_billing');
    end if;
  end loop;
end
$swap$;

notify pgrst, 'reload schema';
