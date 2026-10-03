// Getting a file onto the company OneDrive: the token, the folder, the upload.
//
// Written for quote filing, following what onedrive-file-statements has done
// inline since pay statements were the only thing filed. That function is
// deliberately NOT changed to import this: it is the one thing on this drive
// that already works every week, and moving its token handling underneath it to
// tidy up a duplicate is not a trade worth making on a payroll path. If a third
// caller ever turns up, move it then and move both together.
//
// ---------------------------------------------------------------------------
// ONE ROW, TWO CALLERS
// ---------------------------------------------------------------------------
// onedrive_tokens holds a single row. Microsoft usually hands back a new refresh
// token when one is spent, so two functions refreshing at the same moment could
// in principle write over each other. Unlike Intuit, Azure AD leaves the old
// refresh token usable -- it expires on 90 days of inactivity, not on first use
// -- so the loser of that race is still holding something that works, and the
// next call settles it. That is why this refreshes in place rather than routing
// every caller through one owner the way the QuickBooks token has to be.
//
// The drive id is read off the row rather than written down here. It is resolved
// once when the office connects the drive and does not change; a folder, on the
// other hand, can be moved or deleted by hand, so folders are always looked up
// by NAME and made if they have gone missing.

// Structurally typed rather than ReturnType<typeof createClient>: without
// generated database types that client infers `never` for every update payload,
// so a write cannot be typechecked at all. invoice-pdf-data.ts takes the same
// way out for the same reason.
export type Admin = {
  // deno-lint-ignore no-explicit-any
  from: (t: string) => any;
};

const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPE = 'offline_access Files.ReadWrite User.Read';

export type DriveHandle = { token: string; driveId: string };

/* A live access token and the drive it belongs to.
   Refreshes when the stored one has run out; the row carries expires_at already
   shortened by a minute, so a token that is about to lapse mid-upload counts as
   expired here rather than failing at Graph. */
export async function driveHandle(
  admin: Admin,
): Promise<{ ok: true; handle: DriveHandle } | { ok: false; error: string }> {
  const { data: tok } = await admin.from('onedrive_tokens')
    .select('*').eq('id', 1).maybeSingle();
  if (!tok) return { ok: false, error: 'OneDrive is not connected. Connect it on the Setup page.' };

  const driveId = tok.drive_id as string;
  if (!driveId) {
    return { ok: false, error: 'The OneDrive connection has no drive on it. Reconnect on Setup.' };
  }

  if (new Date(tok.expires_at as string).getTime() > Date.now()) {
    return { ok: true, handle: { token: tok.access_token as string, driveId } };
  }

  const clientId = (Deno.env.get('MS_CLIENT_ID') || '').trim();
  const clientSecret = (Deno.env.get('MS_CLIENT_SECRET') || '').trim();
  if (!clientId || !clientSecret) {
    return { ok: false, error: 'MS_CLIENT_ID / MS_CLIENT_SECRET are not set.' };
  }
  const tenant = Deno.env.get('MS_TENANT_ID') || 'organizations';

  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: tok.refresh_token as string,
      grant_type: 'refresh_token', scope: SCOPE,
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    return {
      ok: false,
      error: 'OneDrive sign-in has expired. Reconnect it on the Setup page. ('
           + (j.error_description || res.status) + ')',
    };
  }

  const updated = {
    access_token: j.access_token as string,
    // Microsoft usually returns a fresh refresh token; keep the old one if not.
    refresh_token: (j.refresh_token as string) || (tok.refresh_token as string),
    expires_at: new Date(Date.now() + (Number(j.expires_in || 3600) - 60) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  await admin.from('onedrive_tokens').update(updated).eq('id', 1);
  return { ok: true, handle: { token: updated.access_token, driveId } };
}

/* The id of a folder sitting at the top of the drive, made if it is not there.
   Looked up by name every time on purpose: the office moves and re-makes these
   folders, and an id written down in a migration outlives the folder it named. */
export async function ensureRootFolder(
  h: DriveHandle, name: string,
): Promise<string> {
  const enc = encodeURIComponent(name);
  const look = await fetch(`${GRAPH}/drives/${h.driveId}/root:/${enc}`,
    { headers: { Authorization: `Bearer ${h.token}` } });
  if (look.ok) return (await look.json()).id as string;

  const made = await fetch(`${GRAPH}/drives/${h.driveId}/root/children`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${h.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
  });
  if (made.ok) return (await made.json()).id as string;

  // Someone else made it a moment ago; take theirs rather than fail the run.
  const again = await fetch(`${GRAPH}/drives/${h.driveId}/root:/${enc}`,
    { headers: { Authorization: `Bearer ${h.token}` } });
  if (again.ok) return (await again.json()).id as string;
  throw new Error(`could not make the folder "${name}": ${(await made.text()).slice(0, 200)}`);
}

/* Puts the bytes in the folder under that name, over whatever was there before.
   replace, not rename: a quote is revised several times before it goes out, and
   a folder holding "... 1.pdf" and "... 2.pdf" is a folder nobody can read.
   Small files only -- past about 4MB Graph wants an upload session. Quote PDFs
   run 60-120KB. */
export async function uploadFile(
  h: DriveHandle, folderId: string, filename: string, bytes: Uint8Array,
  contentType = 'application/pdf',
): Promise<{ itemId: string; webUrl: string | null }> {
  const put = await fetch(
    `${GRAPH}/drives/${h.driveId}/items/${folderId}:/${encodeURIComponent(filename)}:/content`
      + '?%40microsoft.graph.conflictBehavior=replace',
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${h.token}`, 'Content-Type': contentType },
      // A Blob rather than the raw Uint8Array. Two reasons, both type-level:
      // a BufferSource is not a BodyInit, and a Uint8Array may in principle sit
      // on a SharedArrayBuffer, which a Blob part may not. Copying through a
      // fresh view settles both, and 60-120KB is nothing to copy.
      body: new Blob([new Uint8Array(bytes)], { type: contentType }),
    });
  if (!put.ok) throw new Error(`${put.status} ${(await put.text()).slice(0, 200)}`);
  const item = await put.json().catch(() => ({}));
  return { itemId: String(item.id ?? ''), webUrl: (item.webUrl as string) ?? null };
}
