-- The page that bills work with no job week behind it is called Parts and
-- Services now, because a lot of what goes on it is shop and service work --
-- repairs, flange work, weld-outs -- not plate off the laser.
--
-- Two strings inside parts_invoice_payload still said "Parts cut": the memo it
-- falls back to when the note field is left blank, and the job_name the portal
-- shows on the preview sheet. Gilbert asked for both to read the same thing as
-- the hint under the note field, so the sheet he checks before pushing and the
-- note that lands in QuickBooks agree.
--
-- The memo goes to PrivateNote, which QuickBooks keeps on its own side of the
-- invoice. What the customer's office reads is CustomerMemo, and that is built
-- from the PO number and the company rep -- untouched here.
--
-- Patched in place rather than rewritten, so nothing else in the function can
-- drift. If either string is missing the whole thing is refused.
do $do$
declare
  src  text;
  hits int;
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'parts_invoice_payload';

  if src is null then
    raise exception 'public.parts_invoice_payload is not there to patch';
  end if;

  select count(*) into hits from regexp_matches(src, $q$Parts cut$q$, 'g');
  if hits <> 2 then
    raise exception 'expected 2 occurrences of the old wording, found %', hits;
  end if;

  execute replace(src, $q$Parts cut$q$, $q$Parts and Services$q$);
end
$do$;

notify pgrst, 'reload schema';
