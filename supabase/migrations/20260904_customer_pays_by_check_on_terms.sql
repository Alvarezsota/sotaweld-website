-- BT Constructors pays by check on Net 30.
--
-- Their invoices were going out with Pay Now on them - card, ACH and PayPal -
-- which offers a payment method they will not use and costs a fee if anybody
-- ever presses it.
--
-- This belongs on qb_customer_billing rather than in a table of its own. That
-- row already is "how this customer's invoices go out": who they are addressed
-- to, who is copied. How they are settled is the same question, keyed the same
-- way, read on the same trip. (A separate customer_billing_prefs table was
-- built first and dropped once that was noticed; the drop is kept below so a
-- database that saw the first version ends up in the same place.)
--
-- Terms are stamped here as well as inherited from the QuickBooks customer
-- record. QuickBooks does inherit them and does today - invoice 2997 came out
-- Net 30, due 29 Sep, with the push saying nothing about terms - but that is a
-- default somebody can change in another screen without anyone noticing. An
-- invoice that must be Net 30 should say Net 30 because it was told to.
--
-- The push reads these two columns in qb-push-invoice/index.ts, in the same
-- lookup that already fetches the To and CC addresses.
--
-- QuickBooks Term ids in this company: 1 Due on receipt, 2 Net 15, 3 Net 30,
-- 4 Net 60.
--
-- Safe to re-run.

drop table if exists public.customer_billing_prefs;

alter table public.qb_customer_billing
  add column if not exists allow_online_payment boolean not null default true,
  add column if not exists qb_term_id           text,
  add column if not exists qb_term_name         text;

comment on column public.qb_customer_billing.allow_online_payment is
  'false turns off card, ACH and PayPal on every invoice pushed for this customer. Default true, which is what QuickBooks does on its own.';
comment on column public.qb_customer_billing.qb_term_id is
  'QuickBooks Term Id stamped on the invoice. 1 Due on receipt, 2 Net 15, 3 Net 30, 4 Net 60. Null leaves the term to QuickBooks.';

insert into public.qb_customer_billing
  (qb_customer_id, qb_environment, qb_customer_name,
   to_email, cc_emails, allow_online_payment, qb_term_id, qb_term_name, note)
values
  ('195', 'production', 'BT Constructors',
   'AP@btconstructors.com', array['Zach.Long@btconstructors.com'],
   false, '3', 'Net 30', 'Pays by check. No card, no ACH, no PayPal.')
on conflict (qb_customer_id, qb_environment) do update
  set allow_online_payment = excluded.allow_online_payment,
      qb_term_id           = excluded.qb_term_id,
      qb_term_name         = excluded.qb_term_name,
      qb_customer_name     = coalesce(public.qb_customer_billing.qb_customer_name, excluded.qb_customer_name),
      note                 = excluded.note,
      updated_at           = now();

notify pgrst, 'reload schema';
