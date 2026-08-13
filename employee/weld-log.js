let currentUser = null;
let weekStart = getMonday(new Date());
let jobsById = {};

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
function ymd(d) { return d.toISOString().slice(0, 10); }
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
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

async function requireAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return null; }
  return session.user;
}

function effectiveJobFor(row) {
  const job = row.job_id ? jobsById[row.job_id] : null;
  const isYardRow = job && job.is_yard;
  if (isYardRow && row.for_job_id) return jobsById[row.for_job_id] || null;
  if (row.job_id) return job;
  return null;
}
function jobLabelFor(row) {
  const j = effectiveJobFor(row);
  if (j) return j.name;
  return row.one_off_name || 'One-off job';
}

function buildWelderGroups(reports) {
  const byWelder = {};
  reports.forEach(r => {
    const wid = r.welder_id;
    if (!byWelder[wid]) {
      byWelder[wid] = { welderId: wid, name: (r.profiles && r.profiles.full_name) || 'Unknown welder', total: 0, days: {} };
    }
    const wg = byWelder[wid];
    wg.total += Number(r.total_inches);
    if (!wg.days[r.report_date]) wg.days[r.report_date] = { dateStr: r.report_date, total: 0, jobs: [] };
    const day = wg.days[r.report_date];
    day.total += Number(r.total_inches);
    day.jobs.push(r);
  });
  return Object.values(byWelder).sort((a, b) => b.total - a.total);
}

function lineItemsHtml(r) {
  const breakdown = r.breakdown || [];
  const misc = r.misc_items || [];
  const lines = [];
  breakdown.forEach(b => lines.push(`<div class="wl-item">${esc(b.label)} &times; ${b.qty} <span class="wl-item-in">${Number(b.total).toFixed(2)} in</span></div>`));
  misc.forEach(m => lines.push(`<div class="wl-item wl-item-misc">${esc(m.description)}${m.inches ? ` <span class="wl-item-in">${Number(m.inches).toFixed(2)} in</span>` : ''}</div>`));
  return lines.join('');
}

function renderBody(welderGroups) {
  const body = document.getElementById('weldLogBody');

  if (!welderGroups.length) {
    body.innerHTML = '<div class="card"><p class="empty-state2">No weld reports for this week.</p></div>';
    return;
  }

  body.innerHTML = welderGroups.map(wg => {
    const dayList = Object.values(wg.days).sort((a, b) => a.dateStr.localeCompare(b.dateStr));
    return `
      <div class="card wl-welder-card">
        <div class="wl-welder-head">
          <span class="wl-welder-name">${esc(wg.name)}</span>
          <span class="wl-welder-total">${wg.total.toFixed(2)} in this week</span>
        </div>
        ${dayList.map(day => `
          <div class="wl-day">
            <div class="wl-day-head">${esc(dayLabel(day.dateStr))} <span class="wl-day-total">${day.total.toFixed(2)} in</span></div>
            ${day.jobs.map(r => `
              <div class="wl-job">
                <div class="wl-job-head">
                  <span class="wl-job-name">${esc(jobLabelFor(r))}</span>
                  <span class="wl-job-total">${Number(r.total_inches).toFixed(2)} in</span>
                </div>
                <div class="wl-items">${lineItemsHtml(r)}</div>
              </div>
            `).join('')}
          </div>
        `).join('')}
      </div>`;
  }).join('');
}

async function loadWeek() {
  const start = ymd(weekStart);
  const end = ymd(addDays(weekStart, 6));
  document.getElementById('weekLabel').textContent = formatWeekLabel(weekStart);
  document.getElementById('weldLogBody').innerHTML = '<div class="card"><p class="empty-state2">Loading…</p></div>';

  const [{ data: reports }, { data: jobs }] = await Promise.all([
    sb.from('weld_reports')
      .select('*, profiles(full_name)')
      .gte('report_date', start).lte('report_date', end)
      .order('report_date'),
    sb.from('jobs').select('*')
  ]);

  jobsById = {};
  (jobs || []).forEach(j => jobsById[j.id] = j);

  const welderGroups = buildWelderGroups(reports || []);
  const weekTotal = welderGroups.reduce((s, w) => s + w.total, 0);
  document.getElementById('weekSummary').textContent = welderGroups.length
    ? `${weekTotal.toFixed(2)} in total · ${welderGroups.length} welder${welderGroups.length === 1 ? '' : 's'} reported`
    : '';

  renderBody(welderGroups);
}

document.getElementById('prevWeekBtn').addEventListener('click', () => { weekStart = addDays(weekStart, -7); loadWeek(); });
document.getElementById('nextWeekBtn').addEventListener('click', () => { weekStart = addDays(weekStart, 7); loadWeek(); });

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
})();
