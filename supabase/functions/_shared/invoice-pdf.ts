// The invoice as the customer sees it, on our letterhead.
//
// NOT WIRED UP YET. Committed so the work survives the container; nothing
// imports this and no push touches it. Gilbert is looking at a sample first,
// and the BASIS and TERMS wording is a draft he has not signed off.
//
// QuickBooks emails its own invoice and that one stays the bill of record.
// This is the document that shows the WORK -- every line, the quantity, the
// unit, the price and what it came to -- carrying the same blocks the quote
// carries, so a customer holding both sees one company rather than two
// templates. An invoice that says "Welding Services  1  $4,418.80" tells them
// nothing they can check; this tells them what they bought.
//
// The fonts and logo arrive as bytes rather than being read off disk, so this
// runs unchanged in Deno and in a local harness.
//
import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import fontkit from 'https://esm.sh/@pdf-lib/fontkit@1.1.1';

export type InvoiceLine = {
  description?: string; quantity?: unknown; unit?: string;
  unit_price?: unknown; amount?: unknown;
};
export type InvoicePayload = {
  invoice_no?: string | null; transaction_date?: string; due_date?: string | null;
  terms_label?: string | null; po_number?: string | null; quote_no?: string | null;
  customer_name?: string | null; bill_to_attn?: string | null;
  bill_email?: string | null; bill_address?: string | null; company_rep?: string | null;
  reference_part?: string | null; reference_process?: string | null;
  scope?: string | null; basis?: string | null; terms?: string | null;
  lines?: InvoiceLine[]; expected_total?: unknown; lines_total?: unknown;
};
export type CompanyBlock = Record<string, string>;
export type PdfAssets = {
  archivo: Uint8Array; inter: Uint8Array; interBold: Uint8Array; logo: Uint8Array | null;
};

/* ---------- looks: the tokens Gilbert specified ---------- */
const hex = (h: string) => rgb(
  parseInt(h.slice(1, 3), 16) / 255,
  parseInt(h.slice(3, 5), 16) / 255,
  parseInt(h.slice(5, 7), 16) / 255);

const INK   = hex('#0A0C0F');
const SOFT  = hex('#464E59');
const MUTE  = hex('#79828F');
const RULE  = hex('#D8DDE3');
const HAIR  = hex('#EDF0F3');
const WASH  = hex('#F6F8FA');
const GOLD  = hex('#E9A23B');
const DEEP  = hex('#B7761C');
const GWASH = hex('#FDF4E6');
const WHITE = rgb(1, 1, 1);

const PAGE_W = 612, PAGE_H = 792;
const M_TOP = 36;            // 0.5in
const M_X   = 43.2;          // 0.6in
const CONTENT = PAGE_W - M_X * 2;
const FOOT = 54;             // nothing is drawn below this

const money = (n: unknown) => '$' + Number(n || 0).toLocaleString('en-US',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n: unknown) => {
  const v = Number(n || 0);
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
};
const usDate = (iso?: string | null) => {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-');
  return `${m}-${d}-${y}`;
};

/* A customer's part description is whatever was typed on the ticket, and the
 * Latin subset of Inter has no glyph for the eighths. Left alone, pdf-lib
 * either throws or lays down an empty box on a document going to a customer.
 * Anything the font cannot draw is turned into something it can. */
const FOLD = {
  '⅞': '7/8', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8',
  '½': '1/2', '¼': '1/4', '¾': '3/4', '⅓': '1/3', '⅔': '2/3',
  '″': '"', '′': "'", '“': '"', '”': '"', '‘': "'", '’': "'",
  '—': '-', '–': '-', '×': 'x', '·': '-', '•': '-', '…': '...',
  ' ': ' ',
};
function makeSafe(fonts: PDFFont[]) {
  // pdf-lib does NOT throw on a glyph the font lacks -- widthOfTextAtSize
  // happily measures .notdef and the page gets a black box. Ask the embedded
  // fonts what they actually carry instead of probing them.
  const sets = fonts.map((f) => {
    try { return new Set<number>(f.getCharacterSet() as number[]); } catch { return null; }
  });
  const drawable = (ch: string) => {
    const cp = ch.codePointAt(0);
    return sets.every((s) => s === null || s.has(cp));
  };
  const cache = new Map<string, string>();
  return (s: unknown) => String(s ?? '').split('').map((ch) => {
    if (ch === '\n') return ch;
    if (cache.has(ch)) return cache.get(ch);
    let out = drawable(ch) ? ch : (FOLD[ch] ?? '?');
    if (out !== ch) out = out.split('').filter(drawable).join('');
    cache.set(ch, out);
    return out;
  }).join('');
}

export async function buildInvoicePdf(
  p: InvoicePayload, company: CompanyBlock, assets: PdfAssets,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  const display = await doc.embedFont(assets.archivo, { subset: true });
  const body    = await doc.embedFont(assets.inter, { subset: true });
  const bold    = await doc.embedFont(assets.interBold, { subset: true });
  const safe = makeSafe([display, body, bold]);

  let logo: PDFImage | null = null;
  if (assets.logo) { try { logo = await doc.embedPng(assets.logo); } catch { logo = null; } }

  const pages: PDFPage[] = [];
  let page: PDFPage;
  let y = 0;

  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    y = PAGE_H - M_TOP;
    return page;
  };
  const text = (s: unknown, x: number, yy: number, size: number, font: PDFFont,
                color = INK, opts: Record<string, unknown> = {}) =>
    page.drawText(safe(s), { x, y: yy, size, font, color, ...opts });
  const right = (s: unknown, xr: number, yy: number, size: number, font: PDFFont, color = INK) => {
    const t = safe(s);
    page.drawText(t, { x: xr - font.widthOfTextAtSize(t, size), y: yy, size, font, color });
  };
  const rule = (yy: number, color = RULE, thickness = 1, x = M_X, w = CONTENT) =>
    page.drawLine({ start: { x, y: yy }, end: { x: x + w, y: yy }, thickness, color });
  const box = (x: number, yy: number, w: number, h: number, color: ReturnType<typeof rgb>) =>
    page.drawRectangle({ x, y: yy, width: w, height: h, color });

  /* Greedy wrap. Returns the lines; the caller decides what they cost. */
  const wrap = (s: unknown, width: number, size: number, font: PDFFont): string[] => {
    const out: string[] = [];
    String(safe(s)).split('\n').forEach((para: string) => {
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length) { out.push(''); return; }
      let line = '';
      words.forEach((w) => {
        const test = line ? line + ' ' + w : w;
        if (font.widthOfTextAtSize(test, size) <= width) { line = test; return; }
        if (line) out.push(line);
        // A single word longer than the column is cut rather than allowed to
        // run into the money.
        if (font.widthOfTextAtSize(w, size) > width) {
          let chunk = '';
          w.split('').forEach((c) => {
            if (font.widthOfTextAtSize(chunk + c, size) <= width) { chunk += c; }
            else { out.push(chunk); chunk = c; }
          });
          line = chunk;
        } else line = w;
      });
      if (line) out.push(line);
    });
    return out;
  };

  /* ---------- letterhead ---------- */
  const letterhead = (continued: boolean) => {
    newPage();
    let hx = M_X;
    if (logo) {
      const h = 34, w = (logo.width / logo.height) * h;
      page.drawImage(logo, { x: M_X, y: y - h, width: w, height: h });
      hx = M_X + w + 14;
    }
    text(company.company_name || 'State of the Arc Welding & Services LLC',
         hx, y - 12, 10.5, bold, INK);
    text(company.company_address || '', hx, y - 24, 8.5, body, MUTE);
    text(company.company_phone || '', hx, y - 34.5, 8.5, body, MUTE);

    // The word, hard right, in the display face.
    const word = continued ? 'INVOICE  (CONT.)' : 'INVOICE';
    right(word, M_X + CONTENT, y - 14, continued ? 15 : 22, display, INK);
    right(`No. ${p.invoice_no || 'DRAFT'}`, M_X + CONTENT, y - 30, 10, bold, DEEP);

    y -= 46;
    rule(y, GOLD, 2);
    y -= 18;
  };

  /* ---------- page one ---------- */
  letterhead(false);

  // meta strip: date, terms, PO.
  //
  // Terms are NOT assumed. Most customers have none set, and some settle on
  // pickup rather than on any number of days, so a printed "Net 30" would be a
  // claim this document has no business making. Whatever QuickBooks put on the
  // invoice is what appears; when it says nothing, so does this.
  const termsLabel = String(p.terms_label ?? '').trim();
  const dueOn = p.due_date || '';
  const metaH = 40;
  box(M_X, y - metaH, CONTENT, metaH, WASH);
  page.drawLine({ start: { x: M_X, y: y - metaH }, end: { x: M_X + CONTENT, y: y - metaH },
                  thickness: 1, color: RULE });
  const metaCells = [
    ['INVOICE DATE', usDate(p.transaction_date)],
    ['TERMS', termsLabel],
    ['DUE', dueOn ? usDate(dueOn) : ''],
    ['YOUR PO', p.po_number || '--'],
  ];
  const mw = CONTENT / metaCells.length;
  metaCells.forEach(([k, v], i) => {
    const cx = M_X + mw * i + 12;
    text(k, cx, y - 15, 7, bold, MUTE, { characterSpacing: 0.6 });
    text(v || '--', cx, y - 30, 10.5, body, INK);
    if (i) page.drawLine({ start: { x: M_X + mw * i, y: y - metaH },
                           end: { x: M_X + mw * i, y }, thickness: 1, color: RULE });
  });
  y -= metaH + 22;

  /* ---------- bill to | reference ---------- */
  const colW = (CONTENT - 24) / 2;
  const headingAt = (label, x, yy) => {
    text(label, x, yy, 7.5, bold, DEEP, { characterSpacing: 0.8 });
    page.drawLine({ start: { x, y: yy - 5 }, end: { x: x + colW, y: yy - 5 },
                    thickness: 1, color: HAIR });
  };
  headingAt('BILL TO', M_X, y);
  headingAt('REFERENCE', M_X + colW + 24, y);
  let ly = y - 19, ry = y - 19;

  text(p.customer_name || '--', M_X, ly, 11, bold, INK); ly -= 13;
  [p.bill_to_attn, p.bill_email, ...(String(p.bill_address || '').split('\n'))]
    .filter(Boolean).forEach((l) => { text(l, M_X, ly, 9, body, SOFT); ly -= 11.5; });

  const refLines = [];
  if (p.reference_part) refLines.push(`Part: ${p.reference_part}`);
  if (p.reference_process) refLines.push(`Process: ${p.reference_process}`);
  if (p.company_rep) refLines.push(`Your representative: ${p.company_rep}`);
  if (p.quote_no) refLines.push(`Per quote ${p.quote_no}`);
  if (!refLines.length) refLines.push('--');
  refLines.forEach((l) => {
    wrap(l, colW, 9, body).forEach((w) => { text(w, M_X + colW + 24, ry, 9, body, SOFT); ry -= 11.5; });
  });

  y = Math.min(ly, ry) - 12;

  /* ---------- scope ---------- */
  if (p.scope) {
    text('SCOPE OF WORK', M_X, y, 7.5, bold, DEEP, { characterSpacing: 0.8 });
    page.drawLine({ start: { x: M_X, y: y - 5 }, end: { x: M_X + CONTENT, y: y - 5 },
                    thickness: 1, color: HAIR });
    y -= 19;
    wrap(p.scope, CONTENT, 9.5, body).forEach((l) => { text(l, M_X, y, 9.5, body, SOFT); y -= 12; });
    y -= 10;
  }

  /* ---------- the detail ---------- */
  /* Columns are measured, not chosen. Picking offsets by eye put every unit
     price on top of its own amount -- up to 9.8pt of overlap on invoice 2995 --
     because a right-aligned figure grows leftwards and nothing was reserving
     room for it. Each money column is sized to the widest figure it can hold,
     laid out from the right edge, with a fixed gutter between. */
  const GUT = 14;
  const W_AMT   = bold.widthOfTextAtSize('$000,000.00', 9.5);
  const W_PRICE = body.widthOfTextAtSize('$000,000.00', 9);
  const W_UNIT  = body.widthOfTextAtSize('each', 9);
  const W_QTY   = body.widthOfTextAtSize('00,000.00', 9);

  const COL = {
    desc:   M_X,
    qtyR:   0,
    unit:   0,
    priceR: 0,
    amtR:   M_X + CONTENT - 8,
  };
  COL.priceR = COL.amtR - W_AMT - GUT;
  COL.unit   = COL.priceR - W_PRICE - GUT - W_UNIT;
  COL.qtyR   = COL.unit - GUT;
  const DESC_W = (COL.qtyR - W_QTY) - GUT - (M_X + 8);

  const tableHead = () => {
    box(M_X, y - 17, CONTENT, 17, INK);
    text('DESCRIPTION', COL.desc + 8, y - 12, 7.5, bold, WHITE, { characterSpacing: 0.7 });
    right('QTY', COL.qtyR, y - 12, 7.5, bold, WHITE);
    text('UNIT', COL.unit, y - 12, 7.5, bold, WHITE, { characterSpacing: 0.7 });
    right('UNIT PRICE', COL.priceR, y - 12, 7.5, bold, WHITE);
    right('AMOUNT', COL.amtR, y - 12, 7.5, bold, WHITE);
    y -= 17;
  };
  tableHead();

  const lines = Array.isArray(p.lines) ? p.lines : [];
  let zebra = false;
  lines.forEach((l) => {
    const wrapped = wrap(l.description || '', DESC_W, 9, body);
    const rowH = Math.max(20, wrapped.length * 11.5 + 9);
    if (y - rowH < FOOT + 120) {           // keep the table off the footer
      letterhead(true);
      tableHead();
    }
    if (zebra) box(M_X, y - rowH, CONTENT, rowH, WASH);
    zebra = !zebra;

    let ty = y - 13;
    wrapped.forEach((w) => { text(w, COL.desc + 8, ty, 9, body, INK); ty -= 11.5; });
    right(qty(l.quantity), COL.qtyR, y - 13, 9, body, SOFT);
    text(l.unit || 'ea', COL.unit, y - 13, 9, body, MUTE);
    right(money(l.unit_price), COL.priceR, y - 13, 9, body, SOFT);
    right(money(l.amount), COL.amtR, y - 13, 9.5, bold, INK);

    y -= rowH;
    page.drawLine({ start: { x: M_X, y }, end: { x: M_X + CONTENT, y }, thickness: 1, color: HAIR });
  });

  /* ---------- total ---------- */
  y -= 10;
  const bandH = 34, bandW = 250, bandX = M_X + CONTENT - bandW;
  box(bandX, y - bandH, bandW, bandH, GWASH);
  page.drawRectangle({ x: bandX, y: y - bandH, width: bandW, height: bandH,
                       borderColor: GOLD, borderWidth: 1 });
  text('TOTAL DUE', bandX + 14, y - 21, 9, bold, DEEP, { characterSpacing: 0.8 });
  // Right edge shared with the AMOUNT column above, so the grand total sits
  // under the column it is the sum of rather than 6pt inside it.
  right(money(p.expected_total ?? p.lines_total), COL.amtR, y - 23, 15, display, INK);
  y -= bandH + 24;

  /* ---------- the blocks the quote carries ---------- */
  const blockNeeds = (_title: string, content: string) => {
    const ls = wrap(content, CONTENT, 8.5, body);
    return 14 + ls.length * 11 + 10;
  };
  const block = (title: string, content: string) => {
    const need = blockNeeds(title, content);
    if (y - need < FOOT + 40) { letterhead(true); }
    text(title, M_X, y, 7.5, bold, DEEP, { characterSpacing: 0.8 });
    page.drawLine({ start: { x: M_X, y: y - 5 }, end: { x: M_X + CONTENT, y: y - 5 },
                    thickness: 1, color: HAIR });
    y -= 17;
    wrap(content, CONTENT, 8.5, body).forEach((l) => { text(l, M_X, y, 8.5, body, SOFT); y -= 11; });
    y -= 10;
  };

  if (p.basis) block('BASIS OF THIS INVOICE', String(p.basis));
  if (p.terms) block('TERMS', String(p.terms));

  /* ---------- remit ----------
     Company name and address only. No line telling them to put the invoice
     number on the payment -- Gilbert asked for that one left off. */
  const remitH = 46;
  if (y - remitH < FOOT + 10) letterhead(true);
  box(M_X, y - remitH, CONTENT, remitH, WASH);
  page.drawRectangle({ x: M_X, y: y - remitH, width: CONTENT, height: remitH,
                       borderColor: RULE, borderWidth: 1 });
  text('REMIT TO', M_X + 14, y - 15, 7.5, bold, DEEP, { characterSpacing: 0.8 });
  text(company.company_name || '', M_X + 14, y - 29, 10, bold, INK);
  text(company.company_address || '', M_X + 14, y - 40, 8.5, body, SOFT);
  y -= remitH;

  /* ---------- footer on every page ---------- */
  pages.forEach((pg, i) => {
    pg.drawLine({ start: { x: M_X, y: FOOT + 14 }, end: { x: M_X + CONTENT, y: FOOT + 14 },
                  thickness: 1, color: HAIR });
    const foot = safe(`${company.company_name || ''}  ·  ${company.company_phone || ''}`);
    pg.drawText(foot, { x: M_X, y: FOOT + 2, size: 7.5, font: body, color: MUTE });
    const pn = safe(`Page ${i + 1} of ${pages.length}`);
    pg.drawText(pn, { x: M_X + CONTENT - body.widthOfTextAtSize(pn, 7.5),
                      y: FOOT + 2, size: 7.5, font: body, color: MUTE });
    const inv = safe(`Invoice ${p.invoice_no || 'DRAFT'}`);
    pg.drawText(inv, { x: (PAGE_W - body.widthOfTextAtSize(inv, 7.5)) / 2,
                       y: FOOT + 2, size: 7.5, font: body, color: MUTE });
  });

  return await doc.save();
}
