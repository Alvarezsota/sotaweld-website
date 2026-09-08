-- A customer with their own rate sheet.
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS NOT THE EXISTING RATE MACHINERY
-- ---------------------------------------------------------------------------
--
-- Every job so far bills the same shape: one welder rate, one helper rate, per
-- diem, straight time, all of it hanging off the job row. Electric Hydrogen is
-- a different animal and would break that in three ways at once.
--
--   Twenty-nine labour classifications, not two. A man is billed as a Combo
--   Welder at $94.80 or a Pipefitter III at $38.00, and the same man can be
--   either on a different job.
--
--   Ninety-nine pieces of equipment, billed in their own right -- some hourly,
--   some by the day, mats by the mat by the day. Nothing in the portal bills a
--   machine today.
--
--   Time and a half after forty hours, per man, per week. Everything else here
--   is straight time.
--
-- So it gets its own catalogue rather than more columns on jobs. A rate sheet
-- belongs to a customer and has a date it took effect; a job points at nothing
-- new. That also means the next customer who turns up with their own sheet is
-- a row, not another migration.
--
-- ---------------------------------------------------------------------------
-- OVERTIME IS COMPUTED WEEKLY, AND NOTHING HERE DECIDES IT DAILY
-- ---------------------------------------------------------------------------
--
-- The contract says after forty hours, which is a weekly line, so ot_after_hours
-- is a number on the sheet and not a rule baked into a ticket. Splitting each
-- day 8 straight and 2 over is only right at exactly five ten-hour days: on a
-- four-day week it bills eight hours of premium that is not owed, and on a
-- six-day week it leaves the same eight hours' premium uncollected.
--
-- Hours are recorded as worked. The forty-hour line is drawn when the week is
-- billed, which is the only place that knows how long the week turned out.
--
-- Pay is untouched. This is what the customer is charged; what the crew is paid
-- is a separate question and is deliberately not part of this.
--
-- Safe to re-run.

create table if not exists public.rate_sheets (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  qb_customer_id  text,
  qb_environment  text not null default 'production',
  effective_on    date not null,
  -- Null means straight time throughout, which is every other customer.
  ot_after_hours  numeric,
  ot_multiplier   numeric not null default 1.5,
  per_diem_rate   numeric,
  active          boolean not null default true,
  notes           text,
  created_at      timestamptz not null default now()
);

comment on table public.rate_sheets is
  'A customer''s own T&M rate sheet. ot_after_hours is the weekly hours line per man; null means straight time.';

create unique index if not exists rate_sheets_customer_effective_idx
  on public.rate_sheets (qb_environment, qb_customer_id, effective_on)
  where qb_customer_id is not null;

create table if not exists public.rate_sheet_items (
  id            uuid primary key default gen_random_uuid(),
  rate_sheet_id uuid not null references public.rate_sheets(id) on delete cascade,
  kind          text not null check (kind in ('personnel','equipment')),
  category      text not null,
  description   text not null,
  unit          text not null check (unit in ('hourly','day','each','each_per_day')),
  rate          numeric not null check (rate >= 0),
  -- Only labour crosses into time and a half. A machine costs what it costs
  -- whatever hour of the week it runs in.
  ot_eligible   boolean not null default false,
  sort_order    integer not null default 0,
  active        boolean not null default true
);

comment on table public.rate_sheet_items is
  'One line of a rate sheet. kind splits the two dropdowns: personnel classifications and equipment.';

create index if not exists rate_sheet_items_sheet_idx
  on public.rate_sheet_items (rate_sheet_id, kind, sort_order);

-- Which classification a man is billed as on a given sheet. Set once by the
-- office, not chosen in the field every day -- a welder picking his own rate
-- out of twenty-nine every morning is a wrong rate waiting to happen.
create table if not exists public.crew_rate_class (
  id                 uuid primary key default gen_random_uuid(),
  rate_sheet_id      uuid not null references public.rate_sheets(id) on delete cascade,
  person_kind        text not null check (person_kind in ('welder','helper')),
  person_id          uuid not null,
  rate_sheet_item_id uuid not null references public.rate_sheet_items(id) on delete cascade,
  unique (rate_sheet_id, person_kind, person_id)
);

comment on table public.crew_rate_class is
  'The classification each man bills as on one rate sheet. person_id is a profile for a welder, a helper row for a helper.';

-- Equipment that ran on a day, against the ticket for that day.
create table if not exists public.daily_entry_equipment (
  id                 uuid primary key default gen_random_uuid(),
  daily_entry_id     uuid not null references public.daily_entries(id) on delete cascade,
  rate_sheet_item_id uuid not null references public.rate_sheet_items(id),
  -- Hours for an hourly machine, days for a daily one. Quantity is for the
  -- lines billed each -- mats, sand -- and is 1 for everything else.
  amount             numeric not null check (amount >= 0),
  quantity           numeric not null default 1 check (quantity >= 0),
  note               text,
  created_at         timestamptz not null default now()
);

create index if not exists daily_entry_equipment_entry_idx
  on public.daily_entry_equipment (daily_entry_id);

-- ---------------------------------------------------------------------------
-- The Electric Hydrogen sheet, effective 09-08-2026
-- ---------------------------------------------------------------------------

insert into public.rate_sheets
  (name, qb_customer_id, qb_environment, effective_on, ot_after_hours, ot_multiplier, per_diem_rate, notes)
select 'Electric Hydrogen T&M', '196', 'production', date '2026-09-08', 40, 1.5, 125.00,
       'Rate sheet issued 09-08-2026. Labour billed port to port, time and a half after 40 hours per man per week. Per diem $125/day/person.'
where not exists (
  select 1 from public.rate_sheets
   where qb_customer_id = '196' and qb_environment = 'production' and effective_on = date '2026-09-08');

-- Re-runnable: the items are rebuilt from scratch each time so a corrected rate
-- is a re-run rather than a hand-edit.
delete from public.rate_sheet_items
 where rate_sheet_id in (select id from public.rate_sheets
                          where qb_customer_id = '196' and qb_environment = 'production'
                            and effective_on = date '2026-09-08');

insert into public.rate_sheet_items
  (rate_sheet_id, kind, category, description, unit, rate, ot_eligible, sort_order)
select s.id, v.kind, v.category, v.description, v.unit, v.rate, v.ot_eligible, v.sort_order
from public.rate_sheets s
cross join (values
  ('personnel', 'Labor', 'Project Manager', 'hourly', 95.00, true, 1),
  ('personnel', 'Labor', 'Superintendent', 'hourly', 75.00, true, 2),
  ('personnel', 'Labor', 'Supervisor', 'hourly', 58.00, true, 3),
  ('personnel', 'Labor', 'Welder', 'hourly', 79.00, true, 4),
  ('personnel', 'Labor', 'Combo Welder', 'hourly', 94.80, true, 5),
  ('personnel', 'Labor', 'Welder Helper', 'hourly', 37.00, true, 6),
  ('personnel', 'Labor', 'Safety Coordinator', 'hourly', 50.00, true, 7),
  ('personnel', 'Labor', 'Foreman', 'hourly', 55.00, true, 8),
  ('personnel', 'Labor', 'Working Class Foreman', 'hourly', 55.00, true, 9),
  ('personnel', 'Labor', 'Equipment Operator', 'hourly', 50.00, true, 10),
  ('personnel', 'Labor', 'Truck Driver', 'hourly', 46.00, true, 11),
  ('personnel', 'Labor', 'Pipefitter I', 'hourly', 48.00, true, 12),
  ('personnel', 'Labor', 'Pipefitter II', 'hourly', 43.00, true, 13),
  ('personnel', 'Labor', 'Pipefitter III', 'hourly', 38.00, true, 14),
  ('personnel', 'Labor', 'Carpenter I', 'hourly', 48.00, true, 15),
  ('personnel', 'Labor', 'Carpenter II', 'hourly', 43.00, true, 16),
  ('personnel', 'Labor', 'Carpenter III', 'hourly', 38.00, true, 17),
  ('personnel', 'Labor', 'Rod Buster I', 'hourly', 46.00, true, 18),
  ('personnel', 'Labor', 'Rod Buster II', 'hourly', 41.00, true, 19),
  ('personnel', 'Labor', 'Rod Buster III', 'hourly', 35.00, true, 20),
  ('personnel', 'Labor', 'Insulator/Scaffold Leadman', 'hourly', 55.00, true, 21),
  ('personnel', 'Labor', 'Insulator/Scaffold Builder', 'hourly', 46.00, true, 22),
  ('personnel', 'Labor', 'Labor Foreman / Crew Pusher', 'hourly', 45.00, true, 23),
  ('personnel', 'Labor', 'Locate Tech', 'hourly', 52.00, true, 24),
  ('personnel', 'Labor', 'Skilled Labor', 'hourly', 37.00, true, 25),
  ('personnel', 'Labor', 'QA/QC', 'hourly', 52.00, true, 26),
  ('personnel', 'Labor', 'Painter', 'hourly', 48.00, true, 27),
  ('personnel', 'Labor', 'Field Clerk', 'hourly', 35.00, true, 28),
  ('personnel', 'Labor', 'Pipeliner', 'hourly', 53.00, true, 29),
  ('equipment', 'Heavy Equipment', 'Mini Excavator', 'hourly', 51.00, false, 30),
  ('equipment', 'Heavy Equipment', 'Excavator Small (320 or Equivalent)', 'hourly', 82.00, false, 31),
  ('equipment', 'Heavy Equipment', 'Excavator Medium (329 or Equivalent)', 'hourly', 95.00, false, 32),
  ('equipment', 'Heavy Equipment', 'Excavator Large (336 or Equivalent)', 'hourly', 113.00, false, 33),
  ('equipment', 'Heavy Equipment', 'Excavator w/ Attachment (Hammer/Padding Bucket/Vacuworks)', 'hourly', 160.00, false, 34),
  ('equipment', 'Heavy Equipment', 'Dozer Small (D4 or Equivalent)', 'hourly', 70.00, false, 35),
  ('equipment', 'Heavy Equipment', 'Dozer Medium (D5 or Equivalent)', 'hourly', 85.00, false, 36),
  ('equipment', 'Heavy Equipment', 'Dozer Large (D6 or Equivalent)', 'hourly', 90.00, false, 37),
  ('equipment', 'Heavy Equipment', 'Dozer Oversize (D7 or Equivalent)', 'hourly', 100.00, false, 38),
  ('equipment', 'Heavy Equipment', 'Sideboom Mini (D37 or Equivalent)', 'hourly', 75.00, false, 39),
  ('equipment', 'Heavy Equipment', 'Sideboom Small (D41/561 or Equivalent)', 'hourly', 90.00, false, 40),
  ('equipment', 'Heavy Equipment', 'Sideboom Medium (D61/571 or Equivalent)', 'hourly', 150.00, false, 41),
  ('equipment', 'Heavy Equipment', 'Sideboom Large (D65/583 or Equivalent)', 'hourly', 180.00, false, 42),
  ('equipment', 'Heavy Equipment', 'Backhoe', 'hourly', 49.00, false, 43),
  ('equipment', 'Heavy Equipment', 'Motor Grader', 'hourly', 125.00, false, 44),
  ('equipment', 'Heavy Equipment', 'Loader', 'hourly', 110.00, false, 45),
  ('equipment', 'Heavy Equipment', 'All Terrain Forklift (12K)', 'hourly', 68.00, false, 46),
  ('equipment', 'Heavy Equipment', 'All Terrain Forklift (10K)', 'hourly', 58.00, false, 47),
  ('equipment', 'Heavy Equipment', 'Skidsteer', 'hourly', 48.00, false, 48),
  ('equipment', 'Heavy Equipment', 'Vermeer Chain Trencher (555 to 755)', 'hourly', 275.00, false, 49),
  ('equipment', 'Heavy Equipment', 'Tractor with Attachment', 'hourly', 64.00, false, 50),
  ('equipment', 'Heavy Equipment', 'Bending Machine', 'hourly', 75.00, false, 51),
  ('equipment', 'Trucks, Trailers & Rigs', 'Tack Rig', 'hourly', 250.00, false, 52),
  ('equipment', 'Trucks, Trailers & Rigs', 'Welding Truck', 'hourly', 42.00, false, 53),
  ('equipment', 'Trucks, Trailers & Rigs', '1 Ton Truck with Tools', 'hourly', 35.00, false, 54),
  ('equipment', 'Trucks, Trailers & Rigs', '3/4 Ton Truck', 'hourly', 29.00, false, 55),
  ('equipment', 'Trucks, Trailers & Rigs', 'Semi/Haul Truck (Trailer Separate)', 'hourly', 85.00, false, 56),
  ('equipment', 'Trucks, Trailers & Rigs', 'Dump Truck', 'hourly', 90.00, false, 57),
  ('equipment', 'Trucks, Trailers & Rigs', 'Hydrovac Truck W/Out Operator', 'hourly', 260.00, false, 58),
  ('equipment', 'Trucks, Trailers & Rigs', 'Float Trailer', 'hourly', 25.00, false, 59),
  ('equipment', 'Trucks, Trailers & Rigs', 'Lowboy Trailer', 'hourly', 35.00, false, 60),
  ('equipment', 'Trucks, Trailers & Rigs', 'Belly Dump', 'hourly', 55.00, false, 61),
  ('equipment', 'Trucks, Trailers & Rigs', '20'' Gooseneck', 'hourly', 11.00, false, 62),
  ('equipment', 'Trucks, Trailers & Rigs', '40'' Gooseneck', 'hourly', 19.00, false, 63),
  ('equipment', 'Trucks, Trailers & Rigs', 'Utility Trailer', 'hourly', 15.00, false, 64),
  ('equipment', 'Trucks, Trailers & Rigs', 'Pipe Trailer', 'hourly', 10.00, false, 65),
  ('equipment', 'Trucks, Trailers & Rigs', 'Water Trailer', 'day', 350.00, false, 66),
  ('equipment', 'Trucks, Trailers & Rigs', 'Office Trailer', 'hourly', 25.00, false, 67),
  ('equipment', 'Trucks, Trailers & Rigs', 'Trash Trailer', 'hourly', 25.00, false, 68),
  ('equipment', 'Trucks, Trailers & Rigs', 'Tool Trailer', 'hourly', 25.00, false, 69),
  ('equipment', 'Trucks, Trailers & Rigs', 'Enclosed Trailer', 'hourly', 25.00, false, 70),
  ('equipment', 'Trucks, Trailers & Rigs', 'Hydrotest Trailer', 'hourly', 45.00, false, 71),
  ('equipment', 'Trucks, Trailers & Rigs', 'Hydrovac Trailer', 'hourly', 65.00, false, 72),
  ('equipment', 'Pipeline & Fusion Equipment', 'Fusion Machine 1"-3"', 'hourly', 20.00, false, 73),
  ('equipment', 'Pipeline & Fusion Equipment', 'Fusion Machine 4"-8"', 'hourly', 35.00, false, 74),
  ('equipment', 'Pipeline & Fusion Equipment', 'Fusion Machine 10"-12"', 'hourly', 45.00, false, 75),
  ('equipment', 'Pipeline & Fusion Equipment', 'Trackstar 8"', 'hourly', 65.00, false, 76),
  ('equipment', 'Pipeline & Fusion Equipment', 'Trackstar 12"', 'hourly', 80.00, false, 77),
  ('equipment', 'Pipeline & Fusion Equipment', 'Beveling Machine 16"+', 'day', 75.00, false, 78),
  ('equipment', 'Pipeline & Fusion Equipment', 'Beveling Machine 2"-12"', 'day', 36.00, false, 79),
  ('equipment', 'Pipeline & Fusion Equipment', 'Squeeze Off 12"+', 'day', 60.00, false, 80),
  ('equipment', 'Pipeline & Fusion Equipment', 'Squeeze Off 2"-10"', 'day', 20.00, false, 81),
  ('equipment', 'Pipeline & Fusion Equipment', 'Pipe Threader', 'day', 52.00, false, 82),
  ('equipment', 'Pipeline & Fusion Equipment', 'Pipe Calipers', 'day', 21.50, false, 83),
  ('equipment', 'Pipeline & Fusion Equipment', 'Pipe Clamps / Line Up Pins', 'day', 20.00, false, 84),
  ('equipment', 'Pipeline & Fusion Equipment', 'Pipe Cradles', 'day', 80.00, false, 85),
  ('equipment', 'Pipeline & Fusion Equipment', 'Cradles (6"-12")', 'day', 60.00, false, 86),
  ('equipment', 'Pipeline & Fusion Equipment', 'Cradles (12"-24")', 'day', 110.00, false, 87),
  ('equipment', 'Testing & Pressure Equipment', '6" Fill Pump', 'hourly', 90.00, false, 88),
  ('equipment', 'Testing & Pressure Equipment', 'Air Powered Testing Pump', 'hourly', 25.00, false, 89),
  ('equipment', 'Testing & Pressure Equipment', 'Dead Weights / Digital PSI (Certified)', 'day', 150.00, false, 90),
  ('equipment', 'Testing & Pressure Equipment', 'Chart Recorder / Digital Recorder (Calibrated)', 'day', 150.00, false, 91),
  ('equipment', 'Testing & Pressure Equipment', 'Air Bag (50 Ton, A/C Not Included)', 'day', 250.00, false, 92),
  ('equipment', 'Testing & Pressure Equipment', 'Pump 2"', 'day', 83.00, false, 93),
  ('equipment', 'Testing & Pressure Equipment', 'Pump 3"', 'day', 93.00, false, 94),
  ('equipment', 'Testing & Pressure Equipment', 'Pump 6"', 'day', 250.00, false, 95),
  ('equipment', 'Testing & Pressure Equipment', 'Pump Hoses (20'' Sections)', 'day', 20.00, false, 96),
  ('equipment', 'Testing & Pressure Equipment', 'Gas Monitor', 'day', 70.00, false, 97),
  ('equipment', 'Testing & Pressure Equipment', 'Torque Wrench 3/4"', 'day', 30.00, false, 98),
  ('equipment', 'Testing & Pressure Equipment', 'Torque Wrench Multiplier (1" or Greater)', 'day', 65.00, false, 99),
  ('equipment', 'Small Tools & Site Equipment', 'Air Compressor 185', 'hourly', 25.00, false, 100),
  ('equipment', 'Small Tools & Site Equipment', 'Air Compressor 260', 'hourly', 30.00, false, 101),
  ('equipment', 'Small Tools & Site Equipment', 'Air Compressor 375', 'hourly', 35.00, false, 102),
  ('equipment', 'Small Tools & Site Equipment', 'Air Mover', 'day', 26.00, false, 103),
  ('equipment', 'Small Tools & Site Equipment', 'Auger - Power', 'day', 75.00, false, 104),
  ('equipment', 'Small Tools & Site Equipment', 'Chain Saw', 'day', 53.00, false, 105),
  ('equipment', 'Small Tools & Site Equipment', 'Cold Cutters (Wheels Extra)', 'day', 28.00, false, 106),
  ('equipment', 'Small Tools & Site Equipment', 'Tow Cables', 'day', 75.00, false, 107),
  ('equipment', 'Small Tools & Site Equipment', 'Generator 3.5 KW', 'day', 73.25, false, 108),
  ('equipment', 'Small Tools & Site Equipment', 'Generator 5.0 KW', 'day', 95.00, false, 109),
  ('equipment', 'Small Tools & Site Equipment', 'Heated Pressure Washer', 'day', 225.00, false, 110),
  ('equipment', 'Small Tools & Site Equipment', 'Impact Gun', 'day', 250.00, false, 111),
  ('equipment', 'Small Tools & Site Equipment', 'Jackhammer', 'day', 60.00, false, 112),
  ('equipment', 'Small Tools & Site Equipment', 'Jeep (Holiday Detector)', 'day', 60.00, false, 113),
  ('equipment', 'Small Tools & Site Equipment', 'Lawnmower (Riding)', 'day', 100.00, false, 114),
  ('equipment', 'Small Tools & Site Equipment', 'Light Plant', 'day', 150.00, false, 115),
  ('equipment', 'Small Tools & Site Equipment', 'Line Locator', 'day', 52.00, false, 116),
  ('equipment', 'Small Tools & Site Equipment', 'Mats', 'each_per_day', 7.50, false, 117),
  ('equipment', 'Small Tools & Site Equipment', 'Painting Equipment (Pot, Airless, Gun)', 'day', 110.00, false, 118),
  ('equipment', 'Small Tools & Site Equipment', 'Sand Blast Sand', 'each', 30.00, false, 119),
  ('equipment', 'Small Tools & Site Equipment', 'Sand Blast Equipment (Hose, Hood, Pot)', 'day', 172.00, false, 120),
  ('equipment', 'Small Tools & Site Equipment', 'Saw (Any)', 'day', 45.00, false, 121),
  ('equipment', 'Small Tools & Site Equipment', 'Shop Crane', 'day', 12.00, false, 122),
  ('equipment', 'Small Tools & Site Equipment', 'Side by Side or 4-Wheeler', 'day', 146.00, false, 123),
  ('equipment', 'Small Tools & Site Equipment', 'Skids (Per 100)', 'day', 25.00, false, 124),
  ('equipment', 'Small Tools & Site Equipment', 'Torch', 'day', 50.00, false, 125),
  ('equipment', 'Small Tools & Site Equipment', 'Trench Box Large', 'day', 500.00, false, 126),
  ('equipment', 'Small Tools & Site Equipment', 'Trench Box Small', 'day', 300.00, false, 127),
  ('equipment', 'Small Tools & Site Equipment', 'Weedeater', 'day', 45.00, false, 128)
) as v(kind, category, description, unit, rate, ot_eligible, sort_order)
where s.qb_customer_id = '196' and s.qb_environment = 'production'
  and s.effective_on = date '2026-09-08';

do $verify$
declare v_n int; v_p int; v_e int;
begin
  select count(*), count(*) filter (where kind='personnel'), count(*) filter (where kind='equipment')
    into v_n, v_p, v_e
  from public.rate_sheet_items i
  join public.rate_sheets s on s.id = i.rate_sheet_id
  where s.qb_customer_id = '196' and s.qb_environment = 'production';

  if v_n <> 128 or v_p <> 29 or v_e <> 99 then
    raise exception 'STOP: expected 128 items (29 personnel, 99 equipment), got % (% / %).', v_n, v_p, v_e;
  end if;
end
$verify$;

alter table public.rate_sheets           enable row level security;
alter table public.rate_sheet_items      enable row level security;
alter table public.crew_rate_class       enable row level security;
alter table public.daily_entry_equipment enable row level security;

-- Everybody signed in may read the catalogue: the equipment dropdown on the
-- ticket is a welder's screen. Only the office may change what anything costs.
drop policy if exists rate_sheets_read on public.rate_sheets;
create policy rate_sheets_read on public.rate_sheets for select to authenticated using (true);
drop policy if exists rate_sheets_write on public.rate_sheets;
create policy rate_sheets_write on public.rate_sheets for all to authenticated
  using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

drop policy if exists rate_sheet_items_read on public.rate_sheet_items;
create policy rate_sheet_items_read on public.rate_sheet_items for select to authenticated using (true);
drop policy if exists rate_sheet_items_write on public.rate_sheet_items;
create policy rate_sheet_items_write on public.rate_sheet_items for all to authenticated
  using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

drop policy if exists crew_rate_class_read on public.crew_rate_class;
create policy crew_rate_class_read on public.crew_rate_class for select to authenticated using (true);
drop policy if exists crew_rate_class_write on public.crew_rate_class;
create policy crew_rate_class_write on public.crew_rate_class for all to authenticated
  using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

-- Equipment lines follow the ticket they hang off, exactly as helper lines do.
drop policy if exists daily_entry_equipment_select on public.daily_entry_equipment;
create policy daily_entry_equipment_select on public.daily_entry_equipment for select to authenticated
  using (exists (select 1 from daily_entries de
                  where de.id = daily_entry_id
                    and (de.welder_id = auth.uid() or de.supervisor_id = auth.uid() or is_admin(auth.uid()))));
drop policy if exists daily_entry_equipment_insert on public.daily_entry_equipment;
create policy daily_entry_equipment_insert on public.daily_entry_equipment for insert to authenticated
  with check (exists (select 1 from daily_entries de
                       where de.id = daily_entry_id
                         and (de.welder_id = auth.uid() or de.supervisor_id = auth.uid() or is_admin(auth.uid()))));
drop policy if exists daily_entry_equipment_delete on public.daily_entry_equipment;
create policy daily_entry_equipment_delete on public.daily_entry_equipment for delete to authenticated
  using (exists (select 1 from daily_entries de
                  where de.id = daily_entry_id
                    and (de.welder_id = auth.uid() or de.supervisor_id = auth.uid() or is_admin(auth.uid()))));
drop policy if exists daily_entry_equipment_update on public.daily_entry_equipment;
create policy daily_entry_equipment_update on public.daily_entry_equipment for update to authenticated
  using (exists (select 1 from daily_entries de
                  where de.id = daily_entry_id
                    and (de.welder_id = auth.uid() or de.supervisor_id = auth.uid() or is_admin(auth.uid()))));

grant select on public.rate_sheets, public.rate_sheet_items, public.crew_rate_class to authenticated;
grant select, insert, update, delete on public.daily_entry_equipment to authenticated;
grant insert, update, delete on public.rate_sheets, public.rate_sheet_items, public.crew_rate_class to authenticated;

notify pgrst, 'reload schema';
