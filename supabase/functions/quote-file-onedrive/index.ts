// Files a quote's PDF into the Quotes folder on the company OneDrive.
//
// WHY THIS IS ITS OWN FUNCTION
// ---------------------------------------------------------------------------
// The filing belongs logically inside qb-invoice-pdf, which is where every
// quote PDF in the portal is drawn. It is not there because that function's
// bundle carries the whole document stack -- invoice-pdf, invoice-pdf-data and
// quote-pdf, about seventy kilobytes -- and a deploy has to send every file in
// the bundle, every time. Re-sending the invoice drawing code to add filing to
// quotes risks breaking invoices to fix a convenience on quotes. That is a bad
// trade. This function carries the Graph calls and nothing else, so filing can
// be changed without the invoice letterhead ever being in the blast radius.
//
// It asks qb-invoice-pdf for the document rather than drawing its own, so there
// is still exactly one quote PDF in the system. The caller's own Authorization
// is forwarded for that: qb-invoice-pdf admits a signed-in admin, and the
// service key is not a user.
//
// Filing never fails the quote. The quote is already saved and the document is
// already in the office's hands by the time anything here runs.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { driveHandle, ensureRootFolder, uploadFile } from '../_shared/onedrive.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

// Where the office keeps them, at the top of the drive. Looked up by this name
// on every run and made if it has gone; the id is never written down.
const QUOTES_FOLDER = 'Quotes';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/* The name the document is FILED under, which is not the name it downloads as.
   The customer's copy leads with the word Quote and the company it went to,
   which is what you want on an attachment in somebody's inbox. The folder wants
   the quote number first, so a listing sorts into the order the quotes were
   written -- which is how the office has been naming them by hand. */
export function quoteFilingName(quoteNo: string, jobName: string): string {
  const clean = (v: string) =>
    (v || '').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
  const no = clean(quoteNo);
  const what = clean(jobName);
  if (!no && !what) return 'Quote (unnumbered).pdf';
  if (!no) return `${what}.pdf`.slice(0, 120);
  if (!what) return `${no}.pdf`;
  // Trimmed to fit, and never left ending on a space or a dash.
  return `${no} - ${what}`.slice(0, 116).replace(/[\s-]+$/, '') + '.pdf';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const json = (b: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(b), {
      status, headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  try {
    const auth = req.headers.get('Authorization') ?? '';
    const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: auth } },
    });
    const { data: who } = await asCaller.auth.getUser();
    if (!who?.user) return json({ ok: false, error: 'not signed in' }, 401);

    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: me } = await db.from('profiles')
      .select('role').eq('id', who.user.id).maybeSingle();
    if (me?.role !== 'admin') return json({ ok: false, error: 'admins only' }, 403);

    const body = await req.json().catch(() => ({}));
    const quoteId = body.quote_id ? String(body.quote_id) : '';
    if (!quoteId) return json({ ok: false, error: 'quote_id is required' }, 400);

    const { data: q } = await db.from('desk_quotes')
      .select('id, quote_no, job_name').eq('id', quoteId).maybeSingle();
    if (!q) return json({ ok: false, error: 'that quote could not be found' }, 404);

    // Microsoft first. Drawing the document costs three font downloads and a
    // render, and there is no sense paying for it to then find the drive is not
    // connected.
    const got = await driveHandle(db as never);
    if (!got.ok) return json({ ok: false, error: got.error }, 422);

    // The same document the download button hands over, asked for the same way,
    // with the caller's own token. There is one quote PDF in this system.
    const drawn = await fetch(`${SUPABASE_URL}/functions/v1/qb-invoice-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ quote_id: quoteId }),
    });
    if (!drawn.ok) {
      const why = await drawn.json().catch(() => ({}));
      return json({ ok: false, error:
        `the quote could not be drawn, so nothing was filed: ${why.error ?? drawn.status}` }, 422);
    }
    const pdf = new Uint8Array(await drawn.arrayBuffer());

    const filename = quoteFilingName(
      String(q.quote_no ?? ''), String(q.job_name ?? ''));

    const folderId = await ensureRootFolder(got.handle, QUOTES_FOLDER);
    const { itemId, webUrl } = await uploadFile(got.handle, folderId, filename, pdf);

    // Written back so the portal can link straight at the filed copy, and so a
    // later render knows there is already an item there under that name.
    const { error: saveErr } = await db.from('desk_quotes')
      .update({ onedrive_item_id: itemId || null, onedrive_url: webUrl })
      .eq('id', quoteId);
    if (saveErr) {
      // The file IS on the drive. Say so, and say the row did not catch up --
      // reporting this as a failed upload would send somebody looking for a
      // file that is sitting right there.
      return json({ ok: false, filed: true, filename, url: webUrl,
        error: `filed as "${filename}" but desk_quotes was not updated: ${saveErr.message}` }, 207);
    }

    return json({ ok: true, filed: true, filename, item_id: itemId, url: webUrl });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
