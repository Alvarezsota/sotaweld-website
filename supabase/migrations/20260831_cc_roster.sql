-- Choosing who gets copied, per invoice.
--
-- cc_emails is what the push sends: every address in it is copied. That is
-- right for a customer with one AP clerk who always wants a copy, and wrong the
-- moment there are two people and only one of them wants this particular bill.
--
-- So the roster and the choice are separated. cc_roster is everyone we hold for
-- that customer -- name and address, because the office thinks in "Betsy" and
-- "Wayne", not in mailboxes. cc_emails keeps its meaning exactly: who is copied
-- on the next push. The invoice preview ticks the roster and writes the ticked
-- ones to cc_emails in the moment before it sends.
--
-- Deliberately no change to qb-push-invoice. It already reads cc_emails and
-- sets BillEmailCc from it, so the choice reaches QuickBooks through the column
-- that was already there. Redeploying that function means re-uploading the
-- whole bundle by hand, which is not a thing to do for a feature that does not
-- need it.
--
-- Nothing changes for a customer already set up: every address they have is
-- moved into the roster and stays selected, so the next invoice copies exactly
-- who it copied before.
--
-- Safe to re-run.

alter table public.qb_customer_billing
  add column if not exists cc_roster jsonb not null default '[]'::jsonb;

comment on column public.qb_customer_billing.cc_roster is
  'Everyone we could copy for this customer: [{"name":"Betsy Tytan","email":"..."}]. cc_emails is who is actually copied on the next push, chosen from this.';

-- Seed the roster from what is already being sent, once. Only where there is no
-- roster yet, so re-running never overwrites a curated list.
update public.qb_customer_billing b
   set cc_roster = (
     select coalesce(jsonb_agg(jsonb_build_object('name', '', 'email', e)), '[]'::jsonb)
       from unnest(b.cc_emails) e
      where coalesce(trim(e), '') <> ''
   )
 where jsonb_array_length(b.cc_roster) = 0
   and coalesce(array_length(b.cc_emails, 1), 0) > 0;

notify pgrst, 'reload schema';

select qb_customer_name,
       coalesce(array_length(cc_emails, 1), 0) as copied_on_next_invoice,
       jsonb_array_length(cc_roster)           as on_roster
from public.qb_customer_billing
order by qb_customer_name;
