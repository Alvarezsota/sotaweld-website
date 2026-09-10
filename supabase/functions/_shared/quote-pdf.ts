// The quote, on the same letterhead as the invoice.
//
// A customer who accepts a quote and then gets an invoice is holding two pieces
// of paper from the same company, and they have to read like it: the same ink,
// the same gold rule, the same blocks in the same order. The palette, the page
// box and the character folding all come from invoice-pdf.ts rather than being
// restated here, so the two cannot drift apart on any of them.
//
// ---------------------------------------------------------------------------
// A LUMP SECTION SHOWS ITS TOTAL AND NOTHING ELSE
// ---------------------------------------------------------------------------
// Quoting a section as one figure is a decision about what the customer is
// shown. This draws it the way it was decided: the section label, one figure,
// no breakdown. The itemised sections underneath it are itemised in full. It is
// the same rule convert_quote_to_invoice follows when the work is billed, so
// the quote and the invoice agree about what was and was not disclosed.

import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import fontkit from 'https://esm.sh/@pdf-lib/fontkit@1.1.1';
import {
  CONTENT, DEEP, FOOT, GOLD, GWASH, HAIR, INK, M_TOP, M_X, MUTE,
  PAGE_H, PAGE_W, RULE, SOFT, WASH, WHITE,
  makeSafe, money, qty, usDate,
  type CompanyBlock, type PdfAssets, type QuotePayload, type QuoteSection,
} from './invoice-pdf.ts';

const lineAmount = (l: { quantity?: unknown; unit_price?: unknown; amount?: unknown }) =>
  l.amount != null ? Number(l.amount)
                   : Number(l.quantity || 0) * Number(l.unit_price || 0);

const sectionTotal = (sec: QuoteSection) =>
  (sec.lines || []).reduce((t, l) => t + lineAmount(l), 0);

export function quotePdfFileName(quoteNo: string, customer: string): string {
  const who = (customer || 'customer').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
  return `Quote ${quoteNo || 'draft'} - ${who}.pdf`.slice(0, 120);
}

export async function buildQuotePdf(
  p: QuotePayload, company: CompanyBlock, assets: PdfAssets,
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

  const newPage = () => { page = doc.addPage([PAGE_W, PAGE_H]); pages.push(page); y = PAGE_H - M_TOP; };
  const text = (s: unknown, x: number, yy: number, size: number, font: PDFFont,
                color = INK, opts: Record<string, unknown> = {}) =>
    page.drawText(safe(s), { x, y: yy, size, font, color, ...opts });
  const right = (s: unknown, xr: number, yy: number, size: number, font: PDFFont, color = INK) => {
    const t = safe(s);
    page.drawText(t, { x: xr - font.widthOfTextAtSize(t, size), y: yy, size, font, color });
  };
  const box = (x: number, yy: number, w: number, h: number, color: ReturnType<typeof rgb>) =>
    page.drawRectangle({ x, y: yy, width: w, height: h, color });
  const hair = (yy: number, x = M_X, w = CONTENT, color = HAIR) =>
    page.drawLine({ start: { x, y: yy }, end: { x: x + w, y: yy }, thickness: 1, color });

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
        if (font.widthOfTextAtSize(w, size) > width) {
          let chunk = '';
          w.split('').forEach((c) => {
            if (font.widthOfTextAtSize(chunk + c, size) <= width) chunk += c;
            else { out.push(chunk); chunk = c; }
          });
          line = chunk;
        } else line = w;
      });
      if (line) out.push(line);
    });
    return out;
  };

  const letterhead = (continued: boolean) => {
    newPage();
    let hx = M_X;
    if (logo) {
      const h = 34, w = (logo.width / logo.height) * h;
      page.drawImage(logo, { x: M_X, y: y - h, width: w, height: h });
      hx = M_X + w + 14;
    }
    text(company.company_name || '', hx, y - 12, 10.5, bold, INK);
    text(company.company_address || '', hx, y - 24, 8.5, body, MUTE);
    text(company.company_phone || '', hx, y - 34.5, 8.5, body, MUTE);

    right(continued ? 'QUOTATION  (CONT.)' : 'QUOTATION',
          M_X + CONTENT, y - 14, continued ? 14 : 20, display, INK);
    right(`No. ${p.quote_no || 'DRAFT'}`, M_X + CONTENT, y - 30, 10, bold, DEEP);

    y -= 46;
    page.drawLine({ start: { x: M_X, y }, end: { x: M_X + CONTENT, y }, thickness: 2, color: GOLD });
    y -= 18;
  };

  const heading = (label: string, x = M_X, w = CONTENT) => {
    text(label, x, y, 7.5, bold, DEEP, { characterSpacing: 0.8 });
    hair(y - 5, x, w);
  };

  letterhead(false);

  /* ---------- meta strip ---------- */
  const metaH = 40;
  box(M_X, y - metaH, CONTENT, metaH, WASH);
  hair(y - metaH, M_X, CONTENT, RULE);
  const cells: [string, string][] = [
    ['QUOTE DATE', usDate(p.quote_date)],
    ['VALID THROUGH', p.valid_through ? usDate(p.valid_through) : ''],
    ['TERMS', p.net_days == null ? '' : `Net ${p.net_days}`],
    ['YOUR RFQ / PO', p.po_number || ''],
  ];
  const mw = CONTENT / cells.length;
  cells.forEach(([k, v], i) => {
    const cx = M_X + mw * i + 12;
    text(k, cx, y - 15, 7, bold, MUTE, { characterSpacing: 0.6 });
    text(v || '--', cx, y - 30, 10.5, body, INK);
    if (i) page.drawLine({ start: { x: M_X + mw * i, y: y - metaH },
                           end: { x: M_X + mw * i, y }, thickness: 1, color: RULE });
  });
  y -= metaH + 22;

  /* ---------- quoted to | reference ---------- */
  const colW = (CONTENT - 24) / 2;
  heading('QUOTED TO', M_X, colW);
  heading('REFERENCE', M_X + colW + 24, colW);
  let ly = y - 19, ry = y - 19;

  text(p.customer_name || '--', M_X, ly, 11, bold, INK); ly -= 13;
  [p.bill_to_attn, p.bill_email, ...(String(p.bill_address || '').split('\n'))]
    .filter(Boolean).forEach((l) => { text(l, M_X, ly, 9, body, SOFT); ly -= 11.5; });

  const refs: string[] = [];
  if (p.reference_part) refs.push(`Part: ${p.reference_part}`);
  if (p.reference_process) refs.push(`Process: ${p.reference_process}`);
  if (p.job_name) refs.push(`Job: ${p.job_name}`);
  if (!refs.length) refs.push('--');
  refs.forEach((l) => wrap(l, colW, 9, body).forEach((w) => {
    text(w, M_X + colW + 24, ry, 9, body, SOFT); ry -= 11.5;
  }));

  y = Math.min(ly, ry) - 12;

  /* ---------- scope ---------- */
  if (p.scope) {
    heading('SCOPE OF WORK');
    y -= 19;
    wrap(p.scope, CONTENT, 9.5, body).forEach((l) => { text(l, M_X, y, 9.5, body, SOFT); y -= 12; });
    y -= 10;
  }

  /* ---------- price ----------
     Columns measured off the fonts, the same way the invoice does it, so a
     right-aligned figure can never grow back into the column beside it. */
  const GUT = 14;
  const W_AMT   = bold.widthOfTextAtSize('$000,000.00', 9.5);
  const W_PRICE = body.widthOfTextAtSize('$000,000.00', 9);
  const W_UNIT  = body.widthOfTextAtSize('each', 9);
  const W_QTY   = body.widthOfTextAtSize('00,000.00', 9);
  const AMT_R   = M_X + CONTENT - 8;
  const PRICE_R = AMT_R - W_AMT - GUT;
  const UNIT_X  = PRICE_R - W_PRICE - GUT - W_UNIT;
  const QTY_R   = UNIT_X - GUT;
  const DESC_W  = (QTY_R - W_QTY) - GUT - (M_X + 8);

  const tableHead = () => {
    box(M_X, y - 17, CONTENT, 17, INK);
    text('DESCRIPTION', M_X + 8, y - 12, 7.5, bold, WHITE, { characterSpacing: 0.7 });
    right('QTY', QTY_R, y - 12, 7.5, bold, WHITE);
    text('UNIT', UNIT_X, y - 12, 7.5, bold, WHITE, { characterSpacing: 0.7 });
    right('UNIT PRICE', PRICE_R, y - 12, 7.5, bold, WHITE);
    right('AMOUNT', AMT_R, y - 12, 7.5, bold, WHITE);
    y -= 17;
  };
  const room = (need: number) => {
    if (y - need < FOOT + 90) { letterhead(true); tableHead(); }
  };

  heading('PRICE');
  y -= 19;
  tableHead();

  const sections = (p.sections || []).filter((sec) => (sec.lines || []).length);
  let zebra = false;
  sections.forEach((sec) => {
    room(40);
    zebra = false;

    if (sec.lump) {
      // One figure, on the band itself. No quantity, no rate, no second row
      // repeating the section name, and nothing to work the breakdown back out
      // of -- which is the whole point of quoting it this way.
      const h = 22;
      room(h);
      box(M_X, y - h, CONTENT, h, GWASH);
      text(sec.label, M_X + 8, y - 14.5, 9, bold, DEEP, { characterSpacing: 0.3 });
      right('quoted as a lump sum', PRICE_R, y - 14, 7.5, body, MUTE);
      right(money(sectionTotal(sec)), AMT_R, y - 14.5, 9.5, bold, INK);
      y -= h;
      hair(y);
      return;
    }

    // section band
    box(M_X, y - 16, CONTENT, 16, GWASH);
    text(sec.label, M_X + 8, y - 11.5, 8, bold, DEEP, { characterSpacing: 0.5 });
    y -= 16;

    (sec.lines || []).forEach((l) => {
      const wrapped = wrap(l.description || '', DESC_W, 9, body);
      const h = Math.max(20, wrapped.length * 11.5 + 9);
      room(h);
      if (zebra) box(M_X, y - h, CONTENT, h, WASH);
      zebra = !zebra;
      let ty = y - 13;
      wrapped.forEach((w) => { text(w, M_X + 8, ty, 9, body, INK); ty -= 11.5; });
      right(qty(l.quantity), QTY_R, y - 13, 9, body, SOFT);
      text(l.unit || 'ea', UNIT_X, y - 13, 9, body, MUTE);
      right(money(l.unit_price), PRICE_R, y - 13, 9, body, SOFT);
      right(money(lineAmount(l)), AMT_R, y - 13, 9.5, bold, INK);
      y -= h;
      hair(y);
    });
  });

  /* ---------- total ---------- */
  y -= 10;
  const bandH = 34, bandW = 250, bandX = M_X + CONTENT - bandW;
  if (y - bandH < FOOT + 60) letterhead(true);
  box(bandX, y - bandH, bandW, bandH, GWASH);
  page.drawRectangle({ x: bandX, y: y - bandH, width: bandW, height: bandH,
                       borderColor: GOLD, borderWidth: 1 });
  text('QUOTE TOTAL', bandX + 14, y - 21, 9, bold, DEEP, { characterSpacing: 0.8 });
  const total = p.total != null ? Number(p.total) : sections.reduce((t, s) => t + sectionTotal(s), 0);
  right(money(total), AMT_R, y - 23, 15, display, INK);
  y -= bandH + 24;

  /* ---------- basis and terms ---------- */
  const block = (title: string, content: string) => {
    const need = 14 + wrap(content, CONTENT, 8.5, body).length * 11 + 10;
    if (y - need < FOOT + 40) letterhead(true);
    heading(title);
    y -= 17;
    wrap(content, CONTENT, 8.5, body).forEach((l) => { text(l, M_X, y, 8.5, body, SOFT); y -= 11; });
    y -= 10;
  };
  if (p.basis) block('BASIS OF QUOTE', String(p.basis));
  if (p.terms) block('TERMS', String(p.terms));

  /* ---------- acceptance ----------
     The half of the page that turns a quote into an order. It needs room to be
     signed, so it moves to its own page rather than being squeezed. */
  const accH = 96;
  if (y - accH < FOOT + 20) letterhead(true);
  heading('ACCEPTANCE');
  y -= 17;
  wrap('Sign and return this page to authorise the work above at the prices quoted.',
       CONTENT, 8.5, body).forEach((l) => { text(l, M_X, y, 8.5, body, SOFT); y -= 11; });
  y -= 14;

  const fieldW = (CONTENT - 28) / 3;
  ([['SIGNATURE', 0], ['TITLE / DATE', 1], ['PO NUMBER', 2]] as [string, number][])
    .forEach(([label, i]) => {
      const x = M_X + (fieldW + 14) * i;
      page.drawLine({ start: { x, y: y - 20 }, end: { x: x + fieldW, y: y - 20 },
                      thickness: 1, color: INK });
      text(label, x, y - 32, 7, bold, MUTE, { characterSpacing: 0.6 });
    });
  y -= 44;

  /* ---------- footer on every page ---------- */
  pages.forEach((pg, i) => {
    pg.drawLine({ start: { x: M_X, y: FOOT + 14 }, end: { x: M_X + CONTENT, y: FOOT + 14 },
                  thickness: 1, color: HAIR });
    const foot = safe(`${company.company_name || ''}  ·  ${company.company_phone || ''}`);
    pg.drawText(foot, { x: M_X, y: FOOT + 2, size: 7.5, font: body, color: MUTE });
    const pn = safe(`Page ${i + 1} of ${pages.length}`);
    pg.drawText(pn, { x: M_X + CONTENT - body.widthOfTextAtSize(pn, 7.5),
                      y: FOOT + 2, size: 7.5, font: body, color: MUTE });
    const mid = safe(`Quote ${p.quote_no || 'DRAFT'}`);
    pg.drawText(mid, { x: (PAGE_W - body.widthOfTextAtSize(mid, 7.5)) / 2,
                       y: FOOT + 2, size: 7.5, font: body, color: MUTE });
  });

  return await doc.save();
}
