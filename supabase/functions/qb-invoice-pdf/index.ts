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
// ---------------------------------------------------------------------------
// WHAT ATTACHING IS FOR NOW
// ---------------------------------------------------------------------------
//
// The push attaches the letterhead invoice itself, the moment it has the
// number. So attach:true here is no longer how it normally gets there -- it is
// the way back for the two cases the push does not cover:
//
//   a drawing that failed. The invoice is on their books and the number is
//   written down; only the document is missing, and re-pushing to get it would
//   bill the customer twice.
//
//   an invoice entered after the fact. Several are 'synced' against a real
//   QuickBooks invoice with qb_pushed_at never set, because they were written
//   up here after they had already been billed over there. They must never be
//   pushed. This finds them by qb_invoice_id, the same as any other, and
//   touches nothing but the attachment.
//
// Re-running it replaces the document rather than adding a second one, so
// there is no harm in pressing it twice.
//
// A draft is refused: no qb_invoice_id means no number, and the no-number
// document is a draft, which is not what goes on a customer's bill. Ask for it
// without attach:true to read one.
//
// Admin only, the same as the crew sheet, and for the same reason: an invoice
// carries a customer's prices, which is not a welder's to pull.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { attachInvoicePdf, buildPartsInvoicePdf, buildQuotePdfFor } from '../_shared/invoice-pdf-data.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'content-disposition, x-invoice-draft',
};

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
      const done = await attachInvoicePdf(db as never, String(invoiceId), {
        pushUrl: `${SUPABASE_URL}/functions/v1/qb-push-invoice`,
        callerAuth: auth,
      });
      return done.ok
        ? json({ ok: true, attached: true, filename: done.filename, replaced: done.replaced })
        : json({ ok: false, attached: false, error: done.error }, 422);
    }

    const out = quoteId
      ? await buildQuotePdfFor(db as never, String(quoteId))
      : await buildPartsInvoicePdf(db as never, String(invoiceId));
    if (!out.ok) return json({ ok: false, error: out.error }, 422);

    return new Response(out.pdf, {
      headers: {
        ...CORS,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${out.filename.replace(/"/g, '')}"`,
        // So the page can say which of the two it just handed over without
        // opening the file.
        'X-Invoice-Draft': out.draft ? '1' : '0',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
