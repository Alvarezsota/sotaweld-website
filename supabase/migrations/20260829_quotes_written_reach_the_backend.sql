-- Quotes written on the Quote Desk, on the backend where the rest of the
-- business is.
--
-- The desk keeps everything it knows in one JSON document in quote_desk_state.
-- That is right for the desk -- it is one screen, one operator, and a blob it
-- can rewrite whole is simpler than a schema -- but it means a quote written
-- there is invisible to every other page. The dashboard could tell you who had
-- rung in asking for a price and not one thing about the prices actually
-- quoted.
--
-- So a quote gets mirrored here as it is saved. Rows, not JSON, because the
-- dashboard wants to sort and total them and the next thing to want them will
-- too.
--
-- THIS IS A MIRROR, NOT THE RECORD
--
-- The desk still owns the document. Nothing here is edited by hand and nothing
-- reads back into the desk. If the two ever disagree the desk is right, and
-- saving the quote again puts this straight. That is the same arrangement
-- desk_invoices already has, and it is deliberate: two places that both think
-- they own the same quote is how you end up sending a customer a price the
-- office had already changed.
--
-- Quote requests -- the enquiries off the website -- stay in their own table.
-- One is somebody waiting on a phone call, the other is a price already sent.
-- Putting them in one list makes the first kind easy to lose.

create table if not exists public.desk_quotes (
  id             uuid primary key default gen_random_uuid(),
  doc_id         text not null unique,          -- the desk's own id for it
  quote_no       text,
  quote_date     date,
  customer_name  text not null default '',
  job_name       text not null default '',
  scope          text not null default '',
  total          numeric(14,2) not null default 0,
  status         text not null default 'draft',
  valid_days     integer,
  invoiced_no    text,                          -- set once it becomes an invoice
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists desk_quotes_date_idx on public.desk_quotes (quote_date desc);
create index if not exists desk_quotes_status_idx on public.desk_quotes (status);

alter table public.desk_quotes enable row level security;

drop policy if exists desk_quotes_admin on public.desk_quotes;
create policy desk_quotes_admin on public.desk_quotes
  for all using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create or replace function public.tg_desk_quotes_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists desk_quotes_touch on public.desk_quotes;
create trigger desk_quotes_touch before update on public.desk_quotes
  for each row execute function public.tg_desk_quotes_touch();

comment on table public.desk_quotes is
  'Quotes written on the Quote Desk, mirrored out of quote_desk_state as they '
  'are saved so the dashboard can show them. The desk owns the document; this '
  'is a read-only copy for other screens and is rewritten on every save.';

-- The dashboard listens on this table the way it already listens on
-- announcements and quote_requests, so a quote saved on the desk in the truck
-- shows up on the screen in the office without anybody reloading anything.
alter publication supabase_realtime add table public.desk_quotes;
