// Read-only weekly weld log for the welder who is signed in.
//
// Deliberately has no save, edit or delete path anywhere in this file - the only
// writes to weld_reports come from weld-report.html. RLS already limits a welder
// to his own rows (weld_reports_select: welder_id = auth.uid()), so this page
// cannot show another man's work even if the query were wrong.

let currentUser = null;
let weekStart = null;

const daysBody  = document.getElementById('daysBody');
const weekLabel = document.getElementById('weekLabel');
const weekTotal = document.getElementById('weekTotal');

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function getMonday(d) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;          // Mon = 0
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const num = (v) => Number(v) || 0;
const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });

const dayLabel = (d) =>
  d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

function weekLabelText(start) {
  const end = addDays(start, 6);
  const sameMonth = start.getMonth() === end.getMonth();
  const l = (d, withMonth) =>
    d.toLocaleDateString(undefined, withMonth ? { month: 'short', day: 'numeric' } : { day: 'numeric' });
  return `${l(start, true)} \u2013 ${l(end, !sameMonth)}, ${end.getFullYear()}`;
}

// A line credited from a partner rather than logged by this welder himself.
const isCredit = (b) => Boolean(b && b.fromWelderId);

function lineHtml(b) {
  const credited = isCredit(b);
  return `
    <div class="mwl-line${credited ? ' credited' : ''}">
      <span class="mwl-line-qty">${esc(b.qty ?? '')}&times;</span>
      <span class="mwl-line-label">${esc(b.label ?? '')}${
        credited ? '<span class="mwl-badge">credited to you</span>' : ''
      }</span>
      <span class="mwl-line-total">${fmt(num(b.total))}<span class="mwl-unit">in</span></span>
    </div>`;
}

function dayHtml(dateStr, rows, jobsById) {
  const d = new Date(dateStr + 'T00:00:00');
  const total = rows.reduce((s, r) => s + num(r.total_inches), 0);

  if (!rows.length) {
    return `
      <section class="mwl-day empty">
        <div class="mwl-day-head">
          <span class="mwl-day-name">${esc(dayLabel(d))}</span>
          <span class="mwl-day-none">nothing logged</span>
        </div>
      </section>`;
  }

  const tickets = rows.map((r) => {
    const job = r.job_id ? (jobsById[r.job_id] || 'Job') : (r.one_off_name || 'No job');
    const lines = (r.breakdown || []).map(lineHtml).join('');
    const misc = (r.misc_items || [])
      .filter((m) => m && (m.description || m.inches))
      .map((m) => `
        <div class="mwl-line misc">
          <span class="mwl-line-qty"></span>
          <span class="mwl-line-label">${esc(m.description || 'Misc')}</span>
          <span class="mwl-line-total">${fmt(num(m.inches))}<span class="mwl-unit">in</span></span>
        </div>`).join('');
    return `
      <div class="mwl-ticket">
        <div class="mwl-job">${esc(job)}</div>
        ${lines}${misc}
        <div class="mwl-ticket-total">
          <span>Ticket total</span>
          <span>${fmt(num(r.total_inches))}<span class="mwl-unit">in</span></span>
        </div>
      </div>`;
  }).join('');

  return `
    <section class="mwl-day">
      <div class="mwl-day-head">
        <span class="mwl-day-name">${esc(dayLabel(d))}</span>
        <span class="mwl-day-total">${fmt(total)}<span class="mwl-unit">in</span></span>
      </div>
      ${tickets}
    </section>`;
}

async function loadWeek() {
  const start = ymd(weekStart);
  const end   = ymd(addDays(weekStart, 6));
  weekLabel.textContent = weekLabelText(weekStart);
  daysBody.innerHTML = '<div class="mwl-loading">Loading&hellip;</div>';

  const [{ data: reports, error }, { data: jobs }] = await Promise.all([
    sb.from('weld_reports').select('*')
      .eq('welder_id', currentUser.id)
      .gte('report_date', start).lte('report_date', end)
      .order('report_date'),
    sb.from('jobs').select('id, name'),
  ]);

  if (error) {
    daysBody.innerHTML =
      `<div class="mwl-error">Could not load your weld log.<br><span>${esc(error.message)}</span></div>`;
    weekTotal.textContent = '0';
    return;
  }

  const jobsById = {};
  (jobs || []).forEach((j) => { jobsById[j.id] = j.name; });

  const byDate = {};
  (reports || []).forEach((r) => { (byDate[r.report_date] ||= []).push(r); });

  let total = 0;
  (reports || []).forEach((r) => { total += num(r.total_inches); });
  weekTotal.textContent = fmt(total);

  // Monday through Saturday; Sunday only appears if something was actually logged.
  const out = [];
  for (let i = 0; i < 7; i++) {
    const ds = ymd(addDays(weekStart, i));
    const rows = byDate[ds] || [];
    if (i === 6 && !rows.length) continue;
    out.push(dayHtml(ds, rows, jobsById));
  }
  daysBody.innerHTML = out.join('');
}

document.getElementById('prevWeek').addEventListener('click', () => {
  weekStart = addDays(weekStart, -7);
  loadWeek();
});
document.getElementById('nextWeek').addEventListener('click', () => {
  weekStart = addDays(weekStart, 7);
  loadWeek();
});

(async function init() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return; }
  currentUser = session.user;

  const { data: profile } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
  document.getElementById('userName').textContent =
    profile ? profile.full_name : currentUser.email;
  if (profile && profile.role === 'admin') {
    document.getElementById('adminBadge').style.display = 'inline-block';
    document.getElementById('adminNavLinks').style.display = 'inline';
  }

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await sb.auth.signOut();
    window.location.href = 'login.html';
  });

  weekStart = getMonday(new Date());
  loadWeek();
})();
