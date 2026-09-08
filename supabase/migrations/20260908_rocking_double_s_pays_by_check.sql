-- Rocking Double S pays by check.
--
-- Their invoices keep going out with Pay Now on them -- card, ACH and PayPal --
-- and he keeps clearing it by hand afterwards. He did it on 2997 and 2987 came
-- out with all three switched on again, because nothing was written down: the
-- flags were left to whatever QuickBooks does on its own, which is to offer
-- them. Offering a payment method a customer will not use is noise on the bill,
-- and a fee if anybody ever presses it.
--
-- Same mechanism as BT Constructors. allow_online_payment false makes the push
-- send AllowOnlineCreditCardPayment, AllowOnlineACHPayment and AllowIPNPayment
-- all false; QuickBooks derives AllowOnlinePayment and the PayPal flag from
-- those, so clearing them clears the Pay Now button and everything under it.
--
-- TERMS ARE DELIBERATELY LEFT ALONE. BT Constructors has Net 30 stamped because
-- he said Net 30. Nobody has said anything about this customer's terms, and
-- they are working: their QuickBooks record carries Net 15 and 2987 came out
-- dated 09-04 and due 09-19. Stamping a term nobody asked for is a number that
-- then has to be remembered in two places. Their note already records what it
-- is, and it can be stamped here the moment there is a reason to.
--
-- Safe to re-run.

update public.qb_customer_billing
   set allow_online_payment = false,
       note = 'AP@RDBLS.com is the To, set explicitly - leaving it null produced '
              || 'an invoice with a CC and no To. Net 15, inherited from the '
              || 'QuickBooks customer record rather than stamped. Pays by check: '
              || 'no card, no ACH, no PayPal.',
       updated_at = now()
 where qb_customer_id = '8'
   and qb_environment = 'production';

-- The row is created by the customer-billing screen and has existed since
-- August, but a migration that quietly does nothing on a database where it
-- does not is worse than one that says so.
do $check$
begin
  if not exists (
    select 1 from public.qb_customer_billing
     where qb_customer_id = '8' and qb_environment = 'production'
       and allow_online_payment = false
  ) then
    raise exception
      'STOP: no production billing row for QuickBooks customer 8 (Rocking Double S) was updated.';
  end if;
end
$check$;

notify pgrst, 'reload schema';
