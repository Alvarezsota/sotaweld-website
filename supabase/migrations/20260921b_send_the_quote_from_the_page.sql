-- A quote you cannot send is half a quote desk.
--
-- The desk has drawn a proper letterhead PDF since the quote page was built,
-- and then handed it to the browser as a download. Everything after that was
-- Gilbert's problem: find the file, open Outlook, attach it, remember who it
-- was for, type the covering note. Two Desert Electric quotes went out today
-- and the address of the man they were for was the one thing nobody could see
-- on the page.
--
-- send-quote takes the same PDF the download button gets -- by asking
-- qb-invoice-pdf for it, rather than by drawing a second one that could
-- disagree -- and puts it in front of the customer over Resend, the same way
-- the weld digest goes out.
--
-- What was sent, to whom and when is written down here. A quote whose status
-- says "sent" and cannot say to what address is not a record of anything.

alter table public.desk_quotes
  add column if not exists sent_at timestamptz,
  add column if not exists sent_to text;

comment on column public.desk_quotes.sent_at is
  'When this quote was last emailed to the customer from the Quotes page.';
comment on column public.desk_quotes.sent_to is
  'The addresses it went to, To first then any copies, as they were at the '
  'moment it was sent. Kept as typed rather than re-derived, so a contact '
  'edited afterwards cannot rewrite the history of what was sent.';
