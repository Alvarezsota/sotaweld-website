-- The invoice number the portal offers has to be one QuickBooks has not spent.
--
-- WHAT WENT WRONG
--
-- invoice_counter is the portal's own counter. It was seeded once from the
-- portal's own history and then only ever moved by the portal. Invoices typed
-- straight into QuickBooks never touched it -- and two were: 2993 and 2994,
-- both Tino's Machining, both entered on 08-28 and already emailed. The parts
-- invoice tab went on offering "Finish and take 2993" for a number that was
-- not only taken but already in a customer's inbox.
--
-- Finishing a parts invoice spends the number. So the collision was not found
-- until the push, by which point the number was gone and the office had to go
-- change it by hand.
--
-- THE FIX, IN TWO HALVES
--
-- This half: a way to move the counter forward that cannot move it backwards.
-- The other half is in qb-push-invoice, which holds the QuickBooks token and
-- so is the only thing that can ask what the highest number over there is.
--
-- greatest() is the whole safety argument. A wrong answer from QuickBooks --
-- a partial page, a query that came back thin -- can only fail to move the
-- counter far enough, never rewind it onto a number already issued. Handing
-- out the same number twice is the one outcome worth engineering against;
-- skipping a number costs nothing.

create or replace function public.bump_invoice_counter(p_at_least integer)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_no integer;
begin
  if p_at_least is null then
    select next_no into v_no from invoice_counter where id = 1;
    if v_no is null then
      raise exception 'invoice counter is missing';
    end if;
    return v_no::text;
  end if;

  update invoice_counter
     set next_no = greatest(next_no, p_at_least)
   where id = 1
  returning next_no into v_no;

  if v_no is null then
    raise exception 'invoice counter is missing';
  end if;
  return v_no::text;
end;
$$;

comment on function public.bump_invoice_counter(integer) is
  'Moves invoice_counter.next_no forward to at least p_at_least and returns it. '
  'Never moves it backwards. Called by qb-push-invoice after asking QuickBooks '
  'for the highest invoice number on its books. Pass null to just read it.';

-- Only the edge function calls this, and only after QuickBooks has answered.
-- A logged-in browser can read the counter (peek_invoice_no) and spend one
-- (take_invoice_no); it has no business shoving the counter forward on its
-- own say-so.
revoke all on function public.bump_invoice_counter(integer) from public, anon, authenticated;
grant execute on function public.bump_invoice_counter(integer) to service_role;
