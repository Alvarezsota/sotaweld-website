// Where Microsoft sends the office back after they approve the connection.
//
// Microsoft redirects a browser here, so this cannot require a Supabase token and
// runs with verify_jwt off. What stands in for it is the state value: it is single
// use and only onedrive-oauth-start mints one, and that function admits admins
// only. A code arriving with a state we did not issue, or one already spent, is
// refused before anything is exchanged.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const DONE_URL = 'https://sotaweld.com/employee/admin-setup.html';

// The one folder everything is filed under. Week folders live inside it.
const ROOT_FOLDER = 'New System Pay Stubs';

function page(title: string, body: string, ok: boolean) {
  return new Response(`<!doctype html><html><head><meta charset="utf-8">
<title>${title}</title><style>
 body{margin:0;background:#faf9f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1c1917;}
 .w{max-width:520px;margin:60px auto;padding:26px 28px;background:#fff;border:1px solid #e7e5e4;border-radius:12px;}
 h1{font-size:17px;text-transform:uppercase;letter-spacing:.04em;margin:0 0 10px;color:${ok ? '#1c1917' : '#b4231e'};}
 p{font-size:14px;line-height:1.6;color:#57534e;margin:0 0 14px;}
 a{display:inline-block;margin-top:6px;background:#1c1917;color:#fff;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:8px;}
</style></head><body><div class="w"><h1>${title}</h1>${body}
<a href="${DONE_URL}">Back to Setup</a></div></body></html>`,
    { status: ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

async function graph(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: res.ok, status: res.status, body: body as Record<string, unknown> };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const err = url.searchParams.get('error_description') || url.searchParams.get('error');

  if (err) return page('Microsoft turned that down', `<p>${err}</p>`, false);
  if (!code || !state) return page('Something is missing', '<p>That link did not carry a code and a state, so there is nothing to finish.</p>', false);

  // Trimmed on the way in. A secret pasted into a dashboard field very often
  // arrives with a trailing newline or a stray space, and Microsoft rejects it
  // with the same message it uses for a completely wrong secret - so an invisible
  // character looks exactly like the wrong column.
  const clientId = (Deno.env.get('MS_CLIENT_ID') || '').trim();
  const clientSecret = (Deno.env.get('MS_CLIENT_SECRET') || '').trim();
  const rawSecret = Deno.env.get('MS_CLIENT_SECRET') || '';
  if (!clientId || !clientSecret) {
    return page('Not set up yet', '<p>MS_CLIENT_ID and MS_CLIENT_SECRET are not set on this project. Add them under Edge Functions secrets and connect again.</p>', false);
  }
  const tenant = Deno.env.get('MS_TENANT_ID') || 'organizations';
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Single use, and only ever issued to an admin. Spend it before exchanging the
  // code, so a replayed link cannot be exchanged a second time.
  const { data: spent, error: spendErr } = await admin
    .from('onedrive_oauth_state')
    .update({ used_at: new Date().toISOString() })
    .eq('state', state).is('used_at', null).select('state');
  if (spendErr) return page('Could not finish', `<p>${spendErr.message}</p>`, false);
  if (!spent || spent.length === 0) {
    return page('That link is stale', '<p>This connect link was already used, or was not started from the Setup page. Start it again from Setup.</p>', false);
  }

  const redirectUri = `${SUPABASE_URL}/functions/v1/onedrive-oauth-callback`;
  const form = new URLSearchParams({
    client_id: clientId, client_secret: clientSecret, code,
    grant_type: 'authorization_code', redirect_uri: redirectUri,
    scope: 'offline_access Files.ReadWrite User.Read',
  });
  const tokenRes = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form,
  });
  const tok = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tok.access_token || !tok.refresh_token) {
    // "Invalid client secret" is the one failure a person cannot debug from the
    // message, because the secret is write-only once it is saved. So describe the
    // shape of what this project is actually using - never the value itself -
    // which is enough to tell the Secret ID from the Value, or to catch a stray
    // newline, without anybody having to reveal a credential to read an error.
    let hint = '';
    if (String(tok.error_description || '').includes('7000215')) {
      const isGuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientSecret);
      const notes: string[] = [`${clientSecret.length} characters`];
      if (rawSecret !== clientSecret) notes.push('with a space or newline around it, which has been trimmed off');
      if (!/[~._-]/.test(clientSecret)) notes.push('with none of the ~ . _ - marks a secret Value normally carries');
      hint = `<p style="background:#faf9f7;border:1px solid #e7e5e4;border-radius:8px;padding:12px 14px;">
        <b>What this project is using:</b> ${notes.join(', ')}.<br>` +
        (isGuid
          ? 'That is a GUID, so it is the <b>Secret ID</b> column. You need the <b>Value</b> column beside it, which is only shown at the moment the secret is created.'
          : 'A client secret Value is usually around 40 characters and mixes letters, digits and punctuation. If that does not match what you copied, the paste was cut short.')
        + '</p>';
    }
    return page('Microsoft would not issue a token',
      `<p>${tok.error_description || tokenRes.status}</p>${hint}`, false);
  }

  const access = tok.access_token as string;

  // Who did we just connect, and which drive is theirs. Resolved once now rather
  // than on every upload: it does not change, and a stub run is not the moment to
  // discover that it cannot be looked up.
  const me = await graph(access, '/me');
  const drive = await graph(access, '/me/drive');
  if (!drive.ok || !drive.body?.id) {
    return page('No OneDrive on that account',
      `<p>Signed in as ${(me.body?.userPrincipalName as string) || 'that account'}, but it has no OneDrive this app can write to.</p>`, false);
  }
  const driveId = drive.body.id as string;

  // Put the filing folder in place at connect time. If it is already there we use
  // it; the office has one and it already holds the weeks done by hand.
  let rootId: string | null = null;
  const existing = await graph(access, `/me/drive/root:/${encodeURIComponent(ROOT_FOLDER)}`);
  if (existing.ok && existing.body?.id) {
    rootId = existing.body.id as string;
  } else {
    const made = await graph(access, '/me/drive/root/children', {
      method: 'POST',
      body: JSON.stringify({ name: ROOT_FOLDER, folder: {}, '@microsoft.graph.conflictBehavior': 'rename' }),
    });
    if (made.ok && made.body?.id) rootId = made.body.id as string;
  }

  const expiresAt = new Date(Date.now() + (Number(tok.expires_in || 3600) - 60) * 1000).toISOString();
  const { error: saveErr } = await admin.from('onedrive_tokens').upsert({
    id: 1,
    access_token: access,
    refresh_token: tok.refresh_token as string,
    expires_at: expiresAt,
    account: (me.body?.userPrincipalName as string) || null,
    drive_id: driveId,
    root_folder_id: rootId,
    connected_by: (me.body?.displayName as string) || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });
  if (saveErr) return page('Connected, but not saved', `<p>${saveErr.message}</p>`, false);

  return page('OneDrive connected', `<p>Signed in as
    <b>${(me.body?.userPrincipalName as string) || 'that account'}</b>.
    Approved weeks will file their pay statements into
    <b>${ROOT_FOLDER}</b>, one folder per week.</p>`, true);
});
