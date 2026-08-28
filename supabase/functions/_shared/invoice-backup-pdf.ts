// The crew sheet that rides along with the invoice.
//
// An invoice says "Welder labor - 96.00 hrs - $14,400.00" on one line. The
// customer's man then rings the office and asks who those ninety-six hours
// were, and on what days, and the office goes back through the tickets by hand
// to answer a question the portal already knew the answer to.
//
// This draws that answer once, as a page: every name, every day, the hours
// beside each one, and a total that is the invoice total. It is attached to the
// QuickBooks invoice at the moment the invoice is created, so the backup and
// the bill are one document from then on and cannot be separated by anybody
// forgetting to send the second half.
//
// ---------------------------------------------------------------------------
// WHAT IS DELIBERATELY NOT ON IT
// ---------------------------------------------------------------------------
//
// The approvals screen shows pay rates, labour cost and margin next to the
// billed figures, because the office is looking at whether a job made money.
// None of those three appear here and none of them are passed in. This sheet
// goes to the customer on their own invoice; a margin column on it would hand
// them the markup on every man on the job, and it cannot be taken back once it
// has been attached over there.
//
// So: names, hours, billed rates, per diem, amounts. The billing side of the
// approvals page, and nothing from the cost side of it.
//
// ---------------------------------------------------------------------------
// A FLAT JOB HAS HOURS BUT NO HOURLY MONEY
// ---------------------------------------------------------------------------
//
// On a bid job the invoice comes off the bid items, not off anybody's hours, so
// the money columns here would be a set of numbers that do not add up to the
// invoice and cannot be made to. On those the sheet drops to hours only and
// says in words that the work was billed as a bid amount. Hours that answer the
// question are worth more than money columns that raise a new one.

import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1';

// ---------- looks ----------
// The same ink, accent and rules as the pay statement, so a customer holding
// both sees one company rather than two templates.
const INK = rgb(0.110, 0.094, 0.090);
const ACCENT = rgb(0.706, 0.329, 0.118);
const GREY = rgb(0.471, 0.443, 0.424);
const LINE = rgb(0.906, 0.898, 0.894);
const SOFT = rgb(0.980, 0.976, 0.969);

const PAGE_W = 612, PAGE_H = 792, MARGIN = 54;
const CONTENT = PAGE_W - MARGIN * 2;
const FOOT = 62;              // nothing is drawn below this line

const money = (n: unknown) =>
  '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n: unknown) => String(Math.round(Number(n || 0) * 100) / 100);
const usDate = (iso: string) => { const [y, m, d] = iso.split('-'); return `${m}-${d}-${y}`; };

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const dayLabel = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${DOW[dt.getUTCDay()]}, ${MON[m - 1]} ${d}`;
};
const spanLabel = (start: string, end: string) => {
  const [, sm, sd] = start.split('-').map(Number);
  const [, em, ed] = end.split('-').map(Number);
  return `${MON[sm - 1]} ${sd} \u2013 ${MON[em - 1]} ${ed}`;
};

// pdf-lib throws on a character the standard fonts cannot encode rather than
// skipping it, and job descriptions are typed on a phone. Lifted whole from the
// pay statement for the same reason it exists there: one stray glyph would
// otherwise take out the entire sheet.
const WINANSI_EXTRA = '\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152'
                    + '\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161'
                    + '\u203A\u0153\u017E\u0178';
const wa = (v: unknown) => {
  const folded = String(v ?? '')
    // A description typed on a phone carries newlines -- one real ticket reads
    // "2-16 brother in law con Elias / 23-1 1/2 socket weld / Glycol" across three
    // lines. Dropped as control characters they ran the words together, and handed
    // to drawText they would have spilled the row down the page. They become spaces.
    .replace(/[\r\n\t\v\f]+/g, ' ')
    .replace(/[\u00A0\u2007\u202F\u2009\u200A]/g, ' ')
    .replace(/[\u2212\u2012\u2015]/g, '-')
    .replace(/[\u2032]/g, "'").replace(/[\u2033]/g, '"')
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, '');
  let out = '';
  for (const ch of folded) {
    const c = ch.codePointAt(0)!;
    if ((c >= 0x20 && c <= 0x7E) || (c >= 0xA0 && c <= 0xFF) || WINANSI_EXTRA.includes(ch)) out += ch;
  }
  return out;
};

export type BackupLine = {
  name: string; kind: string; hours: number; bill_rate: number;
  per_diem: boolean; per_diem_rate: number; billed: number;
  stainless: boolean; description: string | null; worked_at: string | null;
};
export type BackupDay = { date: string; descriptions: string[]; lines: BackupLine[] };
export type BackupPerson = {
  name: string; kind: string; days: number; hours: number;
  per_diem_days: number; per_diem_amount: number; amount: number;
};
export type BackupPayload = {
  job_name: string; customer_name: string | null; operator: string | null; bill_to: string | null;
  billing_type: string; week_start: string; week_end: string;
  invoice_no: string | null; bid_number: string | null;
  invoice_total: number; labor_amount: number;
  welder_hours: number; helper_hours: number;
  per_diem_person_days: number; per_diem_amount: number;
  days: BackupDay[]; crew: BackupPerson[];
};

export function backupFileName(p: BackupPayload) {
  const who = (p.job_name || 'job').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
  return `Crew time backup - ${who} - week of ${usDate(p.week_start)}`
    + (p.invoice_no ? ` - invoice ${p.invoice_no}` : '') + '.pdf';
}

export async function buildInvoiceBackup(
  p: BackupPayload,
  company: Record<string, string>,
  logo: Uint8Array | null,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ital = await doc.embedFont(StandardFonts.HelveticaOblique);

  // A bid job is billed off its bid items, so the per-line money on this sheet
  // would not add to the invoice. Hours only, and say why underneath.
  const showMoney = p.billing_type !== 'flat';

  const pages: PDFPage[] = [];
  let page = doc.addPage([PAGE_W, PAGE_H]);
  pages.push(page);
  let y = PAGE_H - MARGIN;

  const text = (raw: string, x: number, yy: number, size: number, font: PDFFont = reg, color = INK) =>
    page.drawText(wa(raw), { x, y: yy, size, font, color });
  const right = (raw: string, xEnd: number, yy: number, size: number, font: PDFFont = reg, color = INK) => {
    const s = wa(raw);
    page.drawText(s, { x: xEnd - font.widthOfTextAtSize(s, size), y: yy, size, font, color });
  };
  const fit = (raw: string, width: number, size: number, font: PDFFont = reg) => {
    const s = wa(raw);
    if (font.widthOfTextAtSize(s, size) <= width) return s;
    let out = s;
    while (out.length > 1 && font.widthOfTextAtSize(out + '\u2026', size) > width) out = out.slice(0, -1);
    return out + '\u2026';
  };
  const rule = (yy: number, thickness = 1, color = LINE) =>
    page.drawLine({ start: { x: MARGIN, y: yy }, end: { x: MARGIN + CONTENT, y: yy }, thickness, color });

  // ---- letterhead ----
  let headTextX = MARGIN;
  if (logo) {
    try {
      const img = await doc.embedPng(logo);
      // Height-capped, not width-capped. The mark is wider than it is tall and a
      // fixed width let it hang below the rule and print through the title.
      const h = 34, w = (img.width / img.height) * h;
      page.drawImage(img, { x: MARGIN, y: y - h - 2, width: w, height: h });
      headTextX = MARGIN + w + 16;
    } catch { /* the letterhead reads fine on text alone */ }
  }
  text((company.company_name || 'State of the Arc Welding & Services').toUpperCase(),
       headTextX, y - 14, 13, bold);
  const addr = [company.company_address, company.company_phone].filter(Boolean).join('  \u00B7  ');
  if (addr) text(addr, headTextX, y - 28, 9, reg, GREY);
  y -= 46;
  rule(y, 2.5, INK);
  y -= 26;

  // ---- title ----
  text('CREW TIME BACKUP', MARGIN, y, 11.5, bold, ACCENT);
  right(p.invoice_no ? `Invoice #${p.invoice_no}` : 'Invoice not yet numbered',
        MARGIN + CONTENT, y, 10, bold, GREY);
  y -= 26;
  text(fit(p.job_name || 'Job', CONTENT - 150, 19, bold), MARGIN, y, 19, bold);
  right(spanLabel(p.week_start, p.week_end), MARGIN + CONTENT, y + 2, 11, reg, GREY);
  y -= 15;
  const route = [p.customer_name || p.bill_to, p.operator ? `on ${p.operator}` : null]
    .filter(Boolean).join('  \u00B7  ');
  text(route + (p.bid_number ? `  \u00B7  Bid #${p.bid_number}` : ''), MARGIN, y, 9.5, reg, GREY);
  y -= 12;
  text(`Week of ${usDate(p.week_start)} through ${usDate(p.week_end)}`, MARGIN, y, 9.5, reg, GREY);
  y -= 24;

  // ---- the four numbers, before any of the detail ----
  // Whoever is checking the invoice is checking these; the pages underneath are
  // where they came from.
  const cells: [string, string][] = [
    ['WELDER HOURS', num(p.welder_hours)],
    ['HELPER HOURS', num(p.helper_hours)],
    ['PER DIEM DAYS', num(p.per_diem_person_days)],
    ['INVOICE TOTAL', money(p.invoice_total)],
  ];
  page.drawRectangle({ x: MARGIN, y: y - 34, width: CONTENT, height: 46,
                       color: SOFT, borderColor: LINE, borderWidth: 1 });
  const cellW = CONTENT / cells.length;
  cells.forEach(([label, value], i) => {
    const cx = MARGIN + cellW * i + 14;
    text(label, cx, y - 2, 7.5, bold, GREY);
    text(value, cx, y - 22, 15, bold, i === cells.length - 1 ? ACCENT : INK);
    if (i) page.drawLine({ start: { x: MARGIN + cellW * i, y: y - 34 },
                           end: { x: MARGIN + cellW * i, y: y + 12 }, thickness: 1, color: LINE });
  });
  y -= 58;

  // Page breaks happen inside two different tables, and both need the running
  // header redrawn on the new page. Each table hands its own header in.
  const newPage = (header: () => void) => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    y = PAGE_H - MARGIN;
    header();
  };
  const room = (need: number, header: () => void) => { if (y - need < FOOT) newPage(header); };

  // ---- who worked this week ----
  // The recap first, because "who was on my job and for how long" is the whole
  // question. The day-by-day pages underneath are the proof of it.
  const CREW_COLS = showMoney ? [196, 66, 54, 62, 60, 66] : [258, 84, 78, 84];
  const CREW_HEAD = showMoney
    ? ['Name', 'Role', 'Days', 'Hours', 'Per diem', 'Amount']
    : ['Name', 'Role', 'Days', 'Hours'];
  const CX: number[] = [];
  CREW_COLS.reduce((acc, w, i) => { CX[i] = acc; return acc + w; }, MARGIN);
  const crewEnd = (i: number) => CX[i] + CREW_COLS[i];

  const crewHeader = () => {
    text('WHO WORKED THIS WEEK', MARGIN, y, 9, bold, ACCENT);
    y -= 16;
    CREW_HEAD.forEach((h, i) => {
      if (i <= 1) text(h.toUpperCase(), CX[i], y, 7.5, bold, GREY);
      else right(h.toUpperCase(), crewEnd(i) - 4, y, 7.5, bold, GREY);
    });
    y -= 6;
    rule(y, 1.2, INK);
    y -= 14;
  };
  crewHeader();

  for (const c of p.crew) {
    room(20, crewHeader);
    text(fit(c.name, CREW_COLS[0] - 6, 9.5, bold), CX[0], y, 9.5, bold);
    text(c.kind === 'welder' ? 'Welder' : 'Helper', CX[1], y, 8.5, reg, GREY);
    right(num(c.days), crewEnd(2) - 4, y, 9);
    right(num(c.hours), crewEnd(3) - 4, y, 9, bold);
    if (showMoney) {
      right(c.per_diem_days ? `${num(c.per_diem_days)} \u00D7 ${money(c.per_diem_amount / c.per_diem_days)}` : '\u2014',
            crewEnd(4) - 4, y, 8, reg, GREY);
      right(money(c.amount), crewEnd(5) - 4, y, 9, bold);
    }
    y -= 16;
    rule(y + 8);
  }
  if (!p.crew.length) { text('Nobody was logged on this job this week.', CX[0], y, 9, reg, GREY); y -= 16; }

  y -= 2;
  rule(y, 1.6, INK);
  y -= 14;
  text('Total', CX[0], y, 9, bold);
  right(num(Number(p.welder_hours) + Number(p.helper_hours)), crewEnd(3) - 4, y, 9, bold);
  if (showMoney) {
    right(p.per_diem_amount ? money(p.per_diem_amount) : '\u2014', crewEnd(4) - 4, y, 8.5, bold, GREY);
    right(money(p.labor_amount + p.per_diem_amount), crewEnd(5) - 4, y, 9.5, bold, ACCENT);
  }
  y -= 30;

  // ---- day by day ----
  const DAY_COLS = showMoney ? [190, 62, 54, 62, 62, 74] : [252, 84, 78, 90];
  const DAY_HEAD = showMoney
    ? ['Person', 'Role', 'Hours', 'Rate', 'Per diem', 'Amount']
    : ['Person', 'Role', 'Hours', 'Per diem'];
  const DX: number[] = [];
  DAY_COLS.reduce((acc, w, i) => { DX[i] = acc; return acc + w; }, MARGIN);
  const dayEnd = (i: number) => DX[i] + DAY_COLS[i];

  // The date bar.
  //
  // It has to outrank the names under it at a glance. A day heading set at the
  // same weight as a man's name is a heading nobody sees, and then a sheet whose
  // whole purpose is saying which day a man worked reads as one long list. So it
  // is bigger than anything else in the table, it carries the accent stripe, and
  // it sits in a band deep enough to break the rows apart.
  const DESC_X = MARGIN + 152;
  const dayBar = (label: string) => {
    page.drawRectangle({ x: MARGIN, y: y - 8, width: CONTENT, height: 25, color: SOFT });
    page.drawRectangle({ x: MARGIN, y: y - 8, width: 4, height: 25, color: ACCENT });
    page.drawLine({ start: { x: MARGIN, y: y + 17 }, end: { x: MARGIN + CONTENT, y: y + 17 },
                    thickness: 0.8, color: LINE });
    text(label, MARGIN + 14, y, 12.5, bold);
  };

  // Set while the rows of one date are being drawn, so a page break in the
  // middle of a long day carries that date onto the new page. Without it the
  // rows at the top of page two belong to no date at all, which on a sheet whose
  // whole job is saying which day a man worked is the one thing it must not do.
  let openDay: string | null = null;

  const dayHeader = () => {
    text('DAY BY DAY', MARGIN, y, 9, bold, ACCENT);
    y -= 16;
    DAY_HEAD.forEach((h, i) => {
      if (i <= 1) text(h.toUpperCase(), DX[i], y, 7.5, bold, GREY);
      else right(h.toUpperCase(), dayEnd(i) - 4, y, 7.5, bold, GREY);
    });
    y -= 6;
    rule(y, 1.2, INK);
    y -= 16;
    if (openDay) { y -= 12; dayBar(`${dayLabel(openDay)} (continued)`); y -= 24; }
  };
  room(110, dayHeader);
  dayHeader();

  for (const d of p.days) {
    // A day heading with no rows under it on the page it lands on is worse than
    // a slightly short page, so the heading and its first line move together.
    openDay = null;
    room(70, dayHeader);
    y -= 12;
    dayBar(dayLabel(d.date));
    const desc = d.descriptions.filter(Boolean).join(' \u00B7 ');
    if (desc) text(fit(desc, MARGIN + CONTENT - DESC_X, 8.5, ital), DESC_X, y, 8.5, ital, GREY);
    y -= 24;
    openDay = d.date;

    for (const l of d.lines) {
      const note = [l.description, l.stainless ? 'Stainless' : null,
                    l.worked_at && l.worked_at !== p.job_name ? `worked at ${l.worked_at}` : null]
        .filter(Boolean).join(' \u00B7 ');
      const rowH = note ? 25 : 16;
      room(rowH, dayHeader);

      text(fit(l.name, DAY_COLS[0] - 6, 9.5, bold), DX[0], y, 9.5, bold);
      text(l.kind === 'welder' ? 'Welder' : 'Helper', DX[1], y, 8.5, reg, GREY);
      right(num(l.hours), dayEnd(2) - 4, y, 9);
      if (showMoney) {
        right(l.bill_rate ? money(l.bill_rate) : '\u2014', dayEnd(3) - 4, y, 9, reg, GREY);
        right(l.per_diem ? money(l.per_diem_rate) : '\u2014', dayEnd(4) - 4, y, 9, reg, GREY);
        right(money(Number(l.billed) + (l.per_diem ? Number(l.per_diem_rate) : 0)), dayEnd(5) - 4, y, 9, bold);
      } else {
        right(l.per_diem ? money(l.per_diem_rate) : '\u2014', dayEnd(3) - 4, y, 9, reg, GREY);
      }
      if (note) text(fit(note, CONTENT - 90, 7.5, ital), DX[0], y - 10, 7.5, ital, GREY);
      y -= rowH;
      rule(y + 8);
    }
    if (!d.lines.length) { text('No hours logged.', DX[0], y, 8.5, reg, GREY); y -= 16; }
  }
  openDay = null;
  if (!p.days.length) { text('No days logged on this job this week.', DX[0], y - 12, 9, reg, GREY); y -= 28; }

  // ---- what this ties to ----
  //
  // Asking for room the block does not need pushed it onto a page of its own,
  // and breaking on dayHeader printed a DAY BY DAY heading up there with no day
  // under it. It is not part of that table, so it breaks on nothing, and it asks
  // for what it actually occupies -- which is the difference between this
  // landing under the last man and landing on an otherwise blank sheet.
  const other = showMoney
    ? Number(p.invoice_total) - (Number(p.labor_amount) + Number(p.per_diem_amount))
    : 0;
  //
  // The numbers are what the block actually occupies, measured down from the y
  // it starts at to the bottom of the total box: 58pt plain, 74 with the parts
  // line, 87 and 103 on the bid wording. Guessing high broke a three-day sheet
  // onto a second page it had three inches of room to avoid.
  const closingNeed = showMoney
    ? (Math.abs(other) > 0.005 ? 70 : 54)
    : (Number(p.per_diem_amount) > 0 ? 95 : 79);
  room(closingNeed, () => {});
  y -= 10;
  rule(y, 1.6, INK);
  y -= 18;
  if (showMoney) {
    text('Labor and per diem on this sheet', MARGIN, y, 9.5, reg, GREY);
    right(money(p.labor_amount + p.per_diem_amount), MARGIN + CONTENT, y, 9.5);
    y -= 16;
    if (Math.abs(other) > 0.005) {
      // Parts, an adjustment, a bid item on an hourly job. It is on the invoice
      // and it is not anybody's hours, so it is named rather than left as the
      // gap between two numbers that do not match.
      text('Parts, materials and adjustments on the invoice', MARGIN, y, 9.5, reg, GREY);
      right(money(other), MARGIN + CONTENT, y, 9.5);
      y -= 16;
    }
  } else {
    text('Billed as a bid amount, not off these hours. The hours are here so the',
         MARGIN, y, 9, ital, GREY);
    y -= 11;
    text('crew and the days behind the bid can be checked.', MARGIN, y, 9, ital, GREY);
    y -= 18;
    // Per diem is billed on a bid job the same as on an hourly one, so it is a
    // real line on the invoice and belongs on the sheet that explains it.
    if (Number(p.per_diem_amount) > 0) {
      text(`Per diem on the invoice \u2014 ${num(p.per_diem_person_days)} man-days`, MARGIN, y, 9.5, reg, GREY);
      right(money(p.per_diem_amount), MARGIN + CONTENT, y, 9.5);
      y -= 16;
    }
  }
  y -= 16;
  page.drawRectangle({ x: MARGIN + CONTENT - 250, y: y - 14, width: 250, height: 30, color: SOFT });
  page.drawLine({ start: { x: MARGIN + CONTENT - 250, y: y + 16 },
                  end: { x: MARGIN + CONTENT, y: y + 16 }, thickness: 1.6, color: INK });
  text(p.invoice_no ? `Invoice #${p.invoice_no} total` : 'Invoice total',
       MARGIN + CONTENT - 240, y, 11, bold);
  right(money(p.invoice_total), MARGIN + CONTENT - 10, y, 13, bold, ACCENT);

  // ---- footer, on every page ----
  // Attached to an invoice, this sheet gets printed, split and passed around, so
  // each page has to say on its own what it belongs to.
  const stamp = `${p.job_name} \u00B7 week of ${usDate(p.week_start)} to ${usDate(p.week_end)}`
    + (p.invoice_no ? ` \u00B7 invoice #${p.invoice_no}` : '');
  pages.forEach((pg, i) => {
    pg.drawLine({ start: { x: MARGIN, y: FOOT - 8 }, end: { x: MARGIN + CONTENT, y: FOOT - 8 },
                  thickness: 1, color: LINE });
    const s = wa(fit(stamp, CONTENT - 90, 7.5));
    pg.drawText(s, { x: MARGIN, y: FOOT - 20, size: 7.5, font: reg, color: GREY });
    const n = wa(`Page ${i + 1} of ${pages.length}`);
    pg.drawText(n, { x: MARGIN + CONTENT - reg.widthOfTextAtSize(n, 7.5), y: FOOT - 20,
                     size: 7.5, font: reg, color: GREY });
    const q = wa('Questions on these hours, contact the office.');
    pg.drawText(q, { x: MARGIN, y: FOOT - 31, size: 7.5, font: reg, color: GREY });
  });

  return await doc.save();
}
