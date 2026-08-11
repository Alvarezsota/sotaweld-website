let currentUser = null;
let jobsById = {};
let weekStart = getMonday(new Date());
let openJobId = null;
let currentGroups = [];
let currentJobWeeks = {};

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
function money(n) { return '$' + Math.round(n).toLocaleString(); }
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
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

async function requireAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return null; }
  return session.user;
}

function personLine(role, name, hours, payRate, billRate, perDiemAmt, perDiem) {
  const pd = perDiem ? perDiemAmt : 0;
  const revenue = hours * billRate + pd;
  const cost = hours * payRate + pd;
  return { role, name, hours, billRate, pd: perDiem ? pd : null, revenue, cost, margin: revenue - cost };
}

function buildJobGroups(entries, jobs) {
  const groups = {}; // effectiveJobId -> { job, days: { dateStr: { lines: [] } } }

  entries.forEach(e => {
    const job = jobs.find(j => j.id === e.job_id);
    const isYardEntry = job && job.is_yard;
    const effectiveJobId = isYardEntry && e.for_job_id ? e.for_job_id : (e.job_id || `oneoff:${e.one_off_name}`);
    const effectiveJob = e.job_id ? (isYardEntry && e.for_job_id ? jobs.find(j => j.id === e.for_job_id) : job) : null;

    if (!groups[effectiveJobId]) {
      groups[effectiveJobId] = {
        id: effectiveJobId,
        job: effectiveJob,
        name: effectiveJob ? effectiveJob.name : (e.one_off_name || 'One-off job'),
        operator: effectiveJob ? effectiveJob.operator : '—',
        billTo: effectiveJob ? effectiveJob.bill_to : '—',
        days: {}
      };
    }
    const g = groups[effectiveJobId];
    if (!g.days[e.entry_date]) g.days[e.entry_date] = { descs: [], lines: [] };
    const d = g.days[e.entry_date];

    const prof = e.profiles || {};
    const perDiemAmt = effectiveJob ? Number(effectiveJob.per_diem) : 0;
    d.lines.push(personLine('welder', prof.full_name || '—', Number(e.hours), Number(prof.pay_rate || 0), Number(prof.bill_rate || 0), perDiemAmt, e.per_diem));
    if (e.description) d.descs.push(e.description);

    (e.daily_entry_helpers || []).forEach(dh => {
      const hp = dh.helpers || {};
      d.lines.push(personLine('helper', hp.name || '—', Number(dh.hours), Number(hp.pay_rate || 0), Number(hp.bill_rate || 0), perDiemAmt, dh.per_diem));
    });
  });

  return Object.values(groups).map(g => {
    let hours = 0, revenue = 0, cost = 0;
    Object.values(g.days).forEach(d => d.lines.forEach(l => { hours += l.hours; revenue += l.revenue; cost += l.cost; }));
    return { ...g, hours, revenue, cost, margin: revenue - cost, marginPct: revenue ? Math.round((revenue - cost) / revenue * 100) : 0 };
  }).sort((a, b) => b.revenue - a.revenue);
}

async function loadWeek() {
  const start = ymd(weekStart);
  const end = ymd(addDays(weekStart, 6));

  document.getElementById('weekLabel').textContent = formatWeekLabel(weekStart);

  const [{ data: entries }, { data: jobs }, { data: jw }] = await Promise.all([
    sb.from('daily_entries')
      .select('*, profiles(full_name, pay_rate, bill_rate), daily_entry_helpers(*, helpers(name, pay_rate, bill_rate))')
      .gte('entry_date', start).lte('entry_date', end),
    sb.from('jobs').select('*'),
    sb.from('job_weeks').select('*').eq('week_start', start)
  ]);

  jobsById = {};
  (jobs || []).forEach(j => jobsById[j.id] = j);

  currentJobWeeks = {};
  (jw || []).forEach(row => currentJobWeeks[row.job_id] = row);

  currentGroups = buildJobGroups(entries || [], jobs || []);
  renderGrid();
  if (openJobId) renderDetail(openJobId);
}

function statusFor(groupId) {
  const row = currentJobWeeks[groupId];
  return row ? row.status : 'open';
}

function renderGrid() {
  const totals = currentGroups.reduce((a, g) => { a.hours += g.hours; a.revenue += g.revenue; a.cost += g.cost; return a; }, { hours: 0, revenue: 0, cost: 0 });
  document.getElementById('weekSummary').innerHTML = `
    <div class="ws-item"><span class="ws-num">${totals.hours}</span><span class="ws-lbl">hours</span></div>
    <div class="ws-div"></div>
    <div class="ws-item"><span class="ws-num">${money(totals.revenue)}</span><span class="ws-lbl">revenue</span></div>
    <div class="ws-div"></div>
    <div class="ws-item ws-margin"><span class="ws-num">${money(totals.revenue - totals.cost)}</span><span class="ws-lbl">margin</span></div>
  `;

  const grid = document.getElementById('jobGrid');
  if (!currentGroups.length) {
    grid.innerHTML = `<div class="card empty-state2">No work logged this week yet.</div>`;
    return;
  }
  grid.innerHTML = currentGroups.map(g => {
    const status = statusFor(g.id);
    const stCls = status === 'synced' ? 'st-synced' : status === 'approved' ? 'st-approved' : 'st-open';
    return `
    <button class="job-tile" data-group-id="${esc(g.id)}">
      <div class="tile-top">
        <span class="pill ${stCls}">${esc(status)}</span>
      </div>
      <h3 class="tile-name">${esc(g.name)}</h3>
      <div class="tile-route">${esc(g.operator || '—')} &rarr; bill ${esc(g.billTo || '—')}</div>
      <div class="tile-stats">
        <div class="ts"><span class="ts-num">${g.hours}</span><span class="ts-lbl">hrs</span></div>
        <div class="ts"><span class="ts-num">${money(g.revenue)}</span><span class="ts-lbl">revenue</span></div>
        <div class="ts"><span class="ts-num ts-cost">${money(g.cost)}</span><span class="ts-lbl">cost</span></div>
      </div>
      <div class="tm-bar"><div class="tm-fill" style="width:${Math.max(0, g.marginPct)}%"></div></div>
      <div class="tm-row"><span>${money(g.margin)} margin</span><span class="tm-pct">${g.marginPct}%</span></div>
    </button>`;
  }).join('');

  grid.querySelectorAll('.job-tile').forEach(btn => {
    btn.addEventListener('click', () => {
      openJobId = btn.dataset.groupId;
      document.getElementById('jobGrid').style.display = 'none';
      renderDetail(openJobId);
    });
  });
}

function renderDetail(groupId) {
  const g = currentGroups.find(x => x.id === groupId);
  const detailEl = document.getElementById('jobDetail');
  if (!g) { detailEl.style.display = 'none'; document.getElementById('jobGrid').style.display = 'grid'; return; }

  const status = statusFor(g.id);
  const locked = status === 'approved' || status === 'synced';
  const jw = currentJobWeeks[g.id];
  const invoiceNo = jw ? (jw.invoice_no || '') : '';
  const stCls = status === 'synced' ? 'st-synced' : status === 'approved' ? 'st-approved' : 'st-open';

  const dayKeys = Object.keys(g.days).sort();

  detailEl.style.display = 'block';
  detailEl.innerHTML = `
    <button class="back2" id="backBtn">&larr; All jobs</button>
    <div class="detail-head">
      <div>
        <h2 class="detail-name">${esc(g.name)}</h2>
        <div class="detail-route">${esc(g.operator || '—')} &rarr; bill to ${esc(g.billTo || '—')} &middot; ${formatWeekLabel(weekStart)}</div>
      </div>
      <span class="pill big ${stCls}">${esc(status)}</span>
    </div>

    <div class="ticket">
      ${dayKeys.map(dateStr => {
        const d = g.days[dateStr];
        return `
        <div class="day2">
          <div class="day-head2">
            <span class="day-date2">${dayLabel(dateStr)}</span>
            <span class="day-desc2">${esc(d.descs.join(' · '))}</span>
          </div>
          <table class="lines2">
            <thead><tr><th class="l-name">Person</th><th>Hrs</th><th>Rate</th><th>PD</th><th>Bill</th><th>Margin</th></tr></thead>
            <tbody>
              ${d.lines.map(l => `
                <tr>
                  <td class="l-name">${esc(l.name)}<span class="role-tag2">${l.role}</span></td>
                  <td class="l-num">${l.hours}</td>
                  <td class="l-num dim">$${l.billRate}</td>
                  <td class="l-num dim">${l.pd ? money(l.pd) : '—'}</td>
                  <td class="l-num">${money(l.revenue)}</td>
                  <td class="l-num pos">${money(l.margin)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
      }).join('')}
    </div>

    <div class="totals2">
      <div class="tot-item2"><span class="tot-lbl2">Hours</span><span class="tot-num2">${g.hours}</span></div>
      <div class="tot-item2"><span class="tot-lbl2">Invoice (revenue)</span><span class="tot-num2">${money(g.revenue)}</span></div>
      <div class="tot-item2"><span class="tot-lbl2">Labor cost</span><span class="tot-num2 tot-cost2">${money(g.cost)}</span></div>
      <div class="tot-item2 tot-margin2"><span class="tot-lbl2">Job margin</span><span class="tot-num2">${money(g.margin)} (${g.marginPct}%)</span></div>
    </div>

    <div class="actions2">
      <div class="inv2">
        <label class="inv-lbl2">Invoice #</label>
        <input class="inv-input2" id="invoiceInput" value="${esc(invoiceNo)}" ${locked ? 'disabled' : ''}>
      </div>
      <div class="act-btns2" id="actBtns"></div>
    </div>
  `;

  document.getElementById('backBtn').addEventListener('click', () => {
    openJobId = null;
    detailEl.style.display = 'none';
    document.getElementById('jobGrid').style.display = 'grid';
  });

  const actBtns = document.getElementById('actBtns');
  if (!locked) {
    actBtns.innerHTML = `
      <button class="btn2 btn2-ghost" id="kickBtn">Kick back</button>
      <button class="btn2 btn2-solid" id="approveBtn">Approve week &amp; lock</button>
    `;
    document.getElementById('kickBtn').addEventListener('click', () => setJobWeekStatus(g.id, 'open'));
    document.getElementById('approveBtn').addEventListener('click', () => setJobWeekStatus(g.id, 'approved'));
  } else if (status === 'approved') {
    actBtns.innerHTML = `
      <span class="locked-note2">Locked · ready for QuickBooks</span>
      <button class="btn2 btn2-line" id="qboBtn" disabled title="QuickBooks integration not set up yet">Sync to QuickBooks Online</button>
      <span class="qbo-note">Requires QuickBooks setup — coming later</span>
    `;
  } else {
    actBtns.innerHTML = `<span class="locked-note2">Synced to QuickBooks</span>`;
  }

  document.getElementById('invoiceInput').addEventListener('blur', async (e) => {
    if (locked) return;
    await upsertJobWeek(g.id, { invoice_no: e.target.value.trim() || null });
  });
}

async function upsertJobWeek(groupId, patch) {
  const job = jobsById[groupId];
  if (!job) return; // one-off jobs without a real job id can't be tracked in job_weeks yet
  const start = ymd(weekStart);
  const existing = currentJobWeeks[groupId];

  if (existing) {
    await sb.from('job_weeks').update(patch).eq('id', existing.id);
    Object.assign(existing, patch);
  } else {
    const { data } = await sb.from('job_weeks').insert({ job_id: groupId, week_start: start, ...patch }).select().single();
    if (data) currentJobWeeks[groupId] = data;
  }
}

async function setJobWeekStatus(groupId, status) {
  const patch = { status };
  if (status === 'approved') patch.approved_at = new Date().toISOString();
  await upsertJobWeek(groupId, patch);
  renderGrid();
  renderDetail(groupId);
}

document.getElementById('prevWeekBtn').addEventListener('click', () => { weekStart = addDays(weekStart, -7); openJobId = null; document.getElementById('jobDetail').style.display = 'none'; document.getElementById('jobGrid').style.display = 'grid'; loadWeek(); });
document.getElementById('nextWeekBtn').addEventListener('click', () => { weekStart = addDays(weekStart, 7); openJobId = null; document.getElementById('jobDetail').style.display = 'none'; document.getElementById('jobGrid').style.display = 'grid'; loadWeek(); });

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
