-- A QuickBooks invoice id is written back onto the row the moment the push
-- succeeds. If the same id can land on two rows, the same work has been billed
-- to the customer twice, and the only thing standing in the way was application
-- code -- the push reads the row, sees an id, and declines. That check is right,
-- but it is a check, and a check can be raced or bypassed by a hand-run update.
--
-- job_weeks has had this index since the carry-trigger work. Parts and Services
-- invoices never got it, and converted quotes are about to start landing in
-- that table, so it goes on now. desk_invoices gets the same guard: it is on
-- its way out, but it pushes through the same function today and holds two real
-- synced invoices.
--
-- Partial, because an unpushed invoice has a null id and there can be any
-- number of those side by side. Checked: three fresh drafts still insert
-- happily, and a second row claiming id 2239 is refused.
--
-- Note this does not stop two rows sharing an invoice NUMBER, and must not --
-- a held-open invoice is precisely that. 2987 sits on two job_weeks today, the
-- parent holding the QuickBooks id and the child holding none.
create unique index if not exists parts_invoices_qb_invoice_id_key
  on public.parts_invoices (qb_invoice_id) where (qb_invoice_id is not null);

create unique index if not exists desk_invoices_qb_invoice_id_key
  on public.desk_invoices (qb_invoice_id) where (qb_invoice_id is not null);
