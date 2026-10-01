// Hands back a document on our letterhead: an invoice, or the quote it came
// from. Both, because they are the same letterhead drawn by the same code and
// splitting them into two functions would only be two places to keep in step.
//
// QuickBooks emails its own invoice and that stays the bill of record. It shows
// "Welding Services  1  $4,418.80" and the customer cannot check a thing from
// it. This is the document that shows the work: every line, the quantity, the
// unit, the price and what it came to, under the scope, the basis and the terms.
//
// Sits apart from the push on purpose. The push owns REFRESHING the QuickBooks
// token, and Intuit rotates the refresh token on every use, so a second
// function refreshing the same row would race it and the loser disconnects the
// portal. This one only ever READS the token; when it is close to expiry it
// asks the push to run its own sync_invoice_no, which refreshes as a side
// effect of work the portal does on every page load anyway. One refresher.
//
// Admin only, the same as the crew sheet, and for the same reason: an invoice
// carries a customer's prices, which is not a welder's to pull.
//
// ---------------------------------------------------------------------------
// THE ONE EXCEPTION, AND WHY IT IS SAFE
// ---------------------------------------------------------------------------
// file_only, with the shared hook secret instead of an admin's token. It draws
// a quote and files it to the company OneDrive, and answers with the filename
// and the drive's link -- never the document, never a line, never a figure. So
// it hands a caller nothing it did not already have to be on the company drive
// to read, which is the same bargain onedrive-file-statements makes with the
// same secret. It exists to put the quotes written before this change into the
// folder, and to put one back if it ever goes missing.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { attachInvoicePdf, buildPartsInvoicePdf, buildQuotePdfFor } from '../_shared/invoice-pdf-data.ts';
import { fileQuotePdf, fileQuotePdfDetached } from '../_shared/quote-filing.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sota-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'content-disposition',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const json = (b: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(b), {
      status, headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  try {
    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    // Read once: a request body is a stream and cannot be read twice, and the
    // filing door below needs to see it before the admin check.
    const body = await req.json().catch(() => ({}));

    /* ---------- the filing door ----------
       Only ever files, only ever a quote, and answers with no part of the
       document. Checked before the admin door because it carries no user token
       at all -- a trigger or a backfill has no person attached to it. */
    if (body.file_only === true) {
      const secret = req.headers.get('x-sota-secret') ?? '';
      const { data: row } = await db.from('app_settings')
        .select('value').eq('key', 'summary_hook_secret').maybeSingle();
      if (!secret || !row?.value || secret !== row.value) {
        return json({ ok: false, error: 'not allowed' }, 403);
      }

      // One quote by id, or every quote, oldest first so a backfill fills the
      // folder in the order the quotes were written.
      const wanted: { id: string }[] = body.quote_id
        ? [{ id: String(body.quote_id) }]
        : (((await db.from('desk_quotes').select('id')
              .order('quote_date', { ascending: true })).data ?? []) as { id: string }[]);
      if (!wanted.length) return json({ ok: false, error: 'no quotes to file' }, 404);

      const filed: { filename: string; url: string | null }[] = [];
      const failed: { quote: string; why: string }[] = [];
      for (const q of wanted) {
        const drawn = await buildQuotePdfFor(db as never, q.id);
        if (!drawn.ok) { failed.push({ quote: q.id, why: drawn.error }); continue; }
        // Awaited here, unlike the download path: the caller is asking about
        // the filing itself, and a backfill that quietly filed nothing would
        // be worse than an error. There is no quote to protect in this path.
        const out = await fileQuotePdf(
          db as never, q.id, drawn.filedAs ?? drawn.filename, drawn.pdf);
        if (out.ok) filed.push({ filename: out.filename, url: out.webUrl });
        else failed.push({ quote: q.id, why: out.why });
      }
      return json({
        ok: failed.length === 0,
        filed: filed.length, failed: failed.length,
        files: filed, failures: failed,
      }, failed.length ? 207 : 200);
    }

    /* ---------- the document door: an admin, as before ---------- */
    const auth = req.headers.get('Authorization') ?? '';
    const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: auth } },
    });
    const { data: who } = await asCaller.auth.getUser();
    if (!who?.user) return json({ ok: false, error: 'not signed in' }, 401);

    const { data: me } = await db.from('profiles')
      .select('role').eq('id', who.user.id).maybeSingle();
    if (me?.role !== 'admin') return json({ ok: false, error: 'admins only' }, 403);

    const invoiceId = body.parts_invoice_id ?? null;
    const quoteId = body.quote_id ?? null;
    if (!invoiceId && !quoteId) {
      return json({ ok: false, error: 'parts_invoice_id or quote_id is required' }, 400);
    }
    if (invoiceId && quoteId) {
      return json({ ok: false, error: 'ask for one or the other, not both' }, 400);
    }

    // attach: draw it and put it on the QuickBooks invoice so it goes out with
    // the bill, rather than handing the bytes back for somebody to remember.
    if (body.attach === true) {
      if (!invoiceId) return json({ ok: false, error: 'attaching needs a parts_invoice_id' }, 400);
      const done = await attachInvoicePdf(
        db as never, String(invoiceId),
        `${SUPABASE_URL}/functions/v1/qb-push-invoice`, auth,
      );
      return done.ok
        ? json({ ok: true, attached: true, filename: done.filename })
        : json({ ok: false, attached: false, error: done.error }, 422);
    }

    const out = quoteId
      ? await buildQuotePdfFor(db as never, String(quoteId))
      : await buildPartsInvoicePdf(db as never, String(invoiceId));
    if (!out.ok) return json({ ok: false, error: out.error }, 422);

    /* Every quote PDF in the portal comes through here -- the download button,
       send-quote and quote-outlook-draft both fetch the document from this
       function rather than drawing their own -- so filing it here covers the
       first render and every revision after it, in one place.

       Not awaited. The office pressed a button and is waiting on a download;
       Microsoft is not on that path. fileQuotePdfDetached swallows its own
       failures and logs them, so a drive that is disconnected or slow costs
       nothing but a null in onedrive_item_id. */
    if (quoteId && out.filedAs) {
      // Its own copy of the bytes. The same array is about to become the body
      // of the response below, and the upload outlives that response; handing
      // both the one buffer is the sort of thing that works until the day the
      // runtime decides a body it has finished with is a buffer it can reuse.
      fileQuotePdfDetached(db as never, String(quoteId), out.filedAs, new Uint8Array(out.pdf));
    }

    return new Response(out.pdf, {
      headers: {
        ...CORS,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${out.filename.replace(/"/g, '')}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
