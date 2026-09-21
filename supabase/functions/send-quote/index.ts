// Emails a quote to the customer, with the letterhead PDF on it.
//
// The document is NOT drawn here. It is fetched from qb-invoice-pdf, the same
// function the Print / PDF button calls, carrying the caller's own
// Authorization header. Two functions drawing the same quote is two documents
// that can disagree, and the one the customer receives must be the one the
// office looked at before sending it.
//
// Admin only, and for a harder reason than usual: this one puts a price in
// front of a customer over the company's own domain. A welder cannot send it,
// and nothing that is not a signed-in admin can either.
//
// Resend, the same as the weld digest, off the same verified domain.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;

const FROM_DEFAULT = 'State of the Arc Welding & Services <quotes@sotaweld.com>';
const REPLY_DEFAULT = 'g.alvarez@sotaweld.com';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const usDate = (iso?: string | null) => {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-');
  return `${m}-${d}-${y}`;
};
const money = (n: unknown) =>
  '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const esc = (s: unknown) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/* Deno's btoa takes a binary string, and a PDF in one String.fromCharCode call
   blows the argument limit on anything past a page or two. Chunked. */
function base64(bytes: Uint8Array): string {
  let bin = '';
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) {
    bin += String.fromCharCode(...bytes.subarray(i, i + STEP));
  }
  return btoa(bin);
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
      .select('role, full_name').eq('id', who.user.id).maybeSingle();
    if (me?.role !== 'admin') return json({ ok: false, error: 'admins only' }, 403);

    const body = await req.json().catch(() => ({}));
    const quoteId = body.quote_id ? String(body.quote_id) : '';
    if (!quoteId) return json({ ok: false, error: 'quote_id is required' }, 400);

    const { data: q } = await db.from('desk_quotes')
      .select('id, quote_no, quote_date, valid_through, valid_days, net_days, total, '
            + 'customer_name, customer_email, bill_to_attn, job_name, scope')
      .eq('id', quoteId).maybeSingle();
    if (!q) return json({ ok: false, error: 'that quote could not be found' }, 404);

    /* A test goes to whoever is signed in, and nowhere else.
       
       Taken from the session rather than from anything the caller passed, so
       "test" can never be a way to post a customer's prices to an address of
       someone's choosing. It also means testing needs no contact invented on
       the customer, no dropdown changed and nothing put back afterwards --
       which is what made the first version of this too fiddly to actually use.
       A test never marks the quote sent. */
    const isTest = body.test === true;
    const myEmail = String(who.user.email ?? '').trim();
    if (isTest && !myEmail) {
      return json({ ok: false, error: 'your sign-in has no email address to test against' }, 422);
    }

    // The address on the quote unless the caller named another. Never invented:
    // a quote with nobody to send it to is a mistake to be shown, not worked
    // around by guessing at the company's switchboard.
    const to = isTest ? myEmail : String(body.to ?? q.customer_email ?? '').trim();
    if (!to) {
      return json({ ok: false, error:
        `There is no email address on ${q.quote_no ?? 'this quote'}. Pick a contact for `
        + `${q.customer_name ?? 'this customer'} on the quote, or add one under Customers.` }, 422);
    }
    if (!EMAIL.test(to)) return json({ ok: false, error: `"${to}" is not an email address` }, 422);

    // Nobody is copied on a test. The whole point is that it reaches one
    // inbox, and a test that copies the customer is not a test.
    const cc = isTest ? [] : (Array.isArray(body.cc) ? body.cc : [])
      .map((s: unknown) => String(s ?? '').trim())
      .filter((s: string) => s && s.toLowerCase() !== to.toLowerCase() && EMAIL.test(s));

    /* Blind copy to whoever pressed send.
       
       This does not go through Outlook, so a quote that leaves here leaves no
       trace in anybody's mailbox -- the portal knows it went, and the sender's
       Sent Items does not. Two went to Desert Electric today and there was
       nothing in Gilbert's inbox to show for either.
       
       Blind rather than copied: it is a record for the office, and a customer
       reading the company's own address in the CC line of a quote addressed to
       him learns nothing useful. Skipped when he is already on it, and on a
       test, which is already going nowhere else. */
    const bcc = (!isTest && myEmail
                 && myEmail.toLowerCase() !== to.toLowerCase()
                 && !cc.some((a: string) => a.toLowerCase() === myEmail.toLowerCase()))
      ? [myEmail] : [];

    // The same document the Print / PDF button hands over, asked for the same
    // way, with the caller's own token -- not the service key, which is not a
    // user and would be turned away as not signed in.
    const drawn = await fetch(`${SUPABASE_URL}/functions/v1/qb-invoice-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ quote_id: quoteId }),
    });
    if (!drawn.ok) {
      const why = await drawn.json().catch(() => ({}));
      return json({ ok: false, error:
        `The quote could not be drawn, so nothing was sent: ${why.error ?? drawn.status}` }, 422);
    }
    const pdf = new Uint8Array(await drawn.arrayBuffer());
    const filename = (drawn.headers.get('content-disposition') ?? '')
      .match(/filename="([^"]+)"/)?.[1] ?? `Quote ${q.quote_no ?? 'draft'}.pdf`;

    const { data: settingRows } = await db.from('app_settings')
      .select('key, value').in('key', ['quote_email_from', 'quote_email_reply_to', 'company_phone']);
    const setting: Record<string, string> = {};
    (settingRows as { key: string; value: string }[] | null ?? [])
      .forEach((r) => { setting[r.key] = r.value; });

    const who_ = (me.full_name as string) || 'State of the Arc Welding & Services';
    const validLine = q.valid_through
      ? `This quote is good through ${usDate(q.valid_through as string)}.`
      : '';
    const jobLine = q.job_name ? ` for ${q.job_name}` : '';
    const subject = (isTest ? '[TEST] ' : '') + (String(body.subject ?? '').trim()
      || `Quote ${q.quote_no ?? ''} — ${q.customer_name ?? ''}${jobLine}`.replace(/\s+/g, ' ').trim());

    const note = String(body.message ?? '').trim();
    const greeting = q.bill_to_attn ? `${String(q.bill_to_attn).trim()},` : 'Good morning,';

    const textBody = [
      greeting,
      '',
      note || `Our quote${jobLine} is attached, ${money(q.total)} in total.`,
      validLine,
      '',
      'Anything on it you want changed, call me and we will sort it out.',
      '',
      who_,
      'State of the Arc Welding & Services LLC',
      setting.company_phone ?? '',
    ].filter((l) => l !== null && l !== undefined).join('\n');

    const html = `<div style="font:14px/1.55 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0A0C0F">
  <p style="margin:0 0 12px">${esc(greeting)}</p>
  <p style="margin:0 0 12px">${esc(note || `Our quote${jobLine} is attached, ${money(q.total)} in total.`)}</p>
  ${validLine ? `<p style="margin:0 0 12px;color:#464E59">${esc(validLine)}</p>` : ''}
  <table style="border-collapse:collapse;margin:0 0 16px;font-size:13px">
    <tr><td style="padding:2px 16px 2px 0;color:#79828F">Quote</td><td style="padding:2px 0"><b>${esc(q.quote_no ?? 'draft')}</b></td></tr>
    ${q.job_name ? `<tr><td style="padding:2px 16px 2px 0;color:#79828F">Job</td><td style="padding:2px 0">${esc(q.job_name)}</td></tr>` : ''}
    <tr><td style="padding:2px 16px 2px 0;color:#79828F">Total</td><td style="padding:2px 0"><b>${esc(money(q.total))}</b></td></tr>
    ${q.net_days != null ? `<tr><td style="padding:2px 16px 2px 0;color:#79828F">Terms</td><td style="padding:2px 0">Net ${esc(q.net_days)}</td></tr>` : ''}
  </table>
  <p style="margin:0 0 12px">Anything on it you want changed, call me and we will sort it out.</p>
  <p style="margin:0;color:#464E59">${esc(who_)}<br>State of the Arc Welding &amp; Services LLC<br>${esc(setting.company_phone ?? '')}</p>
</div>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: setting.quote_email_from || FROM_DEFAULT,
        to,
        ...(cc.length ? { cc } : {}),
        ...(bcc.length ? { bcc } : {}),
        reply_to: setting.quote_email_reply_to || REPLY_DEFAULT,
        subject,
        html,
        text: textBody,
        attachments: [{ filename, content: base64(pdf) }],
      }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      return json({ ok: false, error:
        `Resend would not send it: ${out?.message ?? out?.error?.message ?? res.status}` }, 502);
    }

    // Written down only once it has actually gone. A quote marked sent that
    // never left is worse than one nobody marked at all -- and a test that
    // left is still not a quote that went to the customer, so it writes
    // nothing and the quote stays exactly as it was.
    if (!isTest) {
      await db.from('desk_quotes').update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        sent_to: [to, ...cc].join(', '),
        updated_at: new Date().toISOString(),
      }).eq('id', quoteId);
    }

    return json({ ok: true, test: isTest, to, cc, bcc, subject, filename, id: out?.id ?? null });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
