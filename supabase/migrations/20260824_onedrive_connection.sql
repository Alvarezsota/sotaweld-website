-- OneDrive connection, so approved weeks can file their own pay statements.
--
-- Applied to production 2026-08-24. Shaped after qb_oauth_state /
-- qb_oauth_tokens on purpose: there is already one OAuth connection in this
-- system and one pattern for it, and a second one that works differently is a
-- second thing to remember at 2am.
--
-- ---------------------------------------------------------------------------
-- WHY THE TOKENS ARE LOCKED HARDER THAN THE REST OF THE SCHEMA
-- ---------------------------------------------------------------------------
--
-- These two rows are a standing key to the company's OneDrive. RLS is on and no
-- policy grants anything to anybody, so only the service role - which lives in
-- the edge functions and never reaches a browser - can read them. The Setup page
-- does not select from these tables; it asks onedrive_status(), which answers
-- whether a connection exists and who owns it and nothing that could be replayed.
--
-- ---------------------------------------------------------------------------
-- WHY CONNECTING IS NOT JUST A LINK
-- ---------------------------------------------------------------------------
--
-- qb-oauth-start is a plain redirect target with no auth. That is survivable for
-- QuickBooks because a second connection there is loud. Here it would be quiet
-- and expensive: anyone who found the URL could run the consent flow with their
-- own Microsoft account and repoint the company's pay statements at their
-- personal OneDrive, and nothing on screen would look wrong.
--
-- So onedrive-oauth-start requires an admin's token and hands back a URL rather
-- than redirecting. The state row it writes is what the callback insists on, and
-- it is spent before the code is exchanged, so a replayed link buys nothing.

create table if not exists public.onedrive_oauth_state (
  state       text primary key,
  created_at  timestamptz not null default now(),
  used_at     timestamptz
);

create table if not exists public.onedrive_tokens (
  id                 integer primary key default 1 check (id = 1),
  access_token       text        not null,
  refresh_token      text        not null,
  expires_at         timestamptz not null,
  account            text,
  drive_id           text,
  root_folder_id     text,
  connected_by       text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.onedrive_tokens is
  'The single OneDrive connection used to file pay statements. One row, id = 1. Service role only.';
comment on column public.onedrive_tokens.drive_id is
  'Graph driveId of the OneDrive the statements are filed into, resolved once at connect time.';
comment on column public.onedrive_tokens.root_folder_id is
  'Item id of the "New System Pay Stubs" folder. Week folders are created inside it.';

alter table public.onedrive_oauth_state enable row level security;
alter table public.onedrive_tokens      enable row level security;

create or replace function public.onedrive_status()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare t public.onedrive_tokens;
begin
  if not public.is_admin(auth.uid()) then raise exception 'not authorized'; end if;
  select * into t from public.onedrive_tokens where id = 1;
  if not found then
    return jsonb_build_object('connected', false);
  end if;
  return jsonb_build_object(
    'connected', true,
    'account', t.account,
    'folder_ready', t.root_folder_id is not null,
    'connected_by', t.connected_by,
    'connected_at', t.created_at,
    'expires_at', t.expires_at);
end;
$function$;

revoke all on function public.onedrive_status() from public;
grant execute on function public.onedrive_status() to authenticated;

-- Edge functions deployed alongside this:
--   onedrive-oauth-start     verify_jwt on,  admins only, returns the consent URL
--   onedrive-oauth-callback  verify_jwt off, Microsoft redirects here; the state
--                            row stands in for the token check
--
-- Secrets these need on the project (Edge Functions -> Secrets):
--   MS_CLIENT_ID      the Entra app's Application (client) ID
--   MS_CLIENT_SECRET  a client secret from that app
--   MS_TENANT_ID      optional; defaults to 'organizations'
