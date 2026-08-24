// Files a week's pay statements into OneDrive, one PDF per man.
//
// Reached two ways: the approval trigger posts here with the shared hook secret,
// and the Summary page's "File to OneDrive" button posts here with an admin's
// token. Both end up in the same place, because a week filed by hand and a week
// filed on approval should not be two different things.
//
// ---------------------------------------------------------------------------
// WHY THE PDF IS DRAWN HERE INSTEAD OF PRINTED
// ---------------------------------------------------------------------------
//
// The statement on screen is HTML and becomes a PDF through the browser's print
// dialog, which needs a person to press Save. There is no browser here, so this
// draws the same statement directly. It is laid out to match: same letterhead,
// same day rows with per diem counted once per date, same totals, same check
// number and signature lines.
//
// The numbers are not recomputed. week_pay_statements() hands back exactly what
// the Summary page and the printed statement read, so there is no second opinion
// on what a man is owed.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LOGO_URL = 'https://sotaweld.com/employee/sota-logo.png';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sota-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// ---------- looks ----------
const INK = rgb(0.110, 0.094, 0.090);
const ACCENT = rgb(0.706, 0.329, 0.118);
const GREY = rgb(0.471, 0.443, 0.424);
const LINE = rgb(0.906, 0.898, 0.894);
const SOFT = rgb(0.980, 0.976, 0.969);

const PAGE_W = 612, PAGE_H = 792, MARGIN = 54;
const CONTENT = PAGE_W - MARGIN * 2;

const money = (n: unknown) => {
  const v = Number(n || 0);
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const num = (n: unknown) => {
  const v = Number(n || 0);
  return String(Math.round(v * 100) / 100);
};
const usDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${m}-${d}-${y}`;
};
const addDaysIso = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
};
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const dayLabel = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${DOW[dt.getUTCDay()]}, ${m}/${d}`;
};
const weekLabel = (start: string) => {
  const end = addDaysIso(start, 6);
  const [, sm, sd] = start.split('-').map(Number);
  const [, em, ed] = end.split('-').map(Number);
  return `Work week ${MON[sm - 1]} ${sd} – ${MON[em - 1]} ${ed}`;
};
const weekFolder = (start: string) =>
  `Week of ${usDate(start)} to ${usDate(addDaysIso(start, 6))}`;

// Windows and OneDrive both refuse these, and a rejected upload halfway through a
// week is worse than a slightly plainer filename.
const safeName = (s: string) => s.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();

// The standard PDF fonts write WinAnsi, and pdf-lib throws rather than skipping a
// character it cannot encode. Job descriptions come off a phone keyboard, so one
// stray glyph would otherwise take out a man's whole statement.
//
// WinAnsi is wider than ASCII and does carry the punctuation that actually turns
// up - the dashes, the curly quotes, the bullet - so those are kept as typed
// rather than beaten into hyphens. Only what genuinely has no encoding is folded,
// and anything left after that is dropped: a blank looks better than a box on a
// document somebody signs.
const WINANSI_EXTRA = '\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152'
                    + '\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161'
                    + '\u203A\u0153\u017E\u0178';
const wa = (v: unknown) => {
  const folded = String(v ?? '')
    .replace(/[\u00A0\u2007\u202F\u2009\u200A]/g, ' ')   // odd spaces -> a space
    .replace(/[\u2212\u2012\u2015]/g, '-')                 // minus and bar dashes -> hyphen
    .replace(/[\u2032]/g, "'").replace(/[\u2033]/g, '"')    // prime marks -> feet and inches
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, '');          // zero-width, invisible either way
  let out = '';
  for (const ch of folded) {
    const c = ch.codePointAt(0)!;
    if ((c >= 0x20 && c <= 0x7E) || (c >= 0xA0 && c <= 0xFF) || WINANSI_EXTRA.includes(ch)) out += ch;
  }
  return out;
};

type Person = Record<string, unknown> & { detail?: Record<string, unknown>[] };

async function buildStatement(
  person: Person, weekStart: string, company: Record<string, string>, logo: Uint8Array | null,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const text = (raw: string, x: number, yy: number, size: number, font = reg, color = INK) =>
    page.drawText(wa(raw), { x, y: yy, size, font, color });
  const right = (raw: string, xEnd: number, yy: number, size: number, font = reg, color = INK) => {
    const s = wa(raw);
    page.drawText(s, { x: xEnd - font.widthOfTextAtSize(s, size), y: yy, size, font, color });
  };
  const fit = (raw: string, width: number, size: number, font = reg) => {
    const s = wa(raw);
    if (font.widthOfTextAtSize(s, size) <= width) return s;
    let out = s;
    while (out.length > 1 && font.widthOfTextAtSize(out + '…', size) > width) out = out.slice(0, -1);
    return out + '…';
  };
  const rule = (yy: number, thickness = 1, color = LINE) =>
    page.drawLine({ start: { x: MARGIN, y: yy }, end: { x: MARGIN + CONTENT, y: yy }, thickness, color });

  // ---- letterhead ----
  let headTextX = MARGIN;
  if (logo) {
    try {
      const img = await doc.embedPng(logo);
      const w = 96, h = (img.height / img.width) * w;
      page.drawImage(img, { x: MARGIN, y: y - h + 6, width: w, height: h });
      headTextX = MARGIN + w + 16;
    } catch { /* the letterhead reads fine on text alone */ }
  }
  text((company.company_name || 'State of the Arc Welding & Services').toUpperCase(),
       headTextX, y - 14, 13, bold);
  const addr = [company.company_address, company.company_phone].filter(Boolean).join('  ·  ');
  if (addr) text(addr, headTextX, y - 28, 9, reg, GREY);
  y -= 46;
  rule(y, 2.5, INK);
  y -= 26;

  // ---- title ----
  text('CONTRACTOR PAY STATEMENT', MARGIN, y, 11.5, bold, ACCENT);
  right(weekLabel(weekStart), MARGIN + CONTENT, y, 10, reg, GREY);
  y -= 26;
  text(String(person.name || ''), MARGIN, y, 19, bold);
  y -= 15;
  const days = Number(person.days_worked || 0);
  text(`${person.kind === 'welder' ? 'Welder' : 'Helper'}  ·  ${num(days)} day${days === 1 ? '' : 's'} worked`,
       MARGIN, y, 9.5, reg, GREY);
  y -= 22;

  // ---- check # / pay date, filled in by hand ----
  page.drawRectangle({ x: MARGIN, y: y - 34, width: CONTENT, height: 40,
                       color: SOFT, borderColor: LINE, borderWidth: 1 });
  text('CHECK #', MARGIN + 12, y - 6, 8, bold, GREY);
  page.drawLine({ start: { x: MARGIN + 12, y: y - 24 }, end: { x: MARGIN + 150, y: y - 24 }, thickness: 0.8, color: LINE });
  text('PAY DATE', MARGIN + 190, y - 6, 8, bold, GREY);
  page.drawLine({ start: { x: MARGIN + 190, y: y - 24 }, end: { x: MARGIN + 328, y: y - 24 }, thickness: 0.8, color: LINE });
  y -= 52;

  // ---- day table ----
  const COLS = [62, 168, 44, 54, 64, 54, 58];               // = 504 = CONTENT
  const X: number[] = [];
  COLS.reduce((acc, w, i) => { X[i] = acc; return acc + w; }, MARGIN);
  const endOf = (i: number) => X[i] + COLS[i];
  const HEAD = ['Day', 'Job', 'Hours', 'Rate', 'Hourly pay', 'Per diem', 'Day total'];

  const header = () => {
    HEAD.forEach((h, i) => {
      if (i <= 1) text(h.toUpperCase(), X[i], y, 7.5, bold, GREY);
      else right(h.toUpperCase(), endOf(i) - 4, y, 7.5, bold, GREY);
    });
    y -= 6;
    rule(y, 1.2, INK);
    y -= 14;
  };
  header();

  // One row per DAY, not per ticket: a man who split a day across two jobs still
  // collects a single per diem, so counting it per date is what keeps the
  // statement from paying him twice for the same day.
  const byDate = new Map<string, Record<string, unknown>[]>();
  for (const l of (person.detail || [])) {
    const d = String(l.date);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(l);
  }
  const dates = [...byDate.keys()].sort();

  for (const date of dates) {
    const ls = byDate.get(date)!;
    const hrs = ls.reduce((a, l) => a + Number(l.hours || 0), 0);
    const hourly = ls.reduce((a, l) => a + Number(l.hours || 0) * Number(l.pay_rate || 0), 0);
    const pdLine = ls.find((l) => l.per_diem);
    const pd = pdLine ? Number(pdLine.per_diem_rate || 0) : 0;
    const rates = [...new Set(ls.map((l) => Number(l.pay_rate || 0)))];
    const rowH = 14 + (ls.length - 1) * 11;

    if (y - rowH < 140) {                       // leave room for the totals block
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
      header();
    }

    text(dayLabel(date), X[0], y, 9, bold);
    ls.forEach((l, i) => {
      const label = String(l.job || '—') + (ls.length > 1 ? `  (${num(l.hours)} hrs)` : '');
      text(fit(label, COLS[1] - 6, 8.5), X[1], y - i * 11, 8.5, reg, i === 0 ? INK : GREY);
    });
    right(num(hrs), endOf(2) - 4, y, 9);
    right(rates.length === 1 ? money(rates[0]) : '—', endOf(3) - 4, y, 9);
    right(money(hourly), endOf(4) - 4, y, 9);
    right(pd ? money(pd) : '—', endOf(5) - 4, y, 9);
    right(money(hourly + pd), endOf(6) - 4, y, 9, bold);
    y -= rowH;
    rule(y + 4);
  }
  if (!dates.length) { text('No days logged this week.', X[0], y, 9, reg, GREY); y -= 14; }

  // ---- totals ----
  y -= 4;
  rule(y, 1.6, INK);
  y -= 14;
  text('Totals', X[0], y, 9, bold);
  right(num(person.total_hours), endOf(2) - 4, y, 9, bold);
  right(money(person.hours_paid), endOf(4) - 4, y, 9, bold);
  right(money(person.per_diem_amount), endOf(5) - 4, y, 9, bold);
  right(money(person.total_paid), endOf(6) - 4, y, 9, bold);
  y -= 34;

  const bx = MARGIN + CONTENT - 250;
  const linePair = (label: string, value: string, big = false) => {
    text(label, bx + 10, y, big ? 11 : 9.5, big ? bold : reg, big ? INK : GREY);
    right(value, MARGIN + CONTENT - 10, y, big ? 13 : 9.5, big ? bold : reg, big ? ACCENT : INK);
    y -= big ? 0 : 16;
  };
  linePair('Hours worked', num(person.total_hours));
  linePair('Hourly pay', money(person.hours_paid));
  linePair(`Per diem — ${num(person.per_diem_days)} day${Number(person.per_diem_days) === 1 ? '' : 's'}`,
           money(person.per_diem_amount));
  y -= 4;
  page.drawRectangle({ x: bx, y: y - 12, width: 250, height: 30, color: SOFT });
  page.drawLine({ start: { x: bx, y: y + 18 }, end: { x: bx + 250, y: y + 18 }, thickness: 1.6, color: INK });
  linePair('Total due', money(person.total_paid), true);
  y -= 56;

  // ---- signatures ----
  const halfW = (CONTENT - 40) / 2;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + halfW, y }, thickness: 1, color: INK });
  page.drawLine({ start: { x: MARGIN + halfW + 40, y }, end: { x: MARGIN + CONTENT, y }, thickness: 1, color: INK });
  text('Received by', MARGIN, y - 11, 8, reg, GREY);
  text('Date', MARGIN + halfW + 40, y - 11, 8, reg, GREY);
  y -= 34;
  text('Paid as an independent contractor — no taxes withheld. Per diem is counted once per day worked.',
       MARGIN, y, 8, reg, GREY);
  text('Questions on this statement, contact the office.', MARGIN, y - 11, 8, reg, GREY);

  return await doc.save();
}

// ---------- Microsoft Graph ----------
async function freshToken(admin: ReturnType<typeof createClient>) {
  const { data: tok } = await admin.from('onedrive_tokens').select('*').eq('id', 1).maybeSingle();
  if (!tok) return { error: 'OneDrive is not connected. Connect it on the Setup page.' };
  if (new Date(tok.expires_at as string).getTime() > Date.now()) return { tok };

  const clientId = Deno.env.get('MS_CLIENT_ID');
  const clientSecret = Deno.env.get('MS_CLIENT_SECRET');
  if (!clientId || !clientSecret) return { error: 'MS_CLIENT_ID / MS_CLIENT_SECRET are not set.' };
  const tenant = Deno.env.get('MS_TENANT_ID') || 'organizations';

  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: tok.refresh_token as string, grant_type: 'refresh_token',
      scope: 'offline_access Files.ReadWrite User.Read',
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    return { error: 'OneDrive sign-in has expired. Reconnect it on the Setup page. (' + (j.error_description || res.status) + ')' };
  }
  const updated = {
    access_token: j.access_token as string,
    // Microsoft usually returns a fresh refresh token; keep the old one if not.
    refresh_token: (j.refresh_token as string) || (tok.refresh_token as string),
    expires_at: new Date(Date.now() + (Number(j.expires_in || 3600) - 60) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  await admin.from('onedrive_tokens').update(updated).eq('id', 1);
  return { tok: { ...tok, ...updated } };
}

async function ensureFolder(token: string, driveId: string, parentId: string, name: string) {
  const enc = encodeURIComponent(name);
  const look = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${parentId}:/${enc}`,
    { headers: { Authorization: `Bearer ${token}` } });
  if (look.ok) return ((await look.json()).id as string);

  const made = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${parentId}/children`,
    { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }) });
  if (made.ok) return ((await made.json()).id as string);

  // Someone else made it a moment ago; take theirs rather than fail the run.
  const again = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${parentId}:/${enc}`,
    { headers: { Authorization: `Bearer ${token}` } });
  if (again.ok) return ((await again.json()).id as string);
  throw new Error('Could not make the folder "' + name + '": ' + (await made.text()).slice(0, 200));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const body = await req.json().catch(() => ({}));
  const weekStart = String(body.week_start || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return json({ error: 'week_start must be YYYY-MM-DD' }, 400);

  // Two doors, one room. The trigger carries the shared secret; the Summary page
  // carries an admin's token. Anything else is turned away before a token is
  // touched, because past this point we are holding a key to the company drive.
  const secret = req.headers.get('x-sota-secret');
  let allowed = false;
  if (secret) {
    const { data: row } = await admin.from('app_settings').select('value').eq('key', 'summary_hook_secret').maybeSingle();
    allowed = !!row?.value && secret === row.value;
  } else {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (authHeader.startsWith('Bearer ')) {
      const caller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
      const { data: { user } } = await caller.auth.getUser();
      if (user) {
        const { data: p } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
        allowed = p?.role === 'admin';
      }
    }
  }
  if (!allowed) return json({ error: 'Not allowed' }, 403);

  const { tok, error: tokErr } = await freshToken(admin);
  if (tokErr || !tok) return json({ error: tokErr }, 400);
  const token = tok.access_token as string;
  const driveId = tok.drive_id as string;
  const rootId = tok.root_folder_id as string;
  if (!driveId || !rootId) return json({ error: 'The OneDrive connection has no drive or folder on it. Reconnect on Setup.' }, 400);

  const [{ data: people }, { data: settingRows }] = await Promise.all([
    admin.rpc('week_pay_statements', { p_week: weekStart }),
    admin.from('app_settings').select('key, value')
      .in('key', ['company_name', 'company_address', 'company_phone']),
  ]);
  const list = (people || []) as Person[];
  if (!list.length) return json({ ok: true, week_start: weekStart, filed: 0, note: 'Nobody worked that week.' });

  const company: Record<string, string> = {};
  (settingRows || []).forEach((r: { key: string; value: string }) => { company[r.key] = r.value; });

  let logo: Uint8Array | null = null;
  try {
    const r = await fetch(LOGO_URL);
    if (r.ok) logo = new Uint8Array(await r.arrayBuffer());
  } catch { /* letterhead reads fine on text alone */ }

  const folderName = weekFolder(weekStart);
  let folderId: string;
  try {
    folderId = await ensureFolder(token, driveId, rootId, folderName);
  } catch (err) {
    return json({ error: String((err as Error).message) }, 502);
  }

  const filed: string[] = [];
  const failed: { name: string; why: string }[] = [];
  const span = `${usDate(weekStart)} to ${usDate(addDaysIso(weekStart, 6))}`;

  for (const person of list) {
    // The role belongs in the name. A man can be on a week as both a welder and a
    // helper - Jayson Alvarez was, on 08-17 - and without it his two statements
    // are one filename, and the second lands on top of the first.
    const filename = safeName(`${person.name} (${person.kind}) - pay statement - ${span}`) + '.pdf';
    try {
      const pdf = await buildStatement(person, weekStart, company, logo);
      const put = await fetch(
        `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}:/${encodeURIComponent(filename)}:/content`
          + '?%40microsoft.graph.conflictBehavior=replace',
        { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/pdf' }, body: pdf });
      if (!put.ok) throw new Error((await put.text()).slice(0, 200));
      filed.push(filename);
    } catch (err) {
      failed.push({ name: String(person.name), why: String((err as Error).message).slice(0, 200) });
    }
  }

  await admin.from('onedrive_file_log').upsert({
    week_start: weekStart,
    folder: folderName,
    filed_count: filed.length,
    failed_count: failed.length,
    status: failed.length ? 'partial' : 'filed',
    detail: { filed, failed },
    filed_at: new Date().toISOString(),
  }, { onConflict: 'week_start' });

  return json({
    ok: failed.length === 0,
    week_start: weekStart, folder: folderName,
    filed: filed.length, failed: failed.length,
    failures: failed,
  }, failed.length ? 207 : 200);
});
