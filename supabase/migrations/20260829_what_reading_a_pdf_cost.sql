-- What each PDF read cost, in our own books rather than only on Anthropic's.
--
-- Reading a PDF is the first thing this portal does that costs money per use.
-- Everything else is a flat bill: Supabase by the month, QuickBooks by the
-- seat. This is metered, and a metered thing nobody is watching is how you end
-- up surprised by an invoice.
--
-- Anthropic's own dashboard shows the total. It cannot show which PDF, whose
-- login, or whether the expensive ones are the fifty-page drawing sets. So the
-- count goes in here, one row per read, priced at the moment it happened.
--
-- WHY THE COST IS STORED AND NOT COMPUTED ON THE WAY OUT
--
-- Rates change. A row priced at today's rate has to keep saying what it cost
-- today, not what the same tokens would cost after the next price change, or
-- last quarter's total quietly rewrites itself every time Anthropic publishes
-- a new number. The rate that produced each figure is written down beside it
-- for the same reason.
--
-- Failures are logged too, with null tokens. A read that fell over still tells
-- you something -- which file, whose login, what went wrong -- and a table that
-- only holds successes cannot answer "why did that one not work".

create table if not exists public.pdf_read_log (
  id              uuid primary key default gen_random_uuid(),
  filename        text not null default '',
  model           text,
  status          text not null default 'read',   -- 'read' or 'error'
  input_tokens    integer,
  output_tokens   integer,
  input_rate_usd  numeric(10,4),                  -- $ per million, as charged that day
  output_rate_usd numeric(10,4),
  cost_usd        numeric(12,6),
  lines_found     integer,
  customer_read   text,                           -- what the document said, not who we matched
  detail          text,
  read_by         uuid references public.profiles(id),
  created_at      timestamptz not null default now()
);

create index if not exists pdf_read_log_created_idx on public.pdf_read_log (created_at desc);

alter table public.pdf_read_log enable row level security;

-- The function writes with the service role, which bypasses this. The policy is
-- here so the office can read its own spend from the browser and nobody else
-- can read it at all.
drop policy if exists pdf_read_log_admin on public.pdf_read_log;
create policy pdf_read_log_admin on public.pdf_read_log
  for select using (public.is_admin(auth.uid()));

comment on table public.pdf_read_log is
  'One row per PDF read on the parts invoice page: tokens, the rate charged at '
  'the time, and what it came to. Written by parse-parts-pdf. Failures are '
  'logged with null tokens.';

-- What it has cost, by day, without anybody having to remember the arithmetic.
create or replace view public.pdf_read_spend as
select
  created_at::date            as day,
  count(*)                    as reads,
  count(*) filter (where status = 'error') as failed,
  sum(input_tokens)           as input_tokens,
  sum(output_tokens)          as output_tokens,
  round(sum(cost_usd), 4)     as cost_usd
from public.pdf_read_log
group by 1
order by 1 desc;

comment on view public.pdf_read_spend is
  'PDF reading cost per day. Reads pdf_read_log, which is admin-only.';
