-- A week invoice used to carry its parts as one anonymous figure:
--
--     Parts / materials                                   283.75
--
-- No quantity, no unit price, nothing naming what was bought. Rocking Double S
-- cannot check that against anything, which is the same complaint that got the
-- letterhead PDF built in the first place -- an invoice that says
-- "Welding Services 1 $4,418.80" tells the customer nothing they can verify.
--
-- It was also booked to item 1010000001, Welding Services. Laser-cut blinds are
-- not welding, and putting them there is the categorisation problem that was
-- fixed on the Parts and Services side and then left standing here.
--
-- So: one line per part, with its description, quantity and unit price, booked
-- to whatever item it names and falling back to Material rather than to
-- Welding Services.
--
-- Found because $283.75 of skid blinds went onto the P66 Viper week and there
-- was nothing on the Approvals screen to show for them. The other half of that
-- -- the screen itself -- is in approvals.js.

alter table public.daily_entry_parts
  add column if not exists qb_item_id text;

comment on column public.daily_entry_parts.qb_item_id is
  'QuickBooks item this part bills under. Null falls back to Material (23), '
  'which is the honest default for a line typed as "parts / materials".';

-- Patched rather than retyped. qb_invoice_payload is two hundred lines that
-- price every invoice this company sends, and reproducing it by hand to change
-- six of them is how a digit goes missing. The anchors are checked before
-- anything is replaced and the whole thing refuses rather than half-applying.
do $mig$
declare
  src     text;
  newsrc  text;
  old_dec constant text := $a$  v_rs   jsonb;$a$;
  new_dec constant text := $b$  v_rs   jsonb;
  v_pa   numeric := 0;
  pr     record;$b$;
  old_parts constant text := $c$  if coalesce(v.parts_amount, 0) > 0 then
    lines := lines || jsonb_build_object(
      'item', jsonb_build_object('id','1010000001'),
      'description', 'Parts / materials',
      'amount', to_char(v.parts_amount, 'FM9999990.00'));
  end if;$c$;
  new_parts constant text := $d$  -- One line per part. Grouped by what it is and what it cost, so a blind
  -- cut on Monday and again on Thursday reads as one line of six rather than
  -- two lines of three. v_week_job_parts keys on week_start alone, so a week
  -- held open past its seventh day still bills the parts of that week only --
  -- this reads them the same way, and the two cannot disagree.
  for pr in
    select dep.description                                as description,
           sum(dep.quantity)                              as quantity,
           dep.rate                                       as rate,
           coalesce(dep.qb_item_id, '23')                 as item_id,
           round(sum(dep.quantity * dep.rate), 2)         as amount
      from daily_entry_parts dep
      join daily_entries de on de.id = dep.daily_entry_id
     where week_start_of(de.entry_date) = v.week_start
       and coalesce(de.for_job_id, de.job_id) = v.job_id
     group by dep.description, dep.rate, coalesce(dep.qb_item_id, '23')
     order by dep.description
  loop
    v_pa := v_pa + pr.amount;
    lines := lines || jsonb_build_object(
      'item', jsonb_build_object('id', pr.item_id),
      'description', pr.description,
      'quantity', to_char(pr.quantity, 'FM9999990.00'),
      'unit_price', to_char(pr.rate, 'FM9999990.00'),
      'amount', to_char(pr.amount, 'FM9999990.00'));
  end loop;$d$;
  old_exp constant text := $e$    'expected_total', case when v_rs is not null
                             then (v_rs->>'total')::numeric
                                  + coalesce(v.parts_amount, 0) + coalesce(v.flat_amount, 0)
                             else v.total_billed end,$e$;
  new_exp constant text := $f$    -- The parts component comes off the lines that were just drawn, not off
    -- the view's rounded total. Rounding each line and then comparing against a
    -- figure rounded once at the end is how a penny's difference becomes a push
    -- the function refuses, and the two are now the same arithmetic.
    'expected_total', case when v_rs is not null
                             then (v_rs->>'total')::numeric
                                  + v_pa + coalesce(v.flat_amount, 0)
                             else v.total_billed - coalesce(v.parts_amount, 0) + v_pa end,$f$;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'qb_invoice_payload';
  if src is null then raise exception 'qb_invoice_payload not found'; end if;

  if position(old_dec   in src) = 0 then raise exception 'declare anchor not found'; end if;
  if position(old_parts in src) = 0 then raise exception 'parts anchor not found'; end if;
  if position(old_exp   in src) = 0 then raise exception 'expected_total anchor not found'; end if;

  newsrc := replace(src, old_dec,   new_dec);
  newsrc := replace(newsrc, old_parts, new_parts);
  newsrc := replace(newsrc, old_exp,   new_exp);

  if newsrc = src then raise exception 'nothing changed'; end if;
  if position('1010000001'',
      ''description'', ''Parts / materials''' in newsrc) > 0 then
    raise exception 'the lump parts line is still there';
  end if;

  execute newsrc;
end
$mig$;

-- The blinds already on the Viper week are laser work, not welding.
update public.daily_entry_parts dep
set qb_item_id = '17'
from public.daily_entries de
where de.id = dep.daily_entry_id
  and dep.qb_item_id is null
  and dep.description ilike '%laser%';
