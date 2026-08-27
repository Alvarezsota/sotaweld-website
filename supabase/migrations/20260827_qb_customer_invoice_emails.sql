-- Where each customer's invoices should be emailed. QuickBooks keeps one
-- address on the customer record and nothing for carbon copies, so the CC list
-- has to ride along on the invoice itself. Storing it here means the push sets
-- it every time instead of retyping four addresses per invoice.
alter table qb_customers
  add column if not exists bill_email    text,
  add column if not exists bill_email_cc text;

comment on column qb_customers.bill_email is
  'Overrides the address QuickBooks has on the customer. Left null, QuickBooks uses its own.';
comment on column qb_customers.bill_email_cc is
  'Comma-separated carbon copies. QuickBooks caps this field, so keep it under 200 characters.';
