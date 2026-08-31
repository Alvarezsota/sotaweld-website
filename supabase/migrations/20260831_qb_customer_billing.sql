-- Who gets copied when an invoice goes out.
--
-- QuickBooks has no customer-level CC field: BillEmailCc lives on each invoice,
-- so without this the addresses would have to be retyped every time and one
-- would eventually get missed. Keyed on the QuickBooks customer id rather than
-- the job, because seventeen jobs bill to Rocking Double S and a per-job list
-- would mean seventeen edits and a silent miss.
--
-- Keyed by environment too, for the same reason jobs.qb_environment exists: the
-- same customer id is a different company in sandbox.
create table if not exists public.qb_customer_billing (
  qb_customer_id   text not null,
  qb_environment   text not null default 'production',
  qb_customer_name text,
  to_email         text,                       -- overrides the QuickBooks record when set
  cc_emails        text[] not null default '{}',
  bcc_emails       text[] not null default '{}',
  note             text,
  updated_at       timestamptz not null default now(),
  primary key (qb_customer_id, qb_environment)
);

comment on table public.qb_customer_billing is
  'Per-customer invoice recipients. qb-push-invoice stamps these onto BillEmail/BillEmailCc/BillEmailBcc, because QuickBooks only holds CC on the invoice itself.';

alter table public.qb_customer_billing enable row level security;

-- Billing configuration: admins only, read and write. No welder policy at all.
create policy qb_customer_billing_admin
  on public.qb_customer_billing
  for all
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

insert into public.qb_customer_billing
  (qb_customer_id, qb_environment, qb_customer_name, cc_emails, note)
values
  ('8', 'production', 'ROCKING DOUBLE S LLC',
   array['mpalmer@rdbls.com','sam.wilde@rdbls.com','shenry@standardtechresources.com'],
   'AP@RDBLS.com is on the QuickBooks customer record and stays the To. Net 15.')
on conflict (qb_customer_id, qb_environment) do update
  set cc_emails = excluded.cc_emails,
      qb_customer_name = excluded.qb_customer_name,
      note = excluded.note,
      updated_at = now();
