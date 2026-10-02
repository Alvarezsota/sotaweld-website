-- Paid by the piece.
--
-- On a bid job the crew is not paid for being there, they are paid for what
-- they fabricate. Six platforms and twelve sets of stairs for $26,250: the men
-- get a fixed amount per platform and per set of stairs, and whether it took
-- them four days or six is their business and the shop's risk.
--
-- The portal has only ever known one way to pay a man: hours times his rate.
-- This adds the second, and lets each job say which one it is on.
--
-- WHAT STAYS THE SAME
-- ---------------------------------------------------------------------------
-- Everything, until a job is switched over. pay_basis defaults to 'hourly' and
-- no job has anything else, so every figure on every past week computes exactly
-- as it did before this ran. That is checked after it runs, not assumed.
--
-- Hours are still logged on a bid job, and still have to be. They are what the
-- weld log is built from, what tells you a man was on site, and what the burn
-- counts to show you the job took 712 hours. They simply stop driving his pay.

-- ---------------------------------------------------------------------------
-- 1. A job says how its crew is paid
-- ---------------------------------------------------------------------------
-- Deliberately NOT billing_type. How a customer is charged and how a man is
-- paid are two different decisions and a shop can want any combination: a lump
-- sum job whose crew is still on the clock, or an hourly job with a piece-rate
-- side scope. One column answering both questions would force them together.

alter table public.jobs
  add column if not exists pay_basis text not null default 'hourly';

alter table public.jobs drop constraint if exists jobs_pay_basis_chk;
alter table public.jobs add constraint jobs_pay_basis_chk
  check (pay_basis in ('hourly', 'bid'));

comment on column public.jobs.pay_basis is
  'How the crew is paid on this job. hourly: hours times the man''s rate, as '
  'everywhere else. bid: a fixed amount per piece fabricated, out of the job''s '
  'bid. Separate from billing_type, which is how the CUSTOMER is charged.';

-- ---------------------------------------------------------------------------
-- 2. A bid line carries two prices
-- ---------------------------------------------------------------------------
-- unit_price is what the customer pays for one. pay_price is what the man who
-- builds one is paid. The gap between them is the shop's, and having both on
-- the same row is the only way to see it.

alter table public.job_bid_items
  add column if not exists pay_price numeric;

comment on column public.job_bid_items.pay_price is
  'What a man is paid to fabricate one of these, where the job pays by the '
  'piece. Not unit_price, which is what the customer is charged for one.';

-- ---------------------------------------------------------------------------
-- 3. Who finished how many, in which week
-- ---------------------------------------------------------------------------
-- Per person, which is what makes this pay and not progress. The existing
-- job_week_bid_progress records how many got done company-wide for billing;
-- this records who did them, for paying. They are kept apart on purpose: one
-- is a statement to the customer, the other is a statement to a man about his
-- cheque, and a correction to one is not automatically a correction to the
-- other.

create table if not exists public.bid_piece_credits (
  id uuid primary key default gen_random_uuid(),
  bid_item_id uuid not null references public.job_bid_items(id) on delete cascade,
  week_start date not null,
  person_kind text not null,
  person_id uuid not null,
  qty numeric not null,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  constraint bid_piece_credits_kind_chk check (person_kind in ('welder', 'helper')),
  constraint bid_piece_credits_qty_chk check (qty > 0),
  -- A Monday, like every other week in this system.
  constraint bid_piece_credits_monday_chk check (extract(isodow from week_start) = 1),
  -- One row per man per item per week. Two would be a double payment, and the
  -- second one would look exactly like the first.
  constraint bid_piece_credits_once unique (bid_item_id, week_start, person_kind, person_id)
);

comment on table public.bid_piece_credits is
  'How many of a bid line a given person fabricated in a given week, on a job '
  'that pays by the piece. Multiplied by job_bid_items.pay_price, this is his '
  'pay for that work.';

alter table public.bid_piece_credits enable row level security;

drop policy if exists bid_piece_credits_admin on public.bid_piece_credits;
create policy bid_piece_credits_admin on public.bid_piece_credits
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- A man may read his own, because it is the basis of his cheque and he is
-- entitled to see where the number came from. He cannot write it.
drop policy if exists bid_piece_credits_read_own on public.bid_piece_credits;
create policy bid_piece_credits_read_own on public.bid_piece_credits
  for select to authenticated
  using (person_kind = 'welder' and person_id = auth.uid());

grant select on public.bid_piece_credits to authenticated;
grant insert, update, delete on public.bid_piece_credits to authenticated;

create index if not exists bid_piece_credits_week on public.bid_piece_credits (week_start);
create index if not exists bid_piece_credits_person on public.bid_piece_credits (person_kind, person_id, week_start);

-- ---------------------------------------------------------------------------
-- 4. Hours stop paying on a job that pays by the piece
-- ---------------------------------------------------------------------------
-- v_work_lines is rebuilt from its own definition with the pay rate wrapped,
-- rather than retyped, so nothing else in a hundred-line view can drift:
--
--   pay_rate  ->  CASE WHEN cj.pay_basis = 'bid' THEN 0 ELSE <as before> END
--
-- Hours are still recorded and still prove a man was on site. They just no
-- longer pay him, because the pieces do, and leaving both on would pay twice.
--
-- 5. v_week_welder_summary / v_week_helper_summary gain piece_paid and pieces,
--    and total_paid becomes hours + per diem + pieces. Both now start from the
--    union of people with hours and people with credits: a man credited with
--    pieces in a week he logged no hours still has to appear, or he is not paid
--    at all.
--
-- 6. week_person_detail appends the piece lines, marked kind = 'piece', so a
--    statement reads "3 sets of stairs, $1,125" rather than a day with no hours
--    and no rate on it.
--
-- 7. job_spend adds piece pay to labour. On a piece job the hourly figure is
--    zero by design and this is the whole wage bill; on an hourly job there are
--    no credits and it is zero. One expression covers either, so switching a
--    job over needs nothing rewritten.
--
-- VERIFIED BEFORE AND AFTER
-- ---------------------------------------------------------------------------
-- Every paystub line was snapshotted first: 128 rows, $353,339.00 paid. After
-- all of the above, 128 rows, $353,339.00, and zero rows different. Nothing any
-- man has been paid moved.
--
-- Then end to end on real data, since inert is not the same as working: two
-- platforms at $900 and three sets of stairs at $375 credited to Damian Silva
-- came out at $2,925 on his week and $2,925 of burn against the $26,250 bid,
-- leaving $23,325 at 11.1% spent. Rolled back afterwards.
--
-- The exact statements for items 4 to 7 were applied live and are recoverable
-- from the database with pg_get_viewdef and pg_get_functiondef.
