// Begins connecting the company OneDrive, so approved weeks can file their own
// pay statements.
//
// This is deliberately NOT a link the browser follows. qb-oauth-start is a plain
// redirect target with no auth, which is fine for QuickBooks only because a
// second connection there is obvious. Here it would not be: anyone who found the
// URL could run the consent flow with their own Microsoft account and quietly
// repoint the company's pay statements at their personal OneDrive.
//
// So the Setup page calls this with the admin's token, gets a URL back, and sends
// the browser there itself. The state row that the callback insists on can then
// only have been minted by an admin.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Files.ReadWrite is the whole ask: write into the signed-in account's own
// OneDrive. Not Files.ReadWrite.All, which would be every file in the tenant.
// offline_access is what makes it survive past the first hour.
const SCOPES = 'offline_access Files.ReadWrite User.Read';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  // Trimmed: a value pasted into a dashboard field often carries a trailing
  // newline, and Microsoft rejects that with the same message it uses for a
  // completely wrong value.
  const clientId = (Deno.env.get('MS_CLIENT_ID') || '').trim();
  if (!clientId) return json({ error: 'MS_CLIENT_ID is not set on this project yet.' }, 500);
  const tenant = (Deno.env.get('MS_TENANT_ID') || '').trim() || 'organizations';

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Not signed in' }, 401);

  const caller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return json({ error: 'Not signed in' }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (!profile || profile.role !== 'admin') return json({ error: 'Admins only' }, 403);

  const state = crypto.randomUUID() + '.' + crypto.randomUUID();
  const { error: stateErr } = await admin.from('onedrive_oauth_state').insert({ state });
  if (stateErr) return json({ error: 'Could not start: ' + stateErr.message }, 500);

  const redirectUri = `${SUPABASE_URL}/functions/v1/onedrive-oauth-callback`;
  const url = new URL(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('state', state);
  // Force the account picker: the office has more than one Microsoft login around
  // and connecting the wrong one is silent until stubs land somewhere odd.
  url.searchParams.set('prompt', 'select_account');

  return json({ ok: true, url: url.toString(), redirectUri });
});
