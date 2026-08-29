-- Month, day, year, on the invoice and on the page that sends it.
--
-- Three dates were showing as 2026-08-17. One is on screen and two are on the
-- invoice itself:
--
--   the preview's "dated ..."      on screen, fixed in invoice-preview.js
--   the memo                        PrivateNote in QuickBooks
--   the labour line descriptions    printed on the invoice the customer reads
--
-- The last is the one that matters. "Welder labor - MasTec Industrial, week of
-- 2026-08-17" is the line an accounts department reads, and it is the only date
-- on it. The crew sheet attached beside it and the pay statements have always
-- said 08-17-2026, so the invoice was the odd one out.
--
-- ---------------------------------------------------------------------------
-- transaction_date IS NOT TOUCHED, ON PURPOSE
-- ---------------------------------------------------------------------------
--
-- It goes to QuickBooks as TxnDate and their API takes YYYY-MM-DD. Formatting
-- it here would put a date on every invoice that QuickBooks either rejects or
-- reads as some other day. It stays ISO in the payload and is turned round only
-- where it is drawn, which is the whole reason the two are separate fields.
--
-- week_start and week_end are left alone for the same kind of reason: the crew
-- sheet reads them as dates and does its own formatting.

create or replace function public.qb_invoice_payload(p_job_week_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v      record;
  lines  jsonb := '[]'::jsonb;
  v_wh   numeric; v_wb numeric;
  v_hh   numeric; v_hb numeric;
  b      record;
  v_inv  text;
  v_peek text;
  v_ws   text;          -- the week, written the way it is read
  v_we   text;
begin
  select i.*, jw.job_id, jw.week_start as jw_week, j.qb_customer_id, j.qb_customer_name,
         j.billing_type as jbilling, jw.invoice_no
    into v
  from job_weeks jw
  join jobs j on j.id = jw.job_id
  join v_week_job_invoice i on i.job_id = jw.job_id and i.week_start = jw.week_start
  where jw.id = p_job_week_id;

  if v is null then
    return jsonb_build_object('error', 'job week not found or nothing logged that week');
  end if;

  v_ws := to_char(v.week_start, 'MM-DD-YYYY');
  v_we := to_char(v.week_end,   'MM-DD-YYYY');

  if v.qb_customer_id is null then
    return jsonb_build_object('error',
      format('job "%s" has no QuickBooks customer mapped', v.job_name));
  end if;
  if coalesce(v.total_billed, 0) <= 0 then
    return jsonb_build_object('error',
      format('nothing billable for %s week of %s', v.job_name, v_ws));
  end if;

  if v.jbilling = 'hourly' then
    select coalesce(sum((e->>'hours')::numeric), 0),
           coalesce(sum((e->>'billed')::numeric), 0)
      into v_wh, v_wb
    from jsonb_array_elements(week_job_detail(v.week_start, v.job_id)) e
    where e->>'kind' = 'welder' and (e->>'on_invoice') is distinct from 'false';

    select coalesce(sum((e->>'hours')::numeric), 0),
           coalesce(sum((e->>'billed')::numeric), 0)
      into v_hh, v_hb
    from jsonb_array_elements(week_job_detail(v.week_start, v.job_id)) e
    where e->>'kind' = 'helper' and (e->>'on_invoice') is distinct from 'false';

    if v_wb > 0 then
      lines := lines || jsonb_build_object(
        'item', jsonb_build_object('id','14'),
        'description', format('Welder labor - %s, week of %s', v.job_name, v_ws),
        'quantity', to_char(v_wh, 'FM9999990.00'),
        'unit_price', to_char(round(v_wb / nullif(v_wh,0), 2), 'FM9999990.00'),
        'amount', to_char(v_wb, 'FM9999990.00'));
    end if;

    if v_hb > 0 then
      lines := lines || jsonb_build_object(
        'item', jsonb_build_object('id','15'),
        'description', format('Helper labor - %s, week of %s', v.job_name, v_ws),
        'quantity', to_char(v_hh, 'FM9999990.00'),
        'unit_price', to_char(round(v_hb / nullif(v_hh,0), 2), 'FM9999990.00'),
        'amount', to_char(v_hb, 'FM9999990.00'));
    end if;
  else
    for b in
      select e->>'description' as descr,
             (e->>'qty_completed')::numeric as qty,
             (e->>'unit_price')::numeric as price,
             (e->>'amount')::numeric as amt,
             e->>'unit' as unit
      from jsonb_array_elements(week_job_bid_detail(v.week_start, v.job_id)) e
    loop
      if coalesce(b.amt,0) <> 0 then
        lines := lines || jsonb_build_object(
          'item', jsonb_build_object('id','1010000001'),
          'description', format('%s (%s %s)', b.descr, to_char(b.qty,'FM9999990.##'), coalesce(b.unit,'ea')),
          'quantity', to_char(b.qty, 'FM9999990.00'),
          'unit_price', to_char(b.price, 'FM9999990.00'),
          'amount', to_char(b.amt, 'FM9999990.00'));
      end if;
    end loop;
  end if;

  if coalesce(v.per_diem_amount, 0) > 0 then
    lines := lines || jsonb_build_object(
      'item', jsonb_build_object('id','16'),
      'description', format('Per diem - %s crew over %s days on site',
                            v.per_diem_crew, v.per_diem_days),
      'quantity', to_char(v.per_diem_person_days, 'FM9999990.00'),
      'unit_price', to_char(v.per_diem_rate, 'FM9999990.00'),
      'amount', to_char(v.per_diem_amount, 'FM9999990.00'));
  end if;

  if coalesce(v.parts_amount, 0) > 0 then
    lines := lines || jsonb_build_object(
      'item', jsonb_build_object('id','1010000001'),
      'description', 'Parts / materials',
      'amount', to_char(v.parts_amount, 'FM9999990.00'));
  end if;

  if coalesce(v.flat_amount, 0) > 0 then
    lines := lines || jsonb_build_object(
      'item', jsonb_build_object('id','1010000001'),
      'description', 'Additional / adjustment',
      'amount', to_char(v.flat_amount, 'FM9999990.00'));
  end if;

  v_inv  := nullif(trim(coalesce(v.invoice_no, '')), '');
  select (next_no)::text into v_peek from invoice_counter where id = 1;

  return jsonb_build_object(
    'job_week_id',   p_job_week_id,
    'job_name',      v.job_name,
    'week_start',    v.week_start,
    'week_end',      v.week_end,
    'status',        v.status,
    'billing_type',  v.jbilling,
    'customer',      jsonb_build_object('id', v.qb_customer_id),
    'customer_name', v.qb_customer_name,
    'invoice_no',    v_inv,
    'next_invoice_no', v_peek,
    'memo',          format('%s - week of %s to %s%s',
                        v.job_name, v_ws, v_we,
                        case when v.bid_number is not null
                             then ' - Bid #' || v.bid_number else '' end),
    -- ISO, deliberately. QuickBooks reads this as TxnDate.
    'transaction_date', v.week_end,
    'lines',         lines,
    'expected_total', v.total_billed,
    'lines_total',   (select coalesce(sum((l->>'amount')::numeric),0)
                      from jsonb_array_elements(lines) l)
  );
end;
$function$;
