-- Anyone could read the payroll.
--
-- The publishable key sits in the JavaScript on sotaweld.com, so anybody who
-- views source has it, and it acts as the `anon` role. Fifteen security definer
-- functions accepted calls from that role and ten of them never asked who was
-- calling. The worst was week_pay_statements(date): no id to guess, just a
-- Monday, and it handed back every welder's name, hourly pay, what we bill for
-- him, per diem and the margin between the two. Verified as anon before writing
-- this -- sixteen statements came back.
--
-- The fix is the grant, not a guard inside the functions. take_invoice_no is
-- reached by two triggers that fire while the push runs as service_role, where
-- auth.uid() is null; an is_admin() check inside it would refuse to number an
-- invoice on approve. Its four callers are all security definer and run as
-- postgres, so revoking anon and authenticated cannot reach them.
--
-- is_admin is deliberately left alone. It is named by most of the RLS policies
-- on this database, and a policy that cannot execute it raises instead of
-- returning false. It takes a uuid and answers a boolean; that is a fair trade.

-- Read paths. The browser reaches none of these -- the push function and the
-- OneDrive filer call them as service_role, which keeps its own grant.
revoke execute on function public.week_pay_statements(date)          from anon, authenticated;
revoke execute on function public.parts_invoice_payload(uuid)        from anon;
revoke execute on function public.desk_invoice_payload(uuid)         from anon;
revoke execute on function public.rate_sheet_week_lines(uuid)        from anon;
revoke execute on function public.crew_week_inches(date)             from anon;
revoke execute on function public.billing_week_for(uuid, date)       from anon;
revoke execute on function public.bill_anchor_job(uuid, date)        from anon;

-- Spends a real invoice number on every call, and had no guard at all.
revoke execute on function public.take_invoice_no()                  from anon, authenticated;

-- Next-number hints. Harmless on their own, no reason to answer a stranger.
revoke execute on function public.peek_invoice_no()                  from anon;
revoke execute on function public.peek_quote_no(date)                from anon;

-- These already check admin themselves. Closing the grant as well so the check
-- is not the only thing standing there -- take_desk_invoice_no checked admin
-- and then called take_invoice_no, which was wide open next to it.
revoke execute on function public.assign_invoice_no(uuid)            from anon;
revoke execute on function public.take_quote_no(date)                from anon;
revoke execute on function public.take_desk_invoice_no()             from anon;
revoke execute on function public.onedrive_status()                  from anon;

notify pgrst, 'reload schema';

-- Follow-up, applied separately: peek_quote_no also carried a PUBLIC grant
-- underneath its role grants, and anon inherits whatever PUBLIC has, so the
-- revoke above did not close it. Same shape as the bug that left
-- parts_invoice_payload open -- that migration revoked PUBLIC and missed the
-- explicit anon entry; this was the mirror image.
revoke execute on function public.peek_quote_no(date) from public, anon;

notify pgrst, 'reload schema';
