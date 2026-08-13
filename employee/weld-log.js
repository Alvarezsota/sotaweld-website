let currentUser = null;
let weekStart = getMonday(new Date());
let jobsById = {};
let jobsList = [];
let weldersAll = [];
let allReports = [];
let editingReportId = null;
let editState = null;

const PI = 3.14;
const PIPE = [[2,2.38],[3,3.5],[4,4.5],[5,5.56],[6,6.63],[8,8.63],[10,10.75],[12,12.75],
              [14,14],[16,16],[18,18],[20,20],[22,22],[24,24],[26,26],[28,28],[30,30],
              [32,32],[34,34],[36,36],[38,38],[40,40]];
const OLET = [[0.5,5.28],[0.75,6.66],[1,8.23],[2,14.95],[3,21.98],[4,28.26],[6,41.64],[8,54.2],[10,67.51]];

function fmt(n) { return Math.round(n * 100) / 100; }
function uid() { return Math.random().toString(36).slice(2); }
function todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
function escAttr(str) { return esc(str).replace(/"/g, '&quot;'); }
function cssEscape(s) { return String(s).replace(/"/g, '\\"'); }
function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
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

function isYardJob(jobId) {
  const j = jobsById[jobId];
  return !!(j && j.is_yard);
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

function buildJobGroups(reports) {
  const byJob = {};
  reports.forEach(r => {
    const j = effectiveJobFor(r);
    const jobKey = j ? j.id : (r.job_id || `oneoff:${r.one_off_name}`);
    const jobName = j ? j.name : (r.one_off_name || 'One-off job');
    if (!byJob[jobKey]) {
      byJob[jobKey] = { jobKey, jobName, total: 0, days: {} };
    }
    const jg = byJob[jobKey];
    jg.total += Number(r.total_inches);
    if (!jg.days[r.report_date]) jg.days[r.report_date] = { dateStr: r.report_date, total: 0, rows: [] };
    const day = jg.days[r.report_date];
    day.total += Number(r.total_inches);
    day.rows.push(r);
  });
  return Object.values(byJob).sort((a, b) => b.total - a.total);
}

function lineItemsHtml(r) {
  const breakdown = r.breakdown || [];
  const misc = r.misc_items || [];
  const lines = [];
  breakdown.forEach(b => lines.push(`<div class="wl-item">${esc(b.label)} &times; ${b.qty} <span class="wl-item-in">${Number(b.total).toFixed(2)} in</span></div>`));
  misc.forEach(m => lines.push(`<div class="wl-item wl-item-misc">${esc(m.description)}${m.inches ? ` <span class="wl-item-in">${Number(m.inches).toFixed(2)} in</span>` : ''}</div>`));
  return lines.join('');
}

// ---------- Edit form ----------

function pipeRowsHtml() {
  return PIPE.map(([nom, od]) => {
    const std = od * PI, s80 = std * 1.4, s100 = std * 1.6;
    return `
      <tr>
        <td class="wr-l">${nom}"</td>
        <td class="wr-per">${od.toFixed(2)}</td>
        <td class="wr-per">${fmt(std)}</td>
        <td><input class="input wr-qty-input" type="number" min="0" step="1" data-val="${std}" data-lbl="${nom}&quot; Std"></td>
        <td class="wr-per">${fmt(s80)}</td>
        <td><input class="input wr-qty-input" type="number" min="0" step="1" data-val="${s80}" data-lbl="${nom}&quot; Sch80"></td>
        <td class="wr-per">${fmt(s100)}</td>
        <td><input class="input wr-qty-input" type="number" min="0" step="1" data-val="${s100}" data-lbl="${nom}&quot; Sch100+"></td>
        <td class="wr-rowtot" data-rowtot>0</td>
      </tr>`;
  }).join('');
}
function oletRowsHtml() {
  return OLET.map(([sz, std]) => {
    const s80 = std * 1.4;
    return `
      <tr>
        <td class="wr-l">${sz}"</td>
        <td class="wr-per">${fmt(std)}</td>
        <td><input class="input wr-qty-input" type="number" min="0" step="1" data-val="${std}" data-lbl="Olet ${sz}&quot; Std"></td>
        <td class="wr-per">${fmt(s80)}</td>
        <td><input class="input wr-qty-input" type="number" min="0" step="1" data-val="${s80}" data-lbl="Olet ${sz}&quot; Sch80"></td>
        <td class="wr-rowtot" data-rowtot>0</td>
      </tr>`;
  }).join('');
}
function newMiscRow(desc, inches) {
  return { uid: uid(), desc: desc || '', inches: inches != null ? inches : '' };
}
function miscRowHtml(r) {
  return `
    <div class="wr-misc-row" data-misc-uid="${r.uid}">
      <input type="text" class="input wr-misc-desc" placeholder="Description" value="${escAttr(r.desc)}">
      <input type="number" step="0.1" min="0" class="input wr-misc-in" placeholder="in" value="${escAttr(r.inches)}">
      <button type="button" class="row-x" data-action="remove-misc">&times;</button>
    </div>`;
}

function editCardHtml(state) {
  const other = state.jobId === 'other';
  const yard = isYardJob(state.jobId);
  return `
    <div class="job-card wl-edit-card" data-report-id="${state.id}">
      <div class="job-card-top">
        <span class="job-idx">Editing</span>
        <button type="button" class="remove-job" data-action="cancel-edit">&times; Cancel</button>
      </div>
      <div class="wl-edit-row">
        <div class="wl-edit-field">
          <label class="field-label">Welder</label>
          <select class="input edit-welder-select">
            ${weldersAll.map(w => `<option value="${esc(w.id)}" ${w.id === state.welderId ? 'selected' : ''}>${esc(w.full_name)}</option>`).join('')}
          </select>
        </div>
        <div class="wl-edit-field wl-edit-field-sm">
          <label class="field-label">Date</label>
          <input type="date" class="input edit-date-input" value="${esc(state.reportDate)}">
        </div>
      </div>
      <label class="field-label">Jobsite</label>
      <select class="input edit-job-select">
        <option value="">Pick job…</option>
        ${jobsList.map(j => `<option value="${j.id}" ${state.jobId === j.id ? 'selected' : ''}>${esc(j.name)}${j.is_yard ? ' (yard)' : ''}</option>`).join('')}
        <option value="other" ${other ? 'selected' : ''}>Other / one-off…</option>
      </select>
      ${other ? `
        <div class="oneoff">
          <label class="field-label">One-off job name</label>
          <input type="text" class="input edit-oneoff-input" value="${escAttr(state.oneOffName)}">
        </div>` : ''}
      ${yard ? `
        <div class="oneoff yard">
          <label class="field-label">Which job is this yard work for?</label>
          <select class="input edit-forjob-select">
            <option value="">Pick the job it's for…</option>
            ${jobsList.filter(j => !j.is_yard).map(j => `<option value="${j.id}" ${state.forJobId === j.id ? 'selected' : ''}>${esc(j.name)}</option>`).join('')}
          </select>
        </div>` : ''}

      <div class="wr-section-inner">
        <div class="wr-section-head"><span>Pipe Welds</span><span class="wr-section-total" data-pipe-sub>0 in</span></div>
        <div class="wr-table-scroll">
          <table class="wr-table">
            <thead><tr><th class="wr-l">Nominal</th><th>OD</th><th>Std /weld</th><th>Qty</th><th>Sch 80 /weld</th><th>Qty</th><th>Sch 100+ /weld</th><th>Qty</th><th>Weld In.</th></tr></thead>
            <tbody data-pipe-body>${pipeRowsHtml()}</tbody>
          </table>
        </div>
      </div>
      <div class="wr-section-inner">
        <div class="wr-section-head"><span>Miscellaneous / Off-chart</span><span class="wr-section-total" data-misc-sub>0 in</span></div>
        <div data-misc-body>${state.miscRows.map(miscRowHtml).join('')}</div>
        <button type="button" class="add-part" data-action="add-misc">+ Add line</button>
      </div>
      ${state.splitItems.length ? `
        <div class="wr-section-inner wl-split-preserved">
          <div class="wr-section-head"><span>Split credit (preserved as-is)</span></div>
          ${state.splitItems.map(b => `<div class="wl-item">${esc(b.label)} &times; ${b.qty} <span class="wl-item-in">${Number(b.total).toFixed(2)} in</span></div>`).join('')}
        </div>` : ''}
      <div class="wr-section-inner">
        <div class="wr-section-head"><span>Olet Welds</span><span class="wr-section-total" data-olet-sub>0 in</span></div>
        <div class="wr-table-scroll">
          <table class="wr-table">
            <thead><tr><th class="wr-l">Olet Size</th><th>Std /weld</th><th>Qty</th><th>Sch 80 /weld</th><th>Qty</th><th>Weld In.</th></tr></thead>
            <tbody data-olet-body>${oletRowsHtml()}</tbody>
          </table>
        </div>
      </div>

      <div class="wr-entry-total-row"><span>Report total</span><span data-entry-total>0 in</span></div>
      <div class="edit-card-footer">
        <button type="button" class="btn2 btn2-line small" data-action="delete-report">Delete report</button>
        <button type="button" class="btn2 btn2-solid small" data-action="save-edit">Save changes</button>
      </div>
    </div>`;
}

function recalcEditCard(cardEl, splitTotal) {
  let pipeTotal = 0, oletTotal = 0, miscTotal = 0;
  cardEl.querySelectorAll('[data-pipe-body] tr').forEach(tr => {
    let t = 0;
    tr.querySelectorAll('.wr-qty-input').forEach(q => { t += (Number(q.value) || 0) * Number(q.dataset.val); });
    tr.querySelector('[data-rowtot]').textContent = fmt(t);
    pipeTotal += t;
  });
  cardEl.querySelectorAll('[data-olet-body] tr').forEach(tr => {
    let t = 0;
    tr.querySelectorAll('.wr-qty-input').forEach(q => { t += (Number(q.value) || 0) * Number(q.dataset.val); });
    tr.querySelector('[data-rowtot]').textContent = fmt(t);
    oletTotal += t;
  });
  cardEl.querySelectorAll('.wr-misc-in').forEach(m => { miscTotal += Number(m.value) || 0; });

  const grand = pipeTotal + oletTotal + miscTotal + (splitTotal || 0);
  cardEl.querySelector('[data-pipe-sub]').textContent = fmt(pipeTotal + (splitTotal || 0)) + ' in';
  cardEl.querySelector('[data-olet-sub]').textContent = fmt(oletTotal) + ' in';
  cardEl.querySelector('[data-misc-sub]').textContent = fmt(miscTotal) + ' in';
  cardEl.querySelector('[data-entry-total]').textContent = fmt(grand) + ' in';
  return { pipeTotal: fmt(pipeTotal + (splitTotal || 0)), oletTotal: fmt(oletTotal), miscTotal: fmt(miscTotal), grand: fmt(grand) };
}

function buildEditBreakdown(cardEl) {
  const breakdown = [];
  cardEl.querySelectorAll('.wr-qty-input').forEach(q => {
    const v = Number(q.value) || 0;
    if (v > 0) breakdown.push({ label: q.dataset.lbl, qty: v, total: fmt(v * Number(q.dataset.val)) });
  });
  return breakdown;
}

function startEdit(reportId) {
  const row = allReports.find(r => r.id === reportId);
  if (!row) return;
  const splitItems = (row.breakdown || []).filter(b => b.partnerId);
  const chartBreakdown = (row.breakdown || []).filter(b => !b.partnerId);
  editingReportId = reportId;
  editState = {
    id: row.id,
    welderId: row.welder_id,
    reportDate: row.report_date,
    jobId: row.job_id || (row.one_off_name ? 'other' : ''),
    oneOffName: row.one_off_name || '',
    forJobId: row.for_job_id || '',
    miscRows: (row.misc_items && row.misc_items.length) ? row.misc_items.map(m => newMiscRow(m.description, m.inches)) : [newMiscRow()],
    splitItems,
    _chartBreakdown: chartBreakdown,
    _splitTotal: splitItems.reduce((s, b) => s + Number(b.total), 0)
  };
  renderBody(buildJobGroups(allReports));
  const cardEl = document.querySelector(`[data-report-id="${reportId}"]`);
  if (cardEl) {
    editState._chartBreakdown.forEach(item => {
      const input = cardEl.querySelector(`.wr-qty-input[data-lbl="${cssEscape(item.label)}"]`);
      if (input) input.value = item.qty;
    });
    recalcEditCard(cardEl, editState._splitTotal);
  }
}

async function saveEdit(reportId) {
  const cardEl = document.querySelector(`[data-report-id="${reportId}"]`);
  if (!cardEl) return;
  const other = editState.jobId === 'other';
  const yard = isYardJob(editState.jobId);

  const welderId = cardEl.querySelector('.edit-welder-select').value;
  const reportDate = cardEl.querySelector('.edit-date-input').value;
  if (!welderId || !reportDate || !editState.jobId) { alert('Welder, date, and job are all required.'); return; }
  if (other && !cardEl.querySelector('.edit-oneoff-input').value.trim()) { alert('Name the one-off job.'); return; }
  if (yard && !cardEl.querySelector('.edit-forjob-select').value) { alert("Pick which job the yard work is for."); return; }

  const totals = recalcEditCard(cardEl, editState._splitTotal);
  const breakdown = [...buildEditBreakdown(cardEl), ...editState.splitItems];
  const miscItems = editState.miscRows
    .filter(r => r.desc.trim() || Number(r.inches) > 0)
    .map(r => ({ description: r.desc.trim() || '(no description)', inches: Number(r.inches) || 0 }));

  const payload = {
    welder_id: welderId,
    report_date: reportDate,
    job_id: other ? null : editState.jobId,
    one_off_name: other ? cardEl.querySelector('.edit-oneoff-input').value.trim() : null,
    for_job_id: yard ? (cardEl.querySelector('.edit-forjob-select').value || null) : null,
    pipe_inches: totals.pipeTotal,
    olet_inches: totals.oletTotal,
    misc_inches: totals.miscTotal,
    total_inches: totals.grand,
    breakdown,
    misc_items: miscItems,
    updated_at: new Date().toISOString()
  };

  const { error } = await sb.from('weld_reports').update(payload).eq('id', reportId);
  if (error) { alert('Could not save: ' + error.message); return; }

  editingReportId = null;
  editState = null;
  await loadWeek();
}

async function deleteReport(reportId) {
  if (!confirm("Delete this weld report? This can't be undone.")) return;
  const { error } = await sb.from('weld_reports').delete().eq('id', reportId);
  if (error) { alert('Could not delete: ' + error.message); return; }
  editingReportId = null;
  editState = null;
  await loadWeek();
}

// ---------- Render ----------

function renderBody(jobGroups) {
  const body = document.getElementById('weldLogBody');

  if (!jobGroups.length) {
    body.innerHTML = '<div class="card"><p class="empty-state2">No weld reports for this week.</p></div>';
    return;
  }

  body.innerHTML = jobGroups.map(jg => {
    const dayList = Object.values(jg.days).sort((a, b) => a.dateStr.localeCompare(b.dateStr));
    return `
      <div class="card wl-welder-card">
        <div class="wl-welder-head">
          <span class="wl-welder-name">${esc(jg.jobName)}</span>
          <span class="wl-welder-total">${jg.total.toFixed(2)} in this week</span>
        </div>
        ${dayList.map(day => `
          <div class="wl-day">
            <div class="wl-day-head">${esc(dayLabel(day.dateStr))} <span class="wl-day-total">${day.total.toFixed(2)} in</span></div>
            ${day.rows.map(r => editingReportId === r.id ? editCardHtml(editState) : `
              <div class="wl-job">
                <div class="wl-job-head">
                  <span class="wl-job-name">${esc((r.profiles && r.profiles.full_name) || 'Unknown welder')}</span>
                  <span class="wl-job-total">${Number(r.total_inches).toFixed(2)} in</span>
                </div>
                <div class="wl-items">${lineItemsHtml(r)}</div>
                <div class="wl-job-actions">
                  <button type="button" class="we-edit-btn" data-action="edit-report" data-report-id="${r.id}">Edit</button>
                  <button type="button" class="we-del-btn" data-action="delete-report-inline" data-report-id="${r.id}">Delete</button>
                </div>
              </div>
            `).join('')}
          </div>
        `).join('')}
      </div>`;
  }).join('');
}

document.getElementById('weldLogBody').addEventListener('click', async (e) => {
  const editBtn = e.target.closest('[data-action="edit-report"]');
  if (editBtn) { startEdit(editBtn.dataset.reportId); return; }

  const delInlineBtn = e.target.closest('[data-action="delete-report-inline"]');
  if (delInlineBtn) { await deleteReport(delInlineBtn.dataset.reportId); return; }

  const cancelBtn = e.target.closest('[data-action="cancel-edit"]');
  if (cancelBtn) { editingReportId = null; editState = null; renderBody(buildJobGroups(allReports)); return; }

  const cardEl = e.target.closest('[data-report-id]');
  if (!cardEl || !editState) return;
  const reportId = cardEl.dataset.reportId;

  if (e.target.closest('[data-action="save-edit"]')) { await saveEdit(reportId); return; }
  if (e.target.closest('[data-action="delete-report"]')) { await deleteReport(reportId); return; }

  if (e.target.closest('[data-action="add-misc"]')) {
    editState.miscRows.push(newMiscRow());
    cardEl.querySelector('[data-misc-body]').innerHTML = editState.miscRows.map(miscRowHtml).join('');
    return;
  }
  const removeMiscBtn = e.target.closest('[data-action="remove-misc"]');
  if (removeMiscBtn) {
    const row = e.target.closest('[data-misc-uid]');
    editState.miscRows = editState.miscRows.filter(x => x.uid !== row.dataset.miscUid);
    if (!editState.miscRows.length) editState.miscRows.push(newMiscRow());
    cardEl.querySelector('[data-misc-body]').innerHTML = editState.miscRows.map(miscRowHtml).join('');
    recalcEditCard(cardEl, editState._splitTotal);
  }
});

document.getElementById('weldLogBody').addEventListener('input', (e) => {
  const cardEl = e.target.closest('[data-report-id]');
  if (!cardEl || !editState) return;
  if (e.target.classList.contains('wr-qty-input') || e.target.classList.contains('wr-misc-in')) {
    recalcEditCard(cardEl, editState._splitTotal);
  }
});

document.getElementById('weldLogBody').addEventListener('change', (e) => {
  const cardEl = e.target.closest('[data-report-id]');
  if (!cardEl || !editState) return;

  if (e.target.classList.contains('edit-job-select')) {
    editState.jobId = e.target.value;
    if (editState.jobId !== 'other') editState.oneOffName = '';
    if (!isYardJob(editState.jobId)) editState.forJobId = '';
    renderBody(buildJobGroups(allReports));
    const newCard = document.querySelector(`[data-report-id="${editState.id}"]`);
    if (newCard) {
      editState._chartBreakdown.forEach(item => {
        const input = newCard.querySelector(`.wr-qty-input[data-lbl="${cssEscape(item.label)}"]`);
        if (input) input.value = item.qty;
      });
      recalcEditCard(newCard, editState._splitTotal);
    }
  }
});

async function loadWeek() {
  const start = ymd(weekStart);
  const end = ymd(addDays(weekStart, 6));
  document.getElementById('weekLabel').textContent = formatWeekLabel(weekStart);
  document.getElementById('weldLogBody').innerHTML = '<div class="card"><p class="empty-state2">Loading…</p></div>';

  const [{ data: reports }, { data: jobs }, { data: welders }] = await Promise.all([
    sb.from('weld_reports')
      .select('*, profiles(full_name)')
      .gte('report_date', start).lte('report_date', end)
      .order('report_date'),
    sb.from('jobs').select('*'),
    sb.from('profiles').select('id, full_name').order('full_name')
  ]);

  jobsById = {};
  jobsList = jobs || [];
  jobsList.forEach(j => jobsById[j.id] = j);
  weldersAll = welders || [];
  allReports = reports || [];
  editingReportId = null;
  editState = null;

  const jobGroups = buildJobGroups(allReports);
  const weekTotal = jobGroups.reduce((s, j) => s + j.total, 0);
  const welderCount = new Set(allReports.map(r => r.welder_id)).size;
  document.getElementById('weekSummary').textContent = jobGroups.length
    ? `${weekTotal.toFixed(2)} in total · ${jobGroups.length} job${jobGroups.length === 1 ? '' : 's'} · ${welderCount} welder${welderCount === 1 ? '' : 's'} reported`
    : '';

  renderBody(jobGroups);
}

document.getElementById('prevWeekBtn').addEventListener('click', () => { weekStart = addDays(weekStart, -7); loadWeek(); });
document.getElementById('nextWeekBtn').addEventListener('click', () => { weekStart = addDays(weekStart, 7); loadWeek(); });

const WELD_DIGEST_URL = 'https://woqzbterwialanccprhp.supabase.co/functions/v1/weld-digest';

document.getElementById('sendLogEmailBtn').addEventListener('click', async () => {
  const btn = document.getElementById('sendLogEmailBtn');
  const statusEl = document.getElementById('emailStatus');
  const date = document.getElementById('emailDateInput').value;
  const to = document.getElementById('emailToInput').value.trim();

  if (!date || !to) {
    statusEl.textContent = 'Pick a date and enter an email address.';
    statusEl.className = 'wl-email-status wl-email-err';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Sending...';
  statusEl.textContent = '';

  try {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(WELD_DIGEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ date, to })
    });
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.error || 'Send failed');

    if (json.skipped) {
      statusEl.textContent = `No weld reports found for ${date} — nothing to send.`;
      statusEl.className = 'wl-email-status wl-email-err';
    } else {
      statusEl.textContent = `Sent — ${json.grandTotal.toFixed(2)} in across ${json.welders} welder(s) to ${to}.`;
      statusEl.className = 'wl-email-status wl-email-ok';
    }
  } catch (err) {
    statusEl.textContent = 'Could not send: ' + err.message;
    statusEl.className = 'wl-email-status wl-email-err';
  }

  btn.disabled = false;
  btn.textContent = 'Send';
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

  document.getElementById('emailDateInput').value = todayIso();
  document.getElementById('emailToInput').value = currentUser.email;

  await loadWeek();
})();
