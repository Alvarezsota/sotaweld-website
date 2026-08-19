// Weekly summary — what each job invoices, what each welder and helper gets paid.
//
// Everything on this page comes from get_week_summary(), one round trip. The math
// lives in Postgres views so this file only lays it out. Two rules worth knowing
// while reading the numbers:
//
//   Per diem is PAID once per person per day, but BILLED once per job per day.
//   A welder who splits a day across two jobs collects one per diem; both
//   customers are charged one. That spread is yours.
//
//   Yard and shop hours bill to the customer only when that job is hourly.
//   Lump sum work stays on its own invoice and bills off the bid line items,
//   but its labor cost still lands on that job so margin stays honest.

let currentUser = null;
let weekStart = getMonday(new Date());
let currentTab = 'jobs';
let weekData = null;
let openRow = null;      // job_id / welder_id / helper_id whose detail is expanded
let bidCache = {};       // job_id -> bid status from get_job_bid_status
let editing = false;     // blocks live refresh mid-edit
let companyName = 'State of the Arc Welding & Services LLC';

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
function escAttr(str) { return esc(str).replace(/"/g, '&quot;'); }
function money(n) {
  const v = Number(n || 0);
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function money0(n) {
  const v = Math.round(Number(n) || 0);
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString();
}
function num(n) {
  const v = Number(n || 0);
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}
function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date;
}
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function formatWeekLabel(start) {
  const end = addDays(start, 6);
  const opts = { month: 'short', day: 'numeric' };
  return `Work week ${start.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, opts)}`;
}
function dayLabel(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'numeric', day: 'numeric' });
}

async function requireAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return null; }
  return session.user;
}

// ---------- load ----------

async function loadWeek() {
  const start = ymd(weekStart);
  document.getElementById('weekLabel').textContent = formatWeekLabel(weekStart);

  const { data, error } = await sb.rpc('get_week_summary', { p_week: start });
  if (error) {
    document.getElementById('sumBody').innerHTML =
      `<div class="card">Could not load this week: ${esc(error.message)}</div>`;
    return;
  }
  weekData = data;
  bidCache = {};
  loadCompanyName();
  renderWarnings();
  renderKpis();
  render();
}

// ---------- warnings ----------

function renderWarnings() {
  const box = document.getElementById('warnBox');
  const dups = (weekData.warnings && weekData.warnings.duplicate_tickets) || [];
  if (!dups.length) { box.innerHTML = ''; return; }

  const rows = dups.map(d => {
    const hrs = (d.hours_each || []).join(' + ');
    const descs = (d.descriptions || []).map(x => esc(x)).join(' &nbsp;|&nbsp; ');
    return `<div class="sum-warn-row">
      <b>${esc(d.welder_name)}</b> &middot; ${esc(dayLabel(d.entry_date))} &middot; ${esc(d.job_name || '—')}
      &mdash; ${d.ticket_count} tickets, ${hrs} = <b>${num(d.total_hours)} hrs</b>
      <div class="muted">${descs}</div>
    </div>`;
  }).join('');

  box.innerHTML = `<div class="sum-warn">
    <h3>Check before you invoice</h3>
    <div class="muted" style="margin-bottom:8px;">
      More than one ticket for the same welder, same job, same day. Sometimes that's two real
      scopes; sometimes it's a double submit. Per diem is already counted once either way —
      it's the <b>hours</b> that double up. Fix on the Approvals page.
    </div>
    ${rows}
  </div>`;
}

// ---------- KPIs ----------

function renderKpis() {
  const t = weekData.totals || {};
  const crew = [...(weekData.welders || []), ...(weekData.helpers || [])];
  const paidOut = crew.reduce((a, r) => a + Number(r.total_paid || 0), 0);
  const margin = Number(t.total_billed || 0) - paidOut;
  const mCls = margin >= 0 ? 'good' : 'bad';

  document.getElementById('kpiRow').innerHTML = [
    ['Jobs this week', String(t.jobs || 0), ''],
    ['Hours logged', num(t.total_hours), ''],
    ['Billed out', money0(t.total_billed), 'acc'],
    ['Paid to crew', money0(paidOut), ''],
    ['Gross margin', money0(margin), mCls],
  ].map(([k, v, cls]) =>
    `<div class="sum-kpi"><div class="k">${esc(k)}</div><div class="v ${cls}">${esc(v)}</div></div>`
  ).join('');
}

// ---------- render dispatch ----------

function render() {
  if (currentTab === 'jobs') renderJobs();
  else renderCrew(currentTab);
}

// ---------- jobs / invoices ----------

function renderJobs() {
  const jobs = weekData.jobs || [];
  if (!jobs.length) {
    document.getElementById('sumBody').innerHTML =
      `<p class="empty-state2">No work logged for this week yet.</p>`;
    return;
  }

  const tot = jobs.reduce((a, j) => ({
    hours: a.hours + Number(j.total_hours || 0),
    billed: a.billed + Number(j.total_billed || 0),
    paid: a.paid + Number(j.total_paid || 0),
    margin: a.margin + Number(j.margin || 0),
  }), { hours: 0, billed: 0, paid: 0, margin: 0 });

  const rows = jobs.map(j => {
    const stCls = j.status === 'synced' ? 'st-synced' : j.status === 'approved' ? 'st-approved' : 'st-open';
    const mCls = Number(j.margin) >= 0 ? 'sum-pos' : 'sum-neg';
    const flat = j.billing_type === 'flat';
    const needsBid = flat && Number(j.total_billed) === 0;
    const open = openRow === j.job_id;

    const sub = [
      j.bill_to ? 'bill to ' + esc(j.bill_to) : null,
      j.bid_number ? 'Bid #' + esc(j.bid_number) : null,
      flat ? 'lump sum' : 'hourly',
      needsBid ? '<span style="color:#f5c451">needs bid amount</span>' : null,
    ].filter(Boolean).join(' &middot; ');

    return `<tr class="clickable" data-job="${escAttr(j.job_id)}">
        <td class="l"><div class="sum-name">${esc(j.job_name)}</div><div class="sum-sub">${sub}</div></td>
        <td><span class="pill ${stCls}">${esc(j.status)}</span></td>
        <td class="hide-sm">${num(j.total_hours)}</td>
        <td class="hide-sm">${num(j.per_diem_days)}</td>
        <td>${money0(j.total_billed)}</td>
        <td class="hide-sm">${money0(j.total_paid)}</td>
        <td class="${mCls}">${money0(j.margin)}</td>
      </tr>
      ${open ? `<tr><td colspan="7" style="padding:0 6px;">${jobDetailHtml(j)}</td></tr>` : ''}`;
  }).join('');

  document.getElementById('sumBody').innerHTML = `
    <table class="sum-table">
      <thead><tr>
        <th class="l">Job</th><th>Status</th><th class="hide-sm">Hours</th>
        <th class="hide-sm">PD days</th><th>Billed</th><th class="hide-sm">Cost</th><th>Margin</th>
      </tr></thead>
      <tbody>
        ${rows}
        <tr class="tot">
          <td class="l">${jobs.length} job${jobs.length === 1 ? '' : 's'}</td><td></td>
          <td class="hide-sm">${num(tot.hours)}</td><td class="hide-sm"></td>
          <td>${money0(tot.billed)}</td><td class="hide-sm">${money0(tot.paid)}</td>
          <td class="${tot.margin >= 0 ? 'sum-pos' : 'sum-neg'}">${money0(tot.margin)}</td>
        </tr>
      </tbody>
    </table>
    <p class="sum-note">
      Click a job to see the daily detail and print its invoice. &ldquo;Cost&rdquo; is hourly pay plus
      per diem for the crew on that job &mdash; on a lump sum job that includes yard and shop hours worked
      for it, so the margin reflects what the bid actually cost you.
    </p>`;

  document.querySelectorAll('tr[data-job]').forEach(tr => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('button, input, a')) return;
      const id = tr.getAttribute('data-job');
      openRow = openRow === id ? null : id;
      render();
      if (openRow) loadBidStatus(openRow);
    });
  });

  wireJobDetail();
}

/** Bid / quote number. Optional on any job, hourly or lump sum — it prints on the invoice. */
function bidNumberHtml(j) {
  return `<div class="bid-num-row" style="margin:2px 0 14px;">
    <div class="fieldwrap"><span class="bid-lbl">Bid / quote number</span>
      <input class="bid-input" id="bidNum-${escAttr(j.job_id)}" style="width:200px"
             value="${j.bid_number ? escAttr(j.bid_number) : ''}" placeholder="e.g. SOTA-2026-0142"></div>
    <button class="btn2 btn2-line small" id="bidNumSave-${escAttr(j.job_id)}">Save</button>
    <span id="bidNumMsg-${escAttr(j.job_id)}"></span>
  </div>`;
}

function jobDetailHtml(j) {
  const flat = j.billing_type === 'flat';
  const lines = j.detail || [];
  const onInv = lines.filter(l => l.on_invoice !== false);
  const tracked = lines.filter(l => l.on_invoice === false);

  return `<div class="sum-detail" style="padding:12px;">
    <div class="sum-actions">
      <button class="btn2 btn2-line small" data-print="${escAttr(j.job_id)}">Print invoice</button>
      <button class="btn2 btn2-ghost small" data-print-int="${escAttr(j.job_id)}">Print with cost &amp; margin</button>
      <a class="btn2 btn2-ghost small" href="approvals.html">Edit tickets</a>
    </div>
    ${bidNumberHtml(j)}
    ${flat ? `<div id="bidBox-${escAttr(j.job_id)}" class="bid-box">Loading bid&hellip;</div>` : ''}
    ${dayTableHtml(onInv, !flat, 'On this invoice')}
    ${tracked.length ? dayTableHtml(tracked, false, 'Worked on this job — billed on the bid, not by the hour') : ''}
  </div>`;
}

function dayTableHtml(lines, showRate, heading) {
  if (!lines.length) return '';
  const byDay = {};
  lines.forEach(l => { (byDay[l.date] = byDay[l.date] || []).push(l); });

  const blocks = Object.keys(byDay).sort().map(date => {
    const ls = byDay[date];
    const hrs = ls.reduce((a, l) => a + Number(l.hours || 0), 0);
    const pd = ls.filter(l => l.per_diem).reduce((a, l) => a + Number(l.per_diem_rate || 0), 0);
    const amt = ls.reduce((a, l) => a + Number(l.billed || 0), 0);
    const rows = ls.map(l => `<tr>
        <td class="l">${esc(l.name)} <span class="role-tag2">${esc(l.kind)}</span>
          ${l.bid_item ? `<div class="d-bid">${esc(l.bid_item)}</div>` : ''}
          ${l.description ? `<div class="d-desc">${esc(String(l.description).slice(0, 90))}</div>` : ''}</td>
        <td>${num(l.hours)}</td>
        ${showRate ? `<td>${money0(l.bill_rate)}</td>` : ''}
        <td>${l.per_diem ? money0(l.per_diem_rate) : '—'}</td>
        ${showRate ? `<td>${money0(Number(l.billed) + (l.per_diem ? Number(l.per_diem_rate) : 0))}</td>` : ''}
      </tr>`).join('');
    return `<tr><td class="l" colspan="${showRate ? 5 : 3}" style="padding-top:12px;">
        <b>${esc(dayLabel(date))}</b> &middot; ${num(hrs)} hrs${pd ? ' &middot; ' + money0(pd) + ' per diem' : ''}${showRate ? ' &middot; ' + money0(amt + pd) : ''}
      </td></tr>${rows}`;
  }).join('');

  return `<h4 style="margin:14px 0 6px;font-family:Oswald,sans-serif;font-size:13px;color:#8b939f;
      letter-spacing:.05em;text-transform:uppercase;">${esc(heading)}</h4>
    <table><thead><tr>
      <th class="l">Crew</th><th>Hrs</th>${showRate ? '<th>Rate</th>' : ''}<th>Per diem</th>${showRate ? '<th>Amount</th>' : ''}
    </tr></thead><tbody>${blocks}</tbody></table>`;
}

function wireJobDetail() {
  (weekData.jobs || []).forEach(j => wireBidNumber(j.job_id));
  document.querySelectorAll('[data-print]').forEach(b =>
    b.addEventListener('click', () => printInvoice(b.getAttribute('data-print'), false)));
  document.querySelectorAll('[data-print-int]').forEach(b =>
    b.addEventListener('click', () => printInvoice(b.getAttribute('data-print-int'), true)));
}

function wireBidNumber(jobId) {
  const input = document.getElementById('bidNum-' + jobId);
  const btn = document.getElementById('bidNumSave-' + jobId);
  if (!input || !btn) return;
  input.addEventListener('focus', () => { editing = true; });
  input.addEventListener('blur', () => { setTimeout(() => { editing = false; }, 400); });
  btn.addEventListener('click', async () => {
    const msg = document.getElementById('bidNumMsg-' + jobId);
    msg.className = 'sum-saving'; msg.textContent = 'Saving...';
    const { error } = await sb.rpc('set_job_bid_number', {
      p_job: jobId, p_bid_number: input.value.trim(), p_bid_date: null
    });
    if (error) { msg.className = 'error-msg2'; msg.textContent = error.message; return; }
    msg.className = 'sum-saved'; msg.textContent = 'Saved';
    await loadWeek();
    if (openRow) loadBidStatus(openRow);
  });
}

// ---------- printable invoice ----------

async function printInvoice(jobId, internal) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { alert('Your session expired. Please log in again.'); return; }

  const url = `${SUPABASE_URL}/functions/v1/week-invoice?job_id=${encodeURIComponent(jobId)}`
            + `&week_start=${ymd(weekStart)}${internal ? '&internal=1' : ''}`;

  const win = window.open('', '_blank');
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${session.access_token}` } });
    const html = await res.text();
    if (!res.ok) throw new Error(html || res.statusText);
    if (win) { win.document.open(); win.document.write(html); win.document.close(); }
  } catch (err) {
    if (win) win.close();
    alert('Could not build that invoice: ' + err.message);
  }
}

// ---------- printable crew summary ----------

async function loadCompanyName() {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'company_name').maybeSingle();
  if (data && data.value) companyName = data.value;
}

/** Builds a clean, light, printable page for the welder or helper summary and
 *  sends it straight to the print dialog — "Save as PDF" from there. */
function printCrew(kind) {
  const rows = (kind === 'welders' ? weekData.welders : weekData.helpers) || [];
  if (!rows.length) { alert('Nothing to print for this week.'); return; }

  const nameKey = kind === 'welders' ? 'welder_name' : 'helper_name';
  const label = kind === 'welders' ? 'Welders' : 'Helpers';

  const t = rows.reduce((a, r) => ({
    hours: a.hours + Number(r.total_hours || 0),
    hp: a.hp + Number(r.hours_paid || 0),
    pdd: a.pdd + Number(r.per_diem_days || 0),
    pda: a.pda + Number(r.per_diem_amount || 0),
    paid: a.paid + Number(r.total_paid || 0),
    billed: a.billed + Number(r.total_billed || 0),
  }), { hours: 0, hp: 0, pdd: 0, pda: 0, paid: 0, billed: 0 });

  const dayRows = (r) => (r.detail || []).map(l => `<tr>
      <td class="l" style="width:70px"><b>${esc(dayLabel(l.date))}</b></td>
      <td class="l">${esc(l.job || '—')}${
        l.bid_item ? `<div class="d"><b>${esc(l.bid_item)}</b></div>` : ''
      }${l.bills_to && l.bills_to !== l.job ? `<div class="d">bills to ${esc(l.bills_to)}</div>` : ''
      }${l.description ? `<div class="d">${esc(String(l.description).slice(0, 90))}</div>` : ''}</td>
      <td style="width:52px">${num(l.hours)}</td>
      <td style="width:70px">${l.per_diem ? money(l.per_diem_rate) : '—'}</td>
      <td style="width:82px">${money(l.paid)}</td>
    </tr>`).join('');

  const body = rows.map(r => {
    const split = Number(r.per_diem_charges) > Number(r.per_diem_days);
    const days = dayRows(r);
    return `<tr class="p">
        <td class="l name">${esc(r[nameKey])}</td>
        <td>${num(r.days_worked)}</td>
        <td>${num(r.total_hours)}</td>
        <td>${money(r.hours_paid)}</td>
        <td>${num(r.per_diem_days)}</td>
        <td>${money(r.per_diem_amount)}</td>
        <td><b>${money(r.total_paid)}</b></td>
        <td>${money(r.total_billed)}${split
          ? `<div class="d">incl. ${num(r.per_diem_charges)} PD charges</div>` : ''}</td>
      </tr>
      ${days ? `<tr><td colspan="8" style="padding:0 8px;border:none">
        <div class="days"><table>
          <tr><th class="l">Day</th><th class="l">Job</th><th>Hrs</th><th>Per diem</th><th>Pay</th></tr>
          ${days}
        </table></div></td></tr>` : ''}`;
  }).join('');

  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(label)} — ${esc(formatWeekLabel(weekStart))}</title>
<style>
  body{margin:0;background:#faf9f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1c1917;font-size:13px;line-height:1.5;}
  .wrap{max-width:900px;margin:0 auto;padding:22px 16px 40px;}
  .card{background:#fff;border:1px solid #e7e5e4;border-radius:10px;overflow:hidden;}
  .hd{background:#1c1917;color:#fff;padding:16px 20px;}
  .hd h1{margin:0;font-size:16px;letter-spacing:.03em;text-transform:uppercase;}
  .hd .sub{margin-top:4px;font-size:12.5px;color:#d6d3d1;}
  .sec{padding:8px 20px 20px;}
  h2{font-size:11.5px;text-transform:uppercase;letter-spacing:.09em;color:#B4541E;margin:18px 0 8px;}
  table{width:100%;border-collapse:collapse;}
  th{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#78716c;text-align:right;padding:6px 8px;border-bottom:1.5px solid #e7e5e4;font-weight:600;}
  th.l,td.l{text-align:left;}
  td{padding:7px 8px;border-bottom:1px solid #e7e5e4;text-align:right;font-variant-numeric:tabular-nums;}
  tr.tot td{border-top:2px solid #1c1917;border-bottom:none;font-weight:700;background:#fafaf9;}
  .name{font-weight:600;}
  .d{color:#78716c;font-size:11px;font-weight:400;}
  .days{margin:2px 0 12px;padding:6px 10px;background:#faf9f7;border:1px solid #e7e5e4;border-radius:6px;}
  .days table{font-size:11.5px;}
  .days td,.days th{padding:4px 6px;border:none;}
  .days td{border-bottom:1px dotted #e7e5e4;}
  .kpis{display:table;width:100%;border-spacing:8px 0;margin:6px 0;}
  .kpi{display:table-cell;width:25%;background:#faf9f7;border:1px solid #e7e5e4;border-radius:8px;padding:9px 12px;}
  .kpi .k{font-size:9.5px;text-transform:uppercase;letter-spacing:.07em;color:#78716c;}
  .kpi .v{font-size:18px;font-weight:700;margin-top:2px;font-variant-numeric:tabular-nums;}
  .kpi .v.acc{color:#B4541E;}
  .note{font-size:11px;color:#78716c;margin-top:10px;}
  @media print{body{background:#fff}.wrap{max-width:none;padding:0}.card{border:none}tr.p{break-inside:avoid}}
</style></head><body><div class="wrap"><div class="card">
<div class="hd"><h1>${esc(companyName)}</h1>
<div class="sub">${esc(label)} summary &middot; ${esc(formatWeekLabel(weekStart))}</div></div>
<div class="sec">
  <div class="kpis">
    <div class="kpi"><div class="k">People</div><div class="v">${rows.length}</div></div>
    <div class="kpi"><div class="k">Total hours</div><div class="v">${num(t.hours)}</div></div>
    <div class="kpi"><div class="k">Total paid out</div><div class="v acc">${money(t.paid)}</div></div>
    <div class="kpi"><div class="k">Total billed</div><div class="v">${money(t.billed)}</div></div>
  </div>
  <h2>${esc(label)}</h2>
  <table>
    <tr><th class="l">Name</th><th>Days</th><th>Hours</th><th>Hourly pay</th>
        <th>PD days</th><th>Per diem</th><th>Total paid</th><th>Billed</th></tr>
    ${body}
    <tr class="tot"><td class="l">${rows.length} ${rows.length === 1 ? 'person' : 'people'}</td>
      <td></td><td>${num(t.hours)}</td><td>${money(t.hp)}</td>
      <td>${num(t.pdd)}</td><td>${money(t.pda)}</td>
      <td>${money(t.paid)}</td><td>${money(t.billed)}</td></tr>
  </table>
  <p class="note">Per diem is counted once per person per day, no matter how many jobs he touched.
  &ldquo;Billed&rdquo; is what the customer is invoiced for that person&rsquo;s hours; each job he
  worked that day is charged its own per diem, so Billed can carry more per diem than he is paid.</p>
</div></div></div>
<script>window.onload = function () { window.print(); };<\/script>
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) { alert('Your browser blocked the print window. Allow pop-ups for sotaweld.com and try again.'); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

// ---------- lump sum bid editor ----------

async function loadBidStatus(jobId) {
  const job = (weekData.jobs || []).find(j => j.job_id === jobId);
  if (!job || job.billing_type !== 'flat') return;

  const { data, error } = await sb.rpc('get_job_bid_status', { p_job: jobId });
  if (error) { bidCache[jobId] = { error: error.message }; }
  else { bidCache[jobId] = data; }
  renderBidBox(jobId);
}

function renderBidBox(jobId) {
  const el = document.getElementById('bidBox-' + jobId);
  if (!el) return;
  const job = (weekData.jobs || []).find(j => j.job_id === jobId);
  const status = bidCache[jobId];
  if (!status) { el.innerHTML = 'Loading bid&hellip;'; return; }
  if (status.error) { el.innerHTML = `<h4>Bid</h4><div class="empty-state2">${esc(status.error)}</div>`; return; }

  // qty completed THIS week, keyed by bid item
  const thisWeek = {};
  (job.bid_detail || []).forEach(b => { thisWeek[b.bid_item_id] = b.qty_completed; });

  const items = status.items || [];
  const rows = items.map(it => {
    const done = Number(it.qty_done || 0);
    const bidQty = Number(it.qty_bid || 0);
    const left = bidQty - done;
    const cls = left === 0 ? 'done' : left < 0 ? 'over' : '';
    return `<div class="bid-row" data-item="${escAttr(it.bid_item_id)}">
      <div>
        <div class="sum-name">${esc(it.description)}</div>
        <div class="sum-sub">${num(bidQty)} ${esc(it.unit)} bid @ ${money0(it.unit_price)} = ${money0(it.line_value)}</div>
      </div>
      <div><div class="bid-lbl">This week</div>
        <input class="bid-input bid-qty" type="number" step="any" min="0"
               value="${thisWeek[it.bid_item_id] != null ? escAttr(thisWeek[it.bid_item_id]) : ''}"
               placeholder="0"></div>
      <div><div class="bid-lbl">Done to date</div><input class="bid-input" value="${num(done)}" readonly></div>
      <div><div class="bid-lbl">Billed to date</div><input class="bid-input" value="${money0(it.billed_to_date)}" readonly></div>
      <div class="bid-remaining ${cls}">${left === 0 ? 'complete' : left < 0 ? num(-left) + ' over bid' : num(left) + ' ' + esc(it.unit) + ' left'}</div>
      <div><button class="btn2 btn2-ghost small bid-save" title="Save this line">Save</button></div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <h4>Lump sum &mdash; bid line items</h4>
    ${items.length ? rows : `<div class="empty-state2" style="margin-bottom:10px;">
      No bid line items yet. Add what you bid &mdash; description, how many, price each &mdash;
      then enter how many got finished each week and that's the invoice.</div>`}
    <div class="bid-row" style="margin-top:12px;">
      <div><div class="bid-lbl">New line item</div>
        <input class="bid-input" id="niDesc-${escAttr(jobId)}" placeholder="Control panel enclosure EP3"></div>
      <div><div class="bid-lbl">Qty bid</div><input class="bid-input" id="niQty-${escAttr(jobId)}" type="number" step="any" placeholder="12"></div>
      <div><div class="bid-lbl">Unit</div><input class="bid-input" id="niUnit-${escAttr(jobId)}" value="ea"></div>
      <div><div class="bid-lbl">Price each</div><input class="bid-input" id="niPrice-${escAttr(jobId)}" type="number" step="any" placeholder="850"></div>
      <div></div>
      <div><button class="btn2 btn2-solid small" id="niAdd-${escAttr(jobId)}">Add</button></div>
    </div>
    <div class="bid-total">
      <span>Contract total ${money0(status.contract_value)} &middot; billed to date ${money0(status.billed_to_date)}</span>
      <span>This week: ${money0(job.bid_amount)}</span>
    </div>`;

  wireBidBox(jobId);
}

function wireBidBox(jobId) {
  const el = document.getElementById('bidBox-' + jobId);
  if (!el) return;

  el.querySelectorAll('.bid-input').forEach(inp => {
    inp.addEventListener('focus', () => { editing = true; });
    inp.addEventListener('blur', () => { setTimeout(() => { editing = false; }, 400); });
  });

  el.querySelectorAll('.bid-row[data-item]').forEach(row => {
    const btn = row.querySelector('.bid-save');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const itemId = row.getAttribute('data-item');
      const qty = Number(row.querySelector('.bid-qty').value || 0);
      btn.disabled = true; btn.textContent = 'Saving';
      const { error } = await sb.rpc('set_bid_progress', {
        p_item: itemId, p_week: ymd(weekStart), p_qty: qty, p_note: null
      });
      btn.disabled = false; btn.textContent = error ? 'Retry' : 'Saved';
      if (error) { alert('Could not save: ' + error.message); return; }
      await loadWeek();
      if (openRow) await loadBidStatus(openRow);
    });
  });

  const addBtn = document.getElementById('niAdd-' + jobId);
  if (addBtn) addBtn.addEventListener('click', async () => {
    const desc = document.getElementById('niDesc-' + jobId).value.trim();
    const qty = Number(document.getElementById('niQty-' + jobId).value || 0);
    const unit = document.getElementById('niUnit-' + jobId).value.trim() || 'ea';
    const price = Number(document.getElementById('niPrice-' + jobId).value || 0);
    if (!desc) { alert('Give the line item a description.'); return; }
    addBtn.disabled = true; addBtn.textContent = 'Adding';
    const { error } = await sb.rpc('upsert_bid_item', {
      p_job: jobId, p_description: desc, p_qty: qty,
      p_unit_price: price, p_unit: unit, p_sort: 0, p_item: null
    });
    addBtn.disabled = false; addBtn.textContent = 'Add';
    if (error) { alert('Could not add: ' + error.message); return; }
    await loadBidStatus(jobId);
  });
}

// ---------- welders / helpers ----------

function renderCrew(kind) {
  const rows = (kind === 'welders' ? weekData.welders : weekData.helpers) || [];
  const idKey = kind === 'welders' ? 'welder_id' : 'helper_id';
  const nameKey = kind === 'welders' ? 'welder_name' : 'helper_name';

  if (!rows.length) {
    document.getElementById('sumBody').innerHTML =
      `<p class="empty-state2">No ${kind} logged this week.</p>`;
    return;
  }

  const t = rows.reduce((a, r) => ({
    hours: a.hours + Number(r.total_hours || 0),
    hp: a.hp + Number(r.hours_paid || 0),
    pdd: a.pdd + Number(r.per_diem_days || 0),
    pda: a.pda + Number(r.per_diem_amount || 0),
    paid: a.paid + Number(r.total_paid || 0),
    billed: a.billed + Number(r.total_billed || 0),
  }), { hours: 0, hp: 0, pdd: 0, pda: 0, paid: 0, billed: 0 });

  const body = rows.map(r => {
    const id = r[idKey];
    const open = openRow === id;
    const split = Number(r.per_diem_charges) > Number(r.per_diem_days);
    return `<tr class="clickable" data-person="${escAttr(id)}">
        <td class="l"><div class="sum-name">${esc(r[nameKey])}</div>
          <div class="sum-sub">${num(r.jobs_worked)} job${Number(r.jobs_worked) === 1 ? '' : 's'}</div></td>
        <td>${num(r.days_worked)}</td>
        <td>${num(r.total_hours)}</td>
        <td class="hide-sm">${money0(r.hours_paid)}</td>
        <td>${num(r.per_diem_days)}</td>
        <td>${money0(r.per_diem_amount)}</td>
        <td><b>${money(r.total_paid)}</b></td>
        <td class="hide-sm">${money0(r.total_billed)}${split
          ? `<div class="sum-sub" title="Split days: he collects one per diem, each job is charged one">
               incl. ${num(r.per_diem_charges)} PD charges</div>` : ''}</td>
      </tr>
      ${open ? `<tr><td colspan="8" style="padding:0 6px;">${personDetailHtml(r)}</td></tr>` : ''}`;
  }).join('');

  document.getElementById('sumBody').innerHTML = `
    <div class="sum-print-bar">
      <button class="btn2 btn2-line small" data-print-crew="${kind}">
        Print ${kind === 'welders' ? 'welder' : 'helper'} summary
      </button>
    </div>
    <table class="sum-table">
      <thead><tr>
        <th class="l">Name</th><th>Days</th><th>Hours</th><th class="hide-sm">Hourly pay</th>
        <th>PD days</th><th>Per diem</th><th>Total paid</th><th class="hide-sm">Billed</th>
      </tr></thead>
      <tbody>
        ${body}
        <tr class="tot">
          <td class="l">${rows.length} ${rows.length === 1 ? 'person' : 'people'}</td>
          <td></td><td>${num(t.hours)}</td><td class="hide-sm">${money0(t.hp)}</td>
          <td>${num(t.pdd)}</td><td>${money0(t.pda)}</td>
          <td>${money(t.paid)}</td><td class="hide-sm">${money0(t.billed)}</td>
        </tr>
      </tbody>
    </table>
    <p class="sum-note">
      &ldquo;PD days&rdquo; and &ldquo;Per diem&rdquo; are what the man actually gets &mdash; one per day,
      no matter how many jobs he touched. When those two differ, the extra shows under Billed:
      each job he worked that day is charged its own per diem.
    </p>`;

  document.querySelectorAll('[data-print-crew]').forEach(b =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      printCrew(b.getAttribute('data-print-crew'));
    }));

  document.querySelectorAll('tr[data-person]').forEach(tr => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('button, input, a')) return;
      const id = tr.getAttribute('data-person');
      openRow = openRow === id ? null : id;
      render();
    });
  });
}

function personDetailHtml(r) {
  const lines = r.detail || [];
  if (!lines.length) return '';
  const rows = lines.map(l => `<tr>
      <td class="l" style="width:110px;"><b>${esc(dayLabel(l.date))}</b></td>
      <td class="l">${esc(l.job || '—')}
        ${l.bid_item ? `<div class="d-bid">${esc(l.bid_item)}</div>` : ''}
        ${l.bills_to && l.bills_to !== l.job ? `<div class="d-desc">bills to ${esc(l.bills_to)}</div>` : ''}
        ${l.description ? `<div class="d-desc">${esc(String(l.description).slice(0, 90))}</div>` : ''}</td>
      <td style="width:60px;">${num(l.hours)}</td>
      <td style="width:80px;">${l.per_diem ? money0(l.per_diem_rate) : '—'}</td>
      <td style="width:90px;">${money0(l.paid)}</td>
    </tr>`).join('');
  return `<div class="sum-detail" style="padding:10px 12px;">
    <table><thead><tr>
      <th class="l">Day</th><th class="l">Job</th><th>Hrs</th><th>Per diem</th><th>Pay</th>
    </tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ---------- wiring ----------

document.getElementById('prevWeekBtn').addEventListener('click', () => {
  weekStart = addDays(weekStart, -7); openRow = null; loadWeek();
});
document.getElementById('nextWeekBtn').addEventListener('click', () => {
  weekStart = addDays(weekStart, 7); openRow = null; loadWeek();
});
document.getElementById('sumTabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.sum-tab');
  if (!btn) return;
  document.querySelectorAll('.sum-tab').forEach(b => b.classList.toggle('on', b === btn));
  currentTab = btn.getAttribute('data-tab');
  openRow = null;
  render();
});

(async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  const { data: profile } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();

  if (!profile || profile.role !== 'admin') {
    document.getElementById('notAdminMsg').style.display = 'block';
    document.getElementById('userName').textContent = profile ? profile.full_name : currentUser.email;
    return;
  }

  document.getElementById('userName').textContent = profile.full_name;
  document.getElementById('adminContent').style.display = 'block';

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await sb.auth.signOut();
    window.location.href = 'login.html';
  });

  await loadWeek();

  await liveData({
    reload: loadWeek,
    isBusy: () => editing,
    tables: ['daily_entries', 'daily_entry_helpers', 'daily_entry_parts', 'job_weeks', 'job_week_bid_progress'],
    channel: 'summary'
  });
})();
