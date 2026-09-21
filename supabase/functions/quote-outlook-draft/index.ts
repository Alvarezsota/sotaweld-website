// Puts a quote in Gilbert's Outlook Drafts folder, PDF already attached.
//
// WHY THIS EXISTS, AND WHY send-quote IS NOT THE ANSWER
// ---------------------------------------------------------------------------
// send-quote mails the customer over Resend. On 21 September two Desert
// Electric quotes went out that way, Resend accepted both, the portal wrote
// them down as sent -- and Omar Olivas never received either. Not in his inbox,
// not in his junk. The DNS says why:
//
//   sotaweld.com        v=spf1 include:spf.protection.outlook.com ~all
//   send.sotaweld.com   v=spf1 include:amazonses.com -all
//
// Resend is authorised on the send. subdomain. The mail went out as
// alerts@sotaweld.com -- the root domain, which authorises Microsoft and
// nothing else -- so Desert Hills saw a message claiming to be from sotaweld.com
// arriving off Amazon's servers with no authority from the domain, and refused
// it at the door. Every email the portal had ever sent went to an @sotaweld.com
// address inside the same tenant, which never checks that hard. The first
// outsider was the first failure.
//
// A draft in his own mailbox fixes the class of problem rather than the
// instance: it leaves through Microsoft, which the domain does authorise, it
// lands in Sent Items where he has a record, and he reads it before it goes.
//
// Mail.ReadWrite, NOT Mail.Send. Nothing here sends anything. The portal writes
// the letter and puts it on his desk; a person decides whether it leaves.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

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

/* The same token the pay statements are filed with, refreshed the same way.
   The refresh asks for the mail scope as well: the refresh token carries the
   whole consent, so which slice of it an access token gets is decided here. */
type Tok = { access_token: string; refresh_token: string; expires_at: string };

async function freshToken(
  admin: ReturnType<typeof createClient>,
): Promise<{ tok?: Tok; error?: string }> {
  const { data } = await admin.from('onedrive_tokens').select('*').eq('id', 1).maybeSingle();
  const tok = data as Tok | null;
  if (!tok) {
    return { error: 'Microsoft is not connected. Connect it on the Setup page, then try again.' };
  }

  const clientId = (Deno.env.get('MS_CLIENT_ID') || '').trim();
  const clientSecret = (Deno.env.get('MS_CLIENT_SECRET') || '').trim();
  if (!clientId || !clientSecret) return { error: 'MS_CLIENT_ID / MS_CLIENT_SECRET are not set.' };
  const tenant = (Deno.env.get('MS_TENANT_ID') || '').trim() || 'organizations';

  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: tok.refresh_token, grant_type: 'refresh_token',
      scope: 'offline_access Files.ReadWrite Mail.ReadWrite User.Read',
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    // The usual cause the first time: the connection was made before the mail
    // permission existed, so the consent on file does not cover it. Say that,
    // rather than leaving him to read an OAuth error.
    return { error: 'Microsoft would not grant mail access: '
      + (j.error_description || res.status)
      + ' -- reconnect Microsoft on the Setup page to grant it, then try again.' };
  }

  const updated = {
    access_token: j.access_token as string,
    refresh_token: (j.refresh_token as string) || tok.refresh_token,
    expires_at: new Date(Date.now() + (Number(j.expires_in || 3600) - 60) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  await admin.from('onedrive_tokens').update(updated).eq('id', 1);
  return { tok: { ...tok, ...updated } };
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
      .select('id, quote_no, quote_date, valid_through, net_days, total, '
            + 'customer_name, customer_email, bill_to_attn, job_name')
      .eq('id', quoteId).maybeSingle();
    if (!q) return json({ ok: false, error: 'that quote could not be found' }, 404);

    const to = String(body.to ?? q.customer_email ?? '').trim();
    if (!to) {
      return json({ ok: false, error:
        `There is no email address on ${q.quote_no ?? 'this quote'}. Pick a contact for `
        + `${q.customer_name ?? 'this customer'} on the quote, or add one under Customers.` }, 422);
    }
    if (!EMAIL.test(to)) return json({ ok: false, error: `"${to}" is not an email address` }, 422);

    const cc = (Array.isArray(body.cc) ? body.cc : [])
      .map((s: unknown) => String(s ?? '').trim())
      .filter((s: string) => s && s.toLowerCase() !== to.toLowerCase() && EMAIL.test(s));

    // Microsoft first. Drawing the PDF costs three font downloads and a render,
    // and there is no sense paying for it to then discover the mailbox is not
    // connected.
    const got = await freshToken(db);
    if (got.error || !got.tok) return json({ ok: false, error: got.error }, 422);

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
        `The quote could not be drawn, so no draft was made: ${why.error ?? drawn.status}` }, 422);
    }
    const pdf = new Uint8Array(await drawn.arrayBuffer());
    const filename = (drawn.headers.get('content-disposition') ?? '')
      .match(/filename="([^"]+)"/)?.[1] ?? `Quote ${q.quote_no ?? 'draft'}.pdf`;

    const { data: settingRows } = await db.from('app_settings')
      .select('key, value').in('key', ['company_phone']);
    const phone = ((settingRows as { key: string; value: string }[] | null ?? [])
      .find((r) => r.key === 'company_phone')?.value) ?? '';

    const signer = (me.full_name as string) || 'State of the Arc Welding & Services';
    const validLine = q.valid_through
      ? `This quote is good through ${usDate(q.valid_through as string)}.` : '';
    const jobLine = q.job_name ? ` for ${q.job_name}` : '';
    const subject = String(body.subject ?? '').trim()
      || `Quote ${q.quote_no ?? ''} — ${q.customer_name ?? ''}${jobLine}`.replace(/\s+/g, ' ').trim();
    const note = String(body.message ?? '').trim();
    const greeting = q.bill_to_attn ? `${String(q.bill_to_attn).trim()},` : 'Good morning,';

    const html = `<p>${esc(greeting)}</p>
<p>${esc(note || `Our quote${jobLine} is attached, ${money(q.total)} in total.`)}</p>
${validLine ? `<p>${esc(validLine)}</p>` : ''}
<p>Anything on it you want changed, call me and we will sort it out.</p>
<p>${esc(signer)}<br>State of the Arc Welding &amp; Services LLC<br>${esc(phone)}</p>`;

    const message = {
      subject,
      body: { contentType: 'HTML', content: html },
      toRecipients: [{ emailAddress: { address: to } }],
      ...(cc.length ? { ccRecipients: cc.map((a: string) => ({ emailAddress: { address: a } })) } : {}),
      // Inline on the create. Graph takes an attachment this way up to about
      // 3 MB and a quote is fifty kilobytes; the upload-session dance these
      // documents will never need is not worth carrying.
      attachments: [{
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: filename,
        contentType: 'application/pdf',
        contentBytes: base64(pdf),
      }],
    };

    const made = await fetch('https://graph.microsoft.com/v1.0/me/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${got.tok.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
    const out = await made.json().catch(() => ({}));
    if (!made.ok) {
      return json({ ok: false, error:
        `Outlook would not take the draft: ${out?.error?.message ?? made.status}` }, 502);
    }

    /* Nothing is written onto the quote. A draft is not a sent quote, and
       marking it sent here would put the same lie in the database that the
       Resend sends did -- the portal said sent, the customer had nothing.
       desk_quotes.sent_at is set when a person actually sends it. */
    return json({
      ok: true, drafted: true, to, cc, subject, filename,
      message_id: out?.id ?? null,
      web_link: out?.webLink ?? null,
    });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
