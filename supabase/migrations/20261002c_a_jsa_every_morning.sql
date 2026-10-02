-- A JSA every morning.
--
-- Electric Hydrogen's Site Specific Safety Plan (Project Roadrunner, Pecos) is
-- not vague about this: "All work performed onsite must be documented daily
-- with a Job Safety Analysis (JSA). All contractors participating in the work
-- scope described by the JSA will sign the JSA. The JSA will then be reviewed
-- and approved by the EH2 Site Safety Rep." It is handed in before work starts
-- in the morning, reviewed no later than the Daily Work Coordination Meeting,
-- a copy stays on the man doing the work, and the original goes in the JSA bin
-- in the EH2 construction trailer.
--
-- The plan also says what we are allowed to do about the paperwork:
-- "Contractors may utilize their own JSA templates so long as they are
-- approved by the EH2 Safety Rep. Pre-generated JSAs with job steps, hazards,
-- and controls are permitted to be used as a starting template so as not
-- having to consider all aspects of the JSA from scratch, but they must still
-- be considered and made job specific for that day."
--
-- So: a library of hazards and their controls that a crew lead picks from, and
-- a form that opens already carrying what the last JSA on that job carried --
-- but a form he still has to read, change and sign. Four tables:
--
--   jsa_hazards      the library. Seeded from the SSSP's own sections.
--   jsa_reports      one per job per day.
--   jsa_steps        the job broken into steps, each with its hazards and controls.
--   jsa_signatures   who stood there and signed it.
--   jsa_people       names typed in by hand once and offered ever after -- the
--                    EH2 safety rep, a hand from another contractor, somebody
--                    who will never have a portal login.

/* ------------------------------------------------------------------ library */

create table if not exists jsa_hazards (
  id          uuid primary key default gen_random_uuid(),
  category    text not null,
  hazard      text not null,
  controls    text not null,
  permit      text,                       -- the high-risk permit this triggers
  sort_order  int  not null default 100,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create unique index if not exists jsa_hazards_one_per_line
  on jsa_hazards (category, hazard);

/* ------------------------------------------------------------------- the JSA */

create table if not exists jsa_reports (
  id            uuid primary key default gen_random_uuid(),
  jsa_date      date not null default (now() at time zone 'America/Chicago')::date,
  job_id        uuid references jobs(id),
  site_name     text,                     -- the site as the client calls it
  work_scope    text,
  crew_lead_id  uuid references profiles(id),
  start_time    text,
  end_time      text,
  weather       text,
  ppe           jsonb not null default '[]'::jsonb,
  permits       jsonb not null default '[]'::jsonb,
  emergency     jsonb not null default '{}'::jsonb,
  stop_work_ack boolean not null default false,
  notes         text,
  status        text not null default 'draft'
                  check (status in ('draft', 'submitted')),
  submitted_at  timestamptz,
  created_by    uuid not null references profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One JSA per job per day. A second crew on the same job the same day adds
-- steps and signatures to the one sheet; that is what the client is handed.
create unique index if not exists jsa_reports_one_per_job_day
  on jsa_reports (jsa_date, job_id) where job_id is not null;

create index if not exists jsa_reports_by_date on jsa_reports (jsa_date desc);

create table if not exists jsa_steps (
  id        uuid primary key default gen_random_uuid(),
  jsa_id    uuid not null references jsa_reports(id) on delete cascade,
  step_no   int  not null default 1,
  task      text not null,
  hazards   text not null default '',
  controls  text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists jsa_steps_by_jsa on jsa_steps (jsa_id, step_no);

create table if not exists jsa_signatures (
  id          uuid primary key default gen_random_uuid(),
  jsa_id      uuid not null references jsa_reports(id) on delete cascade,
  person_id   uuid references profiles(id),      -- ours, when it is one of ours
  person_name text not null,
  company     text,
  craft       text,
  -- A finger on the glass, kept as a PNG data URL. Small: the pad is 520x160
  -- and the stroke is one colour, so these run a few kilobytes.
  signature   text,
  signed_at   timestamptz not null default now(),
  signed_by   uuid references profiles(id) default auth.uid()
);

create index if not exists jsa_signatures_by_jsa on jsa_signatures (jsa_id);

/* Names typed in by hand, kept so they are never typed twice. */
create table if not exists jsa_people (
  id          uuid primary key default gen_random_uuid(),
  person_name text not null,
  company     text,
  craft       text,
  active      boolean not null default true,
  last_used   date,
  added_by    uuid references profiles(id) default auth.uid(),
  created_at  timestamptz not null default now()
);

create unique index if not exists jsa_people_one_per_name
  on jsa_people (lower(person_name), lower(coalesce(company, '')));

/* --------------------------------------------------------------- row-level */

alter table jsa_hazards    enable row level security;
alter table jsa_reports    enable row level security;
alter table jsa_steps      enable row level security;
alter table jsa_signatures enable row level security;
alter table jsa_people     enable row level security;

-- A JSA is a safety document, not a pay document. There is no rate and no
-- dollar figure on it, and every man on the job is meant to have read it --
-- so anybody still working here can see all of them. Writing is narrower.
drop policy if exists jsa_hazards_read on jsa_hazards;
create policy jsa_hazards_read on jsa_hazards
  for select to authenticated using (is_active_person(auth.uid()));

drop policy if exists jsa_hazards_admin on jsa_hazards;
create policy jsa_hazards_admin on jsa_hazards
  for all to authenticated using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

drop policy if exists jsa_reports_read on jsa_reports;
create policy jsa_reports_read on jsa_reports
  for select to authenticated using (is_active_person(auth.uid()));

drop policy if exists jsa_reports_write on jsa_reports;
create policy jsa_reports_write on jsa_reports
  for insert to authenticated
  with check (is_active_person(auth.uid()) and created_by = auth.uid());

-- The man who raised it can keep working on it; an admin can fix any of them,
-- including after it has gone in, because a JSA gets revised the moment the
-- scope changes and the SSSP requires exactly that.
drop policy if exists jsa_reports_edit on jsa_reports;
create policy jsa_reports_edit on jsa_reports
  for update to authenticated
  using (is_admin(auth.uid())
         or (is_active_person(auth.uid()) and created_by = auth.uid() and status = 'draft'))
  with check (is_admin(auth.uid()) or created_by = auth.uid());

drop policy if exists jsa_reports_remove on jsa_reports;
create policy jsa_reports_remove on jsa_reports
  for delete to authenticated
  using (is_admin(auth.uid())
         or (created_by = auth.uid() and status = 'draft'));

drop policy if exists jsa_steps_read on jsa_steps;
create policy jsa_steps_read on jsa_steps
  for select to authenticated using (is_active_person(auth.uid()));

drop policy if exists jsa_steps_write on jsa_steps;
create policy jsa_steps_write on jsa_steps
  for all to authenticated
  using (is_admin(auth.uid()) or exists (
    select 1 from jsa_reports r
    where r.id = jsa_steps.jsa_id and r.created_by = auth.uid() and r.status = 'draft'))
  with check (is_admin(auth.uid()) or exists (
    select 1 from jsa_reports r
    where r.id = jsa_steps.jsa_id and r.created_by = auth.uid()));

drop policy if exists jsa_signatures_read on jsa_signatures;
create policy jsa_signatures_read on jsa_signatures
  for select to authenticated using (is_active_person(auth.uid()));

-- Signing is the one thing anybody on site does to somebody else's JSA. The
-- crew lead holds the phone and each man signs it in turn, so the row is
-- written by whoever is logged in -- but it is never written by somebody who
-- has been archived.
drop policy if exists jsa_signatures_write on jsa_signatures;
create policy jsa_signatures_write on jsa_signatures
  for insert to authenticated with check (is_active_person(auth.uid()));

drop policy if exists jsa_signatures_fix on jsa_signatures;
create policy jsa_signatures_fix on jsa_signatures
  for delete to authenticated
  using (is_admin(auth.uid()) or signed_by = auth.uid());

drop policy if exists jsa_people_read on jsa_people;
create policy jsa_people_read on jsa_people
  for select to authenticated using (is_active_person(auth.uid()));

drop policy if exists jsa_people_write on jsa_people;
create policy jsa_people_write on jsa_people
  for insert to authenticated with check (is_active_person(auth.uid()));

drop policy if exists jsa_people_edit on jsa_people;
create policy jsa_people_edit on jsa_people
  for update to authenticated
  using (is_active_person(auth.uid())) with check (is_active_person(auth.uid()));

drop policy if exists jsa_people_remove on jsa_people;
create policy jsa_people_remove on jsa_people
  for delete to authenticated using (is_admin(auth.uid()));

/* ------------------------------------------------------------------- seeding

   The library. Every line of this comes out of the Site Specific Safety Plan's
   own sections -- 14.1 through 14.13, plus PPE (7.0), area control (8.0),
   housekeeping (16.0), vehicles (17.0) and heat (15.0) -- so when a crew lead
   picks a hazard off the dropdown, the control that comes with it is the
   control EH2 wrote down, not one I made up. The pressure and process lines
   are ours: EH2's plan is about a hydrogen plant being built, and our men
   spend most of their week breaking into live gathering lines.

   `permit` is what the plan calls a High Risk Work Permit (10.0). Picking a
   hazard that carries one ticks that permit on the sheet, because the plan
   requires the permit to be handed in with the JSA, not after it. */

insert into jsa_hazards (category, hazard, controls, permit, sort_order) values

-- 14.9 Hot Work
('Hot work: welding, cutting, grinding',
 'Sparks and slag igniting combustibles',
 'Hot Work permit signed by the EH2 EHS rep before striking an arc. Combustibles moved 35 ft or covered with a fire blanket. Extinguisher within 25 ft. Fire watch during the work and 30 minutes after it stops.',
 'Hot Work', 101),
('Hot work: welding, cutting, grinding',
 'Arc flash and UV burn to eyes and skin',
 'Correct shade lens in the hood, safety glasses worn under it. Welding screens around the arc so nobody walking past catches it. FR clothing, sleeves down, collar buttoned.',
 'Hot Work', 102),
('Hot work: welding, cutting, grinding',
 'Welding fume, galvanize fume, confined fume',
 'Work upwind of the arc. Fume extractor or local exhaust in still air or tight quarters. Respirator where the fume cannot be moved. Galvanize ground off before welding.',
 'Hot Work', 103),
('Hot work: welding, cutting, grinding',
 'Burns from hot metal and dropped slag',
 'Leathers, jacket and gloves. Hot metal left marked HOT or where nobody puts a hand. Nothing hot left on the deck at the end of the shift.',
 'Hot Work', 104),
('Hot work: welding, cutting, grinding',
 'Compressed gas cylinders and torch leads',
 'Cylinders upright and chained, caps on when not in use, out of the sun. Leads checked for leaks and cuts. Flashback arrestors fitted. Cylinders off the truck before work starts.',
 'Hot Work', 105),
('Hot work: welding, cutting, grinding',
 'Ignition source in a classified area',
 'Non-welding hot work permit for any ignition source in a classified area -- tools, phone, radio, meter. Gas test before and during. Area de-classified or the work moved out of it.',
 'Hot Work', 106),

-- 14.13 Working at Heights
('Working at heights',
 'Fall from 6 ft or more',
 'Working at Heights permit approved by the EH2 EHS rep before the work. 100% tie-off to an engineered anchor. Harness and lanyard inspected before use and the inspection recorded.',
 'Working at Heights', 201),
('Working at heights',
 'Dropped tools or material onto men below',
 'Tools tethered. Area below barricaded with red danger tape. Nobody works underneath. Nothing carried up by hand that can be hoisted.',
 'Working at Heights', 202),
('Working at heights',
 'Ladder set wrong or worked off badly',
 'Ladder tied off and extended 3 ft past the landing. Three points of contact. No work off the top two rungs. Fall protection on a straight ladder over 24 ft.',
 null, 203),
('Working at heights',
 'Aerial or scissor lift upset or ejection',
 'Documented daily inspection before use. Harness tied to the basket anchor in a boom lift. Gate closed. Firm level ground, outriggers set, nobody climbing the rails.',
 'Working at Heights', 204),
('Working at heights',
 'Incomplete or untagged scaffold',
 'Built and tagged by a competent person. Green tag read before stepping on. Fully planked with guardrails. No work off a red-tagged or part-built scaffold.',
 'Working at Heights', 205),

-- 14.5 Electrical Safety & Energized Electrical Work
('Electrical',
 'Contact with energized conductors above 50V',
 'De-energize and lock out wherever it can be done. Where it cannot, an Energized Electrical Work Permit filled out by a qualified person and approved by an EH2 qualified person before the work.',
 'Energized Electrical Work', 301),
('Electrical',
 'Arc flash',
 'Arc flash PPE to the boundary. Approach boundaries marked and respected. Only qualified persons inside the limited approach.',
 'Energized Electrical Work', 302),
('Electrical',
 'Stored energy or unexpected start-up',
 'Lock out, tag out, try out. Every man his own lock. Zero energy verified with a meter before anybody touches it.',
 null, 303),
('Electrical',
 'Overhead power lines within 25 ft',
 'Non-conductive goal posts with flagging set outside the approach limits upstream and downstream. Signage. A spotter with an air horn and no other task -- two spotters where the lines are over an excavation.',
 null, 304),
('Electrical',
 'Power tools, cords and GFCI',
 'GFCI on every electric hand tool. Three-wire grounded or double insulated. Damaged tools tagged DO NOT USE and taken out of service. Never carry or unplug a tool by its cord.',
 null, 305),

-- 14.6 Excavation & Trenching
('Excavation and trenching',
 'Cave-in',
 'Competent person inspects at the start of each shift, after every break, and after rain or anything that could have moved the wall. Sloping, benching, shoring or a trench box on anything 5 ft or deeper that men enter -- named on this JSA.',
 'Excavation and Trenching', 401),
('Excavation and trenching',
 'Buried utilities',
 'One-call and the site utility drawings before anything breaks ground. Locate marks respected. Hand dig or hydro-excavate inside the tolerance zone.',
 'Excavation and Trenching', 402),
('Excavation and trenching',
 'Falling in, or spoil falling in',
 'Spoil kept 2 ft back from the edge. Edge protection or barricade. Ladder within 25 ft of every man in a trench 4 ft or deeper.',
 null, 403),
('Excavation and trenching',
 'Hazardous atmosphere in the trench',
 'Gas test before entry and continuous monitoring in anything over 4 ft where an atmosphere is suspected. Ventilate. Out on any alarm.',
 null, 404),

-- 14.4 Cranes & Rigging
('Cranes, rigging and lifting',
 'Dropped or swinging load',
 'Qualified rigger and signal person. Rigging inspected and inside its rated capacity. Tag lines on anything that can swing. Nobody under a suspended load, ever.',
 null, 501),
('Cranes, rigging and lifting',
 'Crane upset or outrigger failure',
 'Firm level ground with mats under the outriggers. Load chart checked against the radius. Lift plan by a qualified person before the pick.',
 null, 502),
('Cranes, rigging and lifting',
 'Critical lift -- over 100,000 lb or 75% of capacity',
 'Lift plan reviewed and approved by EH2 and the client before the lift. Pre-lift meeting held and documented. Swing radius barricaded with red danger tape.',
 'Critical Lift', 503),
('Cranes, rigging and lifting',
 'Boom or load into power lines',
 'Minimum approach distance kept and stated in the lift plan. Dedicated spotter watching the line, not the load. De-energize where it can be done.',
 null, 504),

-- 14.2 Confined Space
('Confined space',
 'Entry into a confined space',
 'EH2 works only in non-permit or reclassified spaces. Reclassification checklist completed and approved first. Attendant outside. Gas test before and during. Retrieval arrangement in place before anybody goes in.',
 'Confined Space', 601),
('Confined space',
 'Hazardous or oxygen-deficient atmosphere',
 'Continuous monitoring for O2, LEL, H2S and CO. Ventilate before and during. Everybody out on any alarm, and nobody back in until it is re-tested.',
 'Confined Space', 602),
('Confined space',
 'Engulfment or entrapment',
 'Lines broken, blinded and locked out. Nothing introduced into the space while men are inside it. Clear line of sight or voice with the attendant.',
 'Confined Space', 603),

-- 14.12 Silica
('Dust and silica',
 'Respirable silica from cutting, grinding, drilling or crushing concrete, stone, brick or mortar',
 'Silica exposure control plan approved before the work. Water suppression or on-tool extraction with a HEPA shroud. Respirator to Table 1. Area restricted to the men on the task.',
 'Silica Exposure Control Plan', 701),
('Dust and silica',
 'Dust in the eyes',
 'Goggles, not just safety glasses, in dusty conditions, jack-hammering, or anything that throws grit.',
 null, 702),

-- 14.7 Heavy Equipment & Traffic Control, 17.0 Vehicle Safety
('Heavy equipment and traffic',
 'Struck by equipment, backing operations',
 'Spotter or signal person whenever the operator cannot see or men are near. High-visibility clothing. Eye contact with the operator before stepping into his zone -- no vehicle passes moving equipment without eye contact with both operator and spotter.',
 null, 801),
('Heavy equipment and traffic',
 'Pinch points and swing radius',
 'Swing radius barricaded with red danger tape. Stay out of pinch points. Nobody rides on equipment or in a bucket.',
 null, 802),
('Heavy equipment and traffic',
 'Equipment left running or rolling away',
 'No engine left running with nobody at the controls. Wheels chocked, attachments grounded, park brake set.',
 null, 803),
('Heavy equipment and traffic',
 'Vehicles and pedestrians sharing the work area',
 'Site traffic control plan followed. Posted speed. Seat belts on everybody in the cab. No cell phone while driving. Loads secured before the truck moves.',
 null, 804),

-- 14.8 Hand and Power Tools
('Hand and power tools',
 'Cuts, pinches and struck-by',
 'Tools used only for what they are for. Cut-resistant gloves to suit. No loose or splintered handles. Damaged tools tagged DO NOT USE and off the truck.',
 null, 901),
('Hand and power tools',
 'Grinder kickback or wheel burst',
 'Guard in place. Correct wheel for the job and inside its rated RPM. Wheel inspected before fitting. Face shield over safety glasses.',
 null, 902),
('Hand and power tools',
 'Leads, cords and hoses underfoot',
 'Leads, welding leads and air hoses kept out of walkways and coiled when not in use. Run overhead where they cross a path.',
 null, 903),

-- 14.11 Manual Lifting, 14.1 Concrete and Formwork
('Material handling',
 'Strain from lifting',
 'Mechanical means -- forklift, pallet jack, hand truck, cart -- for anything awkward or heavy. No one man over 50 lb without help, nothing over 150 lb without equipment. Knees not back, load close, no twisting.',
 null, 1001),
('Material handling',
 'Pipe and steel rolling or falling',
 'Material chocked and banded. Stacked no higher than it stands on its own. Nobody downhill of a round load. Nothing stored against a rail or an edge.',
 null, 1002),
('Material handling',
 'Protruding rebar and impalement',
 'Caps on all protruding reinforcing steel anybody could fall onto or walk into.',
 null, 1003),
('Material handling',
 'Wet concrete burns and splash',
 'Rubber boots and rubber or nitrile gloves around wet concrete. Goggles or a full face shield where it can splash. Washout only into a lined or isolated area.',
 null, 1004),

-- Ours: our men break into live lines most weeks. EH2's plan does not cover it.
('Pressure and process',
 'Line not isolated, stored pressure',
 'Line isolated, de-pressured, drained and locked out before anything is cut. Verified at a vent or bleed with your own eyes before the torch comes out. Operator sign-off in hand.',
 null, 1101),
('Pressure and process',
 'Hydrotest or pneumatic test',
 'Test area barricaded. Nobody in line with a blind, a cap or a plug. Pressure relieved and verified before any rework.',
 null, 1102),
('Pressure and process',
 'H2S or flammable atmosphere',
 'Personal monitor worn and bump-tested that morning. Gas test before hot work and repeated if the work stops. Wind direction and muster point known before anybody starts.',
 null, 1103),

-- 8.0 Onsite Area Control, 16.0 Housekeeping, 9.0 coordination
('Site control and housekeeping',
 'Slips, trips and falls',
 'Walkways clear. Spills cleaned up. Stairs free of scrap and stored material. Trash in the proper container as it is made, not at the end of the day.',
 null, 1201),
('Site control and housekeeping',
 'Another crew working overhead or alongside',
 'Daily Work Coordination Meeting attended and the neighbouring work known before starting. Their barricades respected. Work stops and the JSA is revised if their scope moves into ours.',
 null, 1202),
('Site control and housekeeping',
 'Unauthorized entry into the work area',
 'Red danger tape around live electrical, overhead work, scaffold building, swing radius and excavations -- set and manned by the crew doing the work, down at the end of the shift. Yellow caution tape for property only.',
 null, 1203),

-- 15.0 Heat Illness Prevention
('Heat and weather',
 'Heat illness',
 'Work planned to the heat index with rest in the shade. Water and electrolytes on the truck. A cup every 15 minutes. Light, loose, light-coloured clothing, changed when it is soaked. Everybody watching the man next to him.',
 null, 1301),
('Heat and weather',
 'Lightning, high wind, rain',
 'Work stops and everybody to a vehicle on lightning. No crane or man-lift work in high wind. Excavation re-inspected by the competent person after rain.',
 null, 1302),
('Heat and weather',
 'Cold and ice',
 'Layers. Ice watched for on walkways, steps, scaffold planks and truck beds.',
 null, 1303),

-- 7.0 PPE, 14.3 chemicals
('Chemical and environmental',
 'Chemical contact with skin or eyes',
 'SDS read before the container is opened. Chemical-resistant PPE to suit. Eyewash located before starting. Nothing decanted into an unlabelled container.',
 null, 1401),
('Chemical and environmental',
 'Spill to ground',
 'Drip pans and absorbent on hand before the work starts. Equipment and concrete washout only into a lined or isolated area. Any spill reported immediately, however small.',
 null, 1402),
('Chemical and environmental',
 'Noise above the exposure limit',
 'Hearing protection wherever noise is above the permissible level, and always above 140 dB regardless of how long the exposure is.',
 null, 1403)

on conflict (category, hazard) do update
  set controls   = excluded.controls,
      permit     = excluded.permit,
      sort_order = excluded.sort_order,
      active     = true;

/* The names already on the EH2 contact list, so the first JSA signed at Pecos
   does not start with somebody typing "Rafael Gonzalez" into a blank box. Any
   name typed in from here on is kept the same way -- see jsa_people above. */

insert into jsa_people (person_name, company, craft) values
('Rafael Gonzalez',       'Electric Hydrogen', 'EHS on Site'),
('Tyler Weisinger',       'Electric Hydrogen', 'EHS on Site (backup)'),
('Mijail Zegalo',         'Electric Hydrogen', 'Construction Supervisor'),
('Bibek Tripathi',        'Electric Hydrogen', 'Construction Supervisor'),
('Vinayak Sachidanandam', 'Electric Hydrogen', 'Construction Supervisor'),
('Roel Vasquez',          'Evers & Sons',      'Site Safety'),
('Jesus Olivares',        'Evers & Sons',      'Site Supervisor'),
('Allen Hillsinger',      'Evers & Sons',      'Superintendent'),
('Francisco Oca',         'Evers & Sons',      'QA/QC Inspector'),
('Cecil Barlow',          'Infinium',          'Construction Manager')
on conflict (lower(person_name), lower(coalesce(company, ''))) do nothing;
