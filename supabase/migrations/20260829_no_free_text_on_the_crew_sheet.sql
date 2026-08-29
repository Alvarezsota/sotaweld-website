-- The customer's sheet stops carrying what a man typed on his phone.
--
-- A MasTec ticket read "Welded with esben / Also helped at the yard in the
-- valtek bench". True, useful to the office, and none of MasTec's business --
-- and the crew sheet printed it on the document attached to MasTec's invoice.
--
-- The words were not wrong and nobody wrote them for a customer. They are the
-- end-of-day note a welder types on a phone, and the yard half of that day was
-- correctly logged to Shop on its own ticket. The fault is not the text, it is
-- that a customer-facing document was reading a field written for internal use.
--
-- So it stops being selected, the same way a pay rate is not selected. Not
-- filtered downstream, not blanked in the drawing code -- never fetched. There
-- is no version of this payload that carries it and a switch that hides it.
--
-- What goes: the typed description, and worked_at -- the name of whatever other
-- job a man passed through that day, which is another customer's business for
-- the same reason.
--
-- What stays: names, roles, days, hours, billed rates, per diem, amounts, and
-- the stainless flag, which is a fact about the rate on the line.

create or replace function public.invoice_backup_payload(p_job_week_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v       record;
  v_days  jsonb;
  v_crew  jsonb;
  v_labor numeric;
  v_pd    numeric;
  v_pdd   numeric;
  v_wh    numeric;
  v_hh    numeric;
begin
  select i.*, jw.job_id, jw.week_start as wk, jw.invoice_no,
         j.qb_customer_name, j.billing_type as jbilling
    into v
  from job_weeks jw
  join jobs j on j.id = jw.job_id
  join v_week_job_invoice i on i.job_id = jw.job_id and i.week_start = jw.week_start
  where jw.id = p_job_week_id;

  if v is null then
    return jsonb_build_object('error', 'job week not found or nothing logged that week');
  end if;

  with src as (
    select wl.entry_id, wl.entry_date, wl.person_kind, wl.person_id, wl.person_name,
           wl.hours, wl.bill_rate, wl.is_stainless,
           round(wl.hours * wl.bill_rate, 2) as billed,
           wl.per_diem_flag, wl.per_diem_rate,
           row_number() over (partition by wl.person_kind, wl.person_id,
                                           wl.entry_date, wl.per_diem_flag
                              order by wl.per_diem_rate desc, wl.entry_id) as nth
    from v_work_lines wl
    where wl.week_start = v.wk and wl.bill_job_id = v.job_id
  ), lines as (
    select s.*,
           (s.per_diem_flag and s.nth = 1) as pd,
           case when s.per_diem_flag and s.nth = 1 then s.per_diem_rate else 0 end as pd_amount
    from src s
  ), day_rows as (
    select l.entry_date,
           jsonb_agg(jsonb_build_object(
             'name', l.person_name, 'kind', l.person_kind,
             'hours', l.hours, 'bill_rate', l.bill_rate,
             'per_diem', l.pd, 'per_diem_rate', l.pd_amount,
             'billed', l.billed, 'stainless', l.is_stainless)
             order by (l.person_kind = 'helper'), l.person_name) as lines
    from lines l
    group by l.entry_date
  ), crew_rows as (
    select l.person_kind as kind, max(l.person_name) as name,
           count(distinct l.entry_date) as days,
           sum(l.hours) as hours,
           count(*) filter (where l.pd) as per_diem_days,
           sum(l.pd_amount) as per_diem_amount,
           sum(l.billed) + sum(l.pd_amount) as amount
    from lines l
    group by l.person_kind, l.person_id
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object('date', d.entry_date, 'lines', d.lines)
                order by d.entry_date) from day_rows d), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object(
                'name', c.name, 'kind', c.kind, 'days', c.days, 'hours', c.hours,
                'per_diem_days', c.per_diem_days, 'per_diem_amount', c.per_diem_amount,
                'amount', c.amount)
                order by (c.kind = 'helper'), c.hours desc, c.name) from crew_rows c), '[]'::jsonb),
    coalesce((select sum(billed) from lines), 0),
    coalesce((select sum(pd_amount) from lines), 0),
    coalesce((select count(*) from lines where pd), 0),
    coalesce((select sum(hours) from lines where person_kind = 'welder'), 0),
    coalesce((select sum(hours) from lines where person_kind = 'helper'), 0)
  into v_days, v_crew, v_labor, v_pd, v_pdd, v_wh, v_hh;

  return jsonb_build_object(
    'job_week_id',   p_job_week_id,
    'job_name',      v.job_name,
    'customer_name', coalesce(v.qb_customer_name, v.bill_to),
    'operator',      v.operator,
    'bill_to',       v.bill_to,
    'billing_type',  v.jbilling,
    'bid_number',    v.bid_number,
    'week_start',    v.wk,
    'week_end',      v.week_end,
    'invoice_no',    nullif(btrim(coalesce(v.invoice_no,'')),''),
    'status',        v.status,
    'invoice_total', v.total_billed,
    'labor_amount',  v_labor,
    'per_diem_amount', v_pd,
    'per_diem_person_days', v_pdd,
    'welder_hours',  v_wh,
    'helper_hours',  v_hh,
    'days',          v_days,
    'crew',          v_crew);
end;
$function$;

revoke all on function public.invoice_backup_payload(uuid) from public, anon;
grant execute on function public.invoice_backup_payload(uuid) to authenticated, service_role;
