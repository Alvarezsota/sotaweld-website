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

import { buildInvoicePdf, type CompanyBlock, type InvoicePayload } from './invoice-pdf.ts';

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
