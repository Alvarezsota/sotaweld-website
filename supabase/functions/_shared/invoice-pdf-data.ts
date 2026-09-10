// Gathers what the invoice PDF needs and hands back the drawn document.
//
// The figures come from parts_invoice_payload -- the same function the push
// itself bills off -- so this document and the bill cannot disagree about money.
//
// Terms, due date and billing address are read off the invoice QuickBooks
// actually created, when the caller has it to hand. Nothing is invented when it
// does not: see buildPartsInvoicePdf.
//
// Drawing from the bill rather than from the row behind it is the lesson of
// invoice 2987. The crew sheet on that one was drawn from a week the push had
// already moved on from, and went out saying $1,660 against a $2,340 invoice.
// A document that restates the bill has to be drawn from the bill.

import { buildInvoicePdf, type CompanyBlock, type InvoicePayload, type QuoteSection } from './invoice-pdf.ts';
import { buildQuotePdf, quotePdfFileName } from './quote-pdf.ts';

type Db = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  // deno-lint-ignore no-explicit-any
  from: (t: string) => any;
};

const ASSET_BASE = 'https://sotaweld.com/employee';
const FONTS = {
  archivo: `${ASSET_BASE}/fonts/ArchivoBlack.ttf`,
  inter: `${ASSET_BASE}/fonts/Inter-Regular.ttf`,
  interBold: `${ASSET_BASE}/fonts/Inter-SemiBold.ttf`,
};
const LOGO_URL = `${ASSET_BASE}/sota-logo.png`;

// The fonts do not change between invoices and a push should not wait on three
// downloads it already made. Warm for the life of the isolate.
const cache = new Map<string, Uint8Array>();
async function asset(url: string, required: boolean): Promise<Uint8Array | null> {
  const hit = cache.get(url);
  if (hit) return hit;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    cache.set(url, bytes);
    return bytes;
  } catch (err) {
    // The letterhead reads fine without the logo, so a logo that will not load
    // is never a reason to fail an invoice somebody is waiting on. A missing
    // font is different: there is nothing to draw the words with.
    if (required) throw new Error(`could not load ${url}: ${(err as Error).message}`);
    return null;
  }
}

/* ---------------------------------------------------------------------------
   PUTTING IT ON THE QUICKBOOKS INVOICE
   ---------------------------------------------------------------------------

   The token is READ, never refreshed. qb-push-invoice owns refreshing it, and
   Intuit hands out a new refresh token every time one is used -- two functions
   refreshing the same row means the loser of that race disconnects the portal
   from QuickBooks. So when the access token is close to expiry this asks the
   push function to do its own sync_invoice_no, which refreshes as a side effect
   of work it does on every page load anyway, and then reads the fresh token.
   One refresher, no race.

   That call carries the CALLER'S authorization header, not the service key. The
   push checks for a signed-in admin and a service key is not a user, so it
   would answer 401 and the token would never be refreshed.

   attachToInvoice is a copy of the one in invoice-backup-data.ts rather than an
   import: that module drags in the whole 24kB crew-sheet drawing with it, which
   this function has no use for. Forty lines duplicated against thirty kilobytes
   of dead weight in every cold start. */

type Tokens = {
  access_token: string; refresh_token: string; expires_at: string;
  realm_id: string; environment: string;
};

const API_BASE = (env: string) =>
  env === 'sandbox' ? 'https://sandbox-quickbooks.api.intuit.com'
                    : 'https://quickbooks.api.intuit.com';

async function liveTokenReadOnly(db: Db, pushUrl: string, callerAuth: string): Promise<Tokens> {
  const read = async () => {
    const { data } = await db.from('qb_oauth_tokens').select('*').eq('id', 1).maybeSingle();
    return data as Tokens | null;
  };
  let t = await read();
  if (!t) throw new Error('QuickBooks is not connected. Reconnect the portal to QuickBooks.');

  // Two minutes of headroom: an upload that starts valid and expires mid-flight
  // is the same as never having had a token.
  if (new Date(t.expires_at).getTime() - Date.now() > 120_000) return t;

  try {
    await fetch(pushUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: callerAuth },
      body: JSON.stringify({ action: 'sync_invoice_no' }),
    });
  } catch { /* fall through and try what we have */ }

  t = await read();
  if (!t) throw new Error('QuickBooks is not connected. Reconnect the portal to QuickBooks.');
  return t;
}

async function attachToInvoice(opts: {
  apiBase: string; realmId: string; accessToken: string;
  invoiceId: string; pdf: Uint8Array; filename: string;
}): Promise<{ ok: true; attachable_id: string | null } | { ok: false; error: string }> {
  // IncludeOnSend is what makes it ride along: when the invoice is sent from
  // QuickBooks, this goes with it.
  const meta = {
    AttachableRef: [{ EntityRef: { type: 'Invoice', value: opts.invoiceId }, IncludeOnSend: true }],
    FileName: opts.filename,
    ContentType: 'application/pdf',
  };
  const form = new FormData();
  form.append('file_metadata_01',
    new Blob([JSON.stringify(meta)], { type: 'application/json' }), 'metadata.json');
  form.append('file_content_01',
    new Blob([opts.pdf], { type: 'application/pdf' }), opts.filename);

  let res: Response;
  try {
    res = await fetch(`${opts.apiBase}/v3/company/${opts.realmId}/upload?minorversion=75`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.accessToken}`, Accept: 'application/json' },
      body: form,
    });
  } catch (err) {
    return { ok: false, error: `the upload did not reach QuickBooks: ${(err as Error).message}` };
  }

  const out = await res.json().catch(() => ({}));
  // QuickBooks answers an upload with a list and reports a per-part fault inside
  // a 200. Reading only the status code would call a rejected attachment a
  // success.
  const entry = out?.AttachableResponse?.[0];
  const fault = entry?.Fault?.Error?.[0] ?? out?.Fault?.Error?.[0];
  if (!res.ok || fault || !entry?.Attachable?.Id) {
    const detail = fault
      ? `${fault.code ?? '?'} ${fault.Message ?? ''} ${fault.Detail ?? ''}`.trim()
      : JSON.stringify(out).slice(0, 400);
    return { ok: false, error: detail.slice(0, 500) || `upload failed (${res.status})` };
  }
  return { ok: true, attachable_id: String(entry.Attachable.Id) };
}

/**
 * Draws the invoice and puts it on the QuickBooks invoice, so the customer gets
 * it with the bill instead of it sitting here waiting to be remembered.
 *
 * The outcome is written onto the row either way. Best effort with no record is
 * just "sometimes missing and nobody knows".
 */
export async function attachInvoicePdf(
  db: Db, partsInvoiceId: string, pushUrl: string, callerAuth: string,
): Promise<{ ok: true; filename: string } | { ok: false; error: string }> {
  const { data: row } = await db.from('parts_invoices')
    .select('qb_invoice_id, qb_customer_id').eq('id', partsInvoiceId).maybeSingle();
  const inv = row as { qb_invoice_id?: string | null; qb_customer_id?: string } | null;
  if (!inv) return { ok: false, error: 'that invoice could not be found' };
  if (!inv.qb_invoice_id) {
    return { ok: false, error: 'that invoice is not on QuickBooks yet, so there is nothing to attach it to' };
  }

  const note = async (err: string | null) => {
    await db.from('parts_invoices').update({
      invoice_pdf_attached_at: err ? null : new Date().toISOString(),
      invoice_pdf_error: err,
    }).eq('id', partsInvoiceId);
  };

  let t: Tokens;
  try {
    t = await liveTokenReadOnly(db, pushUrl, callerAuth);
  } catch (err) {
    const msg = (err as Error).message;
    await note(msg);
    return { ok: false, error: msg };
  }

  // Terms, due date and the billing address off the invoice QuickBooks actually
  // has, so the document that rides along cannot contradict the one it is
  // stapled to.
  let facts: QbInvoiceFacts = {};
  let termName: string | null = null;
  try {
    const r = await fetch(
      `${API_BASE(t.environment)}/v3/company/${t.realm_id}/invoice/${inv.qb_invoice_id}?minorversion=75`,
      { headers: { Authorization: `Bearer ${t.access_token}`, Accept: 'application/json' } });
    const j = await r.json().catch(() => ({}));
    if (j?.Invoice) {
      facts = j.Invoice as QbInvoiceFacts;
      termName = facts.SalesTermRef?.name ?? null;
    }
  } catch { /* draw it from our own rows instead */ }

  const drawn = await buildPartsInvoicePdf(db, partsInvoiceId, facts, termName);
  if (!drawn.ok) { await note(drawn.error); return { ok: false, error: drawn.error }; }

  const put = await attachToInvoice({
    apiBase: API_BASE(t.environment), realmId: t.realm_id, accessToken: t.access_token,
    invoiceId: String(inv.qb_invoice_id), pdf: drawn.pdf, filename: drawn.filename,
  });
  if (!put.ok) { await note(put.error); return { ok: false, error: put.error }; }

  await note(null);
  return { ok: true, filename: drawn.filename };
}

export type QbInvoiceFacts = {
  DueDate?: string;
  SalesTermRef?: { value?: string; name?: string };
  BillAddr?: Record<string, unknown>;
  DocNumber?: string;
};

export type PdfResult =
  | { ok: true; pdf: Uint8Array; filename: string }
  | { ok: false; error: string };

const addrLines = (a?: Record<string, unknown>): string => {
  if (!a) return '';
  return ['Line1', 'Line2', 'Line3', 'Line4']
    .map((k) => String(a[k] ?? '').trim()).filter(Boolean)
    .concat([[String(a.City ?? '').trim(), String(a.CountrySubDivisionCode ?? '').trim()]
      .filter(Boolean).join(', ') + ' ' + String(a.PostalCode ?? '').trim()].map((s) => s.trim()))
    .filter(Boolean).join('\n');
};

export function invoicePdfFileName(invoiceNo: string, customer: string): string {
  const who = (customer || 'customer').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
  return `Invoice ${invoiceNo || 'draft'} - ${who}.pdf`.slice(0, 120);
}

/**
 * `qb` is what QuickBooks actually put on the invoice -- terms, due date, the
 * address it billed. Pass it whenever the invoice exists over there and those
 * are the facts that matter; the document then cannot contradict the bill.
 *
 * Called without it -- drawing an invoice that has not been pushed yet, or
 * re-drawing one for the office to read -- the terms fall back to the customer's
 * standing terms in qb_customer_billing, and the due date and address are left
 * blank rather than guessed. Blank is the honest answer: most customers here
 * have no terms set at all and some settle on pickup.
 */
export async function buildPartsInvoicePdf(
  db: Db, partsInvoiceId: string, qb?: QbInvoiceFacts, termName?: string | null,
): Promise<PdfResult> {
  const { data, error } = await db.rpc('parts_invoice_payload', { p_invoice_id: partsInvoiceId });
  if (error) {
    const msg = (error as { message?: string }).message ?? String(error);
    return { ok: false, error: `could not read the invoice: ${msg}` };
  }
  const base = data as (Record<string, unknown> & { error?: string }) | null;
  if (!base) return { ok: false, error: 'that invoice could not be found' };
  if (base.error) return { ok: false, error: String(base.error) };

  const { data: settingRows } = await db.from('app_settings')
    .select('key, value')
    .in('key', ['company_name', 'company_address', 'company_phone',
                'invoice_pdf_basis', 'invoice_pdf_terms']);
  const setting: Record<string, string> = {};
  (settingRows as { key: string; value: string }[] | null ?? [])
    .forEach((r) => { setting[r.key] = r.value; });

  // No terms handed in: ask the customer's row for their standing terms.
  let terms = termName ?? null;
  let billEmail: string | null = null;
  if (terms == null && base.customer) {
    const custId = String((base.customer as { id?: unknown }).id ?? '');
    if (custId) {
      const { data: bill } = await db.from('qb_customer_billing')
        .select('qb_term_name, to_email').eq('qb_customer_id', custId).maybeSingle();
      const row = bill as { qb_term_name?: string; to_email?: string } | null;
      terms = row?.qb_term_name ?? null;
      billEmail = row?.to_email ?? null;
    }
  }

  const company: CompanyBlock = {
    company_name: setting.company_name ?? '',
    company_address: setting.company_address ?? '',
    company_phone: setting.company_phone ?? '',
  };

  const payload: InvoicePayload = {
    invoice_no: String(qb?.DocNumber ?? base.invoice_no ?? '') || null,
    transaction_date: String(base.transaction_date ?? ''),
    // Straight off the created invoice. Never guessed: most customers have no
    // terms set and some settle on pickup rather than in days.
    due_date: qb?.DueDate ?? null,
    terms_label: terms ?? qb?.SalesTermRef?.name ?? null,
    po_number: (base.po_number as string) ?? null,
    customer_name: (base.customer_name as string) ?? null,
    bill_email: billEmail,
    bill_address: addrLines(qb?.BillAddr),
    scope: (base.memo as string) ?? null,
    lines: (base.lines as InvoicePayload['lines']) ?? [],
    expected_total: base.expected_total,
    lines_total: base.lines_total,
    basis: setting.invoice_pdf_basis ?? null,
    terms: setting.invoice_pdf_terms ?? null,
  };

  try {
    const [archivo, inter, interBold, logo] = await Promise.all([
      asset(FONTS.archivo, true), asset(FONTS.inter, true),
      asset(FONTS.interBold, true), asset(LOGO_URL, false),
    ]);
    const pdf = await buildInvoicePdf(payload, company, {
      archivo: archivo!, inter: inter!, interBold: interBold!, logo,
    });
    return {
      ok: true,
      pdf,
      filename: invoicePdfFileName(String(payload.invoice_no ?? ''), String(payload.customer_name ?? '')),
    };
  } catch (err) {
    return { ok: false, error: `the invoice could not be drawn: ${(err as Error).message}` };
  }
}

/**
 * The quote, drawn from its own rows.
 *
 * Sections come out in the rate card's order and carry the quote's lump-sum
 * switches, so the document shows exactly what was decided when it was written:
 * a section quoted as one figure prints as one figure. A line belonging to no
 * section falls into a plain one at the end rather than being dropped -- a
 * priced line that does not appear is worse than an untidy heading.
 */
export async function buildQuotePdfFor(db: Db, quoteId: string): Promise<PdfResult> {
  const { data: q, error } = await db.from('desk_quotes')
    .select('id, quote_no, quote_date, valid_days, valid_through, net_days, po_number, '
          + 'customer_name, customer_email, job_name, scope, reference_part, lump')
    .eq('id', quoteId).maybeSingle();
  if (error) return { ok: false, error: `could not read the quote: ${(error as { message?: string }).message ?? error}` };
  if (!q) return { ok: false, error: 'that quote could not be found' };

  const [{ data: lineRows }, { data: groupRows }, { data: settingRows }] = await Promise.all([
    db.from('desk_quote_lines')
      .select('sort_order, description, quantity, unit, unit_price, rate_group')
      .eq('quote_id', quoteId).order('sort_order'),
    db.from('desk_rate_groups').select('id, label, sort_order').order('sort_order'),
    db.from('app_settings').select('key, value')
      .in('key', ['company_name', 'company_address', 'company_phone',
                  'quote_pdf_basis', 'quote_pdf_terms']),
  ]);

  const setting: Record<string, string> = {};
  (settingRows as { key: string; value: string }[] | null ?? [])
    .forEach((r) => { setting[r.key] = r.value; });

  const groups = (groupRows as { id: string; label: string }[] | null ?? []);
  const lines = (lineRows as Array<Record<string, unknown>> | null ?? []);
  const lump = (q.lump && typeof q.lump === 'object') ? q.lump as Record<string, unknown> : {};

  const sections: QuoteSection[] = [];
  for (const g of groups) {
    const mine = lines.filter((l) => l.rate_group === g.id);
    if (!mine.length) continue;
    sections.push({
      label: g.label,
      lump: lump[g.id] === true,
      lines: mine.map((l) => ({
        description: String(l.description ?? ''),
        quantity: l.quantity, unit: (l.unit as string) ?? undefined,
        unit_price: l.unit_price,
      })),
    });
  }
  const loose = lines.filter((l) => !groups.some((g) => g.id === l.rate_group));
  if (loose.length) {
    sections.push({
      label: 'Other',
      lump: false,
      lines: loose.map((l) => ({
        description: String(l.description ?? ''),
        quantity: l.quantity, unit: (l.unit as string) ?? undefined,
        unit_price: l.unit_price,
      })),
    });
  }

  // valid_through if it was set outright, otherwise the date plus the days.
  let validThrough: string | null = (q.valid_through as string) ?? null;
  if (!validThrough && q.quote_date && q.valid_days != null) {
    const d = new Date(String(q.quote_date) + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + Number(q.valid_days));
    validThrough = d.toISOString().slice(0, 10);
  }

  try {
    const [archivo, inter, interBold, logo] = await Promise.all([
      asset(FONTS.archivo, true), asset(FONTS.inter, true),
      asset(FONTS.interBold, true), asset(LOGO_URL, false),
    ]);
    const pdf = await buildQuotePdf({
      quote_no: (q.quote_no as string) ?? null,
      quote_date: String(q.quote_date ?? ''),
      valid_through: validThrough,
      net_days: q.net_days == null ? null : Number(q.net_days),
      po_number: (q.po_number as string) ?? null,
      customer_name: (q.customer_name as string) ?? null,
      bill_email: (q.customer_email as string) ?? null,
      reference_part: (q.reference_part as string) ?? null,
      job_name: (q.job_name as string) ?? null,
      scope: (q.scope as string) ?? null,
      basis: setting.quote_pdf_basis ?? null,
      terms: setting.quote_pdf_terms ?? null,
      sections,
    }, {
      company_name: setting.company_name ?? '',
      company_address: setting.company_address ?? '',
      company_phone: setting.company_phone ?? '',
    }, { archivo: archivo!, inter: inter!, interBold: interBold!, logo });

    return {
      ok: true,
      pdf,
      filename: quotePdfFileName(String(q.quote_no ?? ''), String(q.customer_name ?? '')),
    };
  } catch (err) {
    return { ok: false, error: `the quote could not be drawn: ${(err as Error).message}` };
  }
}
