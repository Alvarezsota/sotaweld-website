-- A quote is addressed to a person, not to a switchboard.
--
-- The desk has had a Contact dropdown on every quote since it was built, and
-- desk_quotes has carried the chosen contact in desk_contact_id all along. It
-- did nothing. rowFromDoc took customer_email off the company record and never
-- looked at the contact, so a quote made out to Omar Olivas printed Desert
-- Electric's switchboard address in the QUOTED TO block, and the only way to
-- tell who it was meant for was to have been the one who picked him.
--
-- quote-pdf.ts already draws a bill_to_attn line directly above the email.
-- buildQuotePdfFor has never passed one, so that line has been blank on every
-- quote this company has ever sent. The contacts themselves live in the desk's
-- state blob rather than in a table, so the PDF builder cannot resolve a name
-- from desk_contact_id on its own -- it needs the name written down beside the
-- address at the time the quote was saved, which is what this column is for.
--
-- Two Desert Electric quotes were written today, SOTA-09-21-2026-01 (Midkiff
-- 304) and -02 (Hoelscher 35-40). Both go to Omar Olivas. Wayne Gluff and
-- Joshua Harris are on the same company and can be picked from the same
-- dropdown, which from now on moves the address on the document with them.

alter table public.desk_quotes
  add column if not exists bill_to_attn text;

comment on column public.desk_quotes.bill_to_attn is
  'The name of the contact this quote is made out to, written down beside '
  'customer_email when the quote is saved. The PDF prints it as the Attn line. '
  'Kept here rather than resolved from desk_contact_id because the contacts '
  'live in the desk state blob, which the PDF builder does not read.';

-- The two quotes written today, addressed to the man they are going to.
update public.desk_quotes
   set desk_contact_id = 'ct_pgudrwi',
       bill_to_attn    = 'Omar Olivas',
       customer_email  = 'oolivas@deserthillsinc.com',
       updated_at      = now()
 where quote_no in ('SOTA-09-21-2026-01', 'SOTA-09-21-2026-02');
