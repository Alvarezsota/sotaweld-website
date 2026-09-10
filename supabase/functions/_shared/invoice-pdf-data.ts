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
