-- The office can fix a login without asking me.
--
-- "You should put it on the back end page for admin, so that way I can do it
-- without having to ask you every time."
--
-- Fair. Three of these came through by hand in one morning:
--   David Monge  -- added with no email, so the portal invented a username
--                   (david.monge.dpgy@crew.sotaweld.com) which is not an inbox.
--                   No invite could ever reach it and there was no way to put a
--                   real address on him from the Setup page.
--   Aldo Galindo -- invited properly, did not open the link inside its day, and
--                   woke up with no password and no way to make one.
--   Esben Hernandez -- same as David, still outstanding.
--
-- Two things were missing. The office could not SEE the address a man signs in
-- with, because it lives in auth.users and the browser cannot read that. And
-- there was no way to change it, or to cut him a link to set his own password.

create or replace function public.crew_logins()
 returns table(id uuid, email text, confirmed boolean, has_password boolean,
               last_sign_in_at timestamptz, invited_at timestamptz)
 language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admins only.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select u.id, u.email::text,
         u.email_confirmed_at is not null,
         coalesce(u.encrypted_password, '') <> '',
         u.last_sign_in_at, u.invited_at
  from auth.users u join profiles p on p.id = u.id;
end;
$$;
grant execute on function public.crew_logins() to authenticated;

-- Who else already signs in with an address. Returns the NAME so the office
-- gets "Jose Franco already signs in with that address" instead of a constraint
-- error nobody can act on. Service role only: it is called by admin-set-email,
-- which has already established the caller is an admin.
create or replace function public.email_already_used(p_email text, p_except uuid)
 returns text
 language plpgsql stable security definer set search_path to 'public'
as $$
declare who text;
begin
  select coalesce(p.full_name, u.email) into who
  from auth.users u
  left join profiles p on p.id = u.id
  where lower(u.email) = lower(p_email) and u.id is distinct from p_except
  limit 1;
  return who;
end;
$$;
revoke all on function public.email_already_used(text, uuid) from public, anon, authenticated;
grant execute on function public.email_already_used(text, uuid) to service_role;

-- The change itself needs the service role, so it is an edge function:
-- supabase/functions/admin-set-email. It changes the address, confirms it (for
-- the same reason admin-set-password does -- a man should not be left with a
-- working password on an account he has to confirm from a mailbox that does not
-- exist), and can cut a recovery link. The link is RETURNED as well as emailed,
-- because half this crew has an address that bounces or is never read, and a
-- link Gilbert can text is the difference between a man logging in today and
-- another message to the office.
