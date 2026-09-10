// Hands back the letterhead invoice for one Parts and Services invoice as a PDF.
//
// QuickBooks emails its own invoice and that stays the bill of record. It shows
// "Welding Services  1  $4,418.80" and the customer cannot check a thing from
// it. This is the document that shows the work: every line, the quantity, the
// unit, the price and what it came to, under the scope, the basis and the terms.
//
// Sits apart from the push on purpose. The push owns the QuickBooks token, and
// a second function refreshing that same row would race it -- Intuit rotates the
// refresh token on every use, so the loser of that race disconnects the portal.
// Nothing here touches QuickBooks at all: it reads the invoice out of Postgres
// and draws it. Attaching to the QuickBooks invoice so the customer receives it
// belongs in qb-push-invoice, where the token already lives.
//
// Admin only, the same as the crew sheet, and for the same reason: an invoice
// carries a customer's prices, which is not a welder's to pull.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { buildPartsInvoicePdf } from '../_shared/invoice-pdf-data.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
    const id = body.parts_invoice_id ?? null;
    if (!id) return json({ ok: false, error: 'parts_invoice_id is required' }, 400);

    const out = await buildPartsInvoicePdf(db as never, String(id));
    if (!out.ok) return json({ ok: false, error: out.error }, 422);

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
