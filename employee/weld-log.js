let currentUser = null;
let weekStart = getMonday(new Date());
let jobsById = {};
let jobsList = [];
let weldersAll = [];
let allReports = [];
let editingReportId = null;
let editState = null;
let hoursByWelderDate = {};

const PI = 3.14;
const PIPE = [[1.5,1.63],[2,2.38],[3,3.5],[4,4.5],[5,5.56],[6,6.63],[8,8.63],[10,10.75],[12,12.75],
              [14,14],[16,16],[18,18],[20,20],[22,22],[24,24],[26,26],[28,28],[30,30],
              [32,32],[34,34],[36,36],[38,38],[40,40]];
const OLET = [[0.5,5.28],[0.75,6.66],[1,8.23],[1.5,11.99],[2,14.95],[3,21.98],[4,28.26],[6,41.64],[8,54.2],[10,67.51]];
const BIG_PIPE = PIPE.filter(([nom]) => nom >= 12);
const SPLIT_FN_URL = 'https://woqzbterwialanccprhp.supabase.co/functions/v1/weld-split-credit';

function pipeWeldInches(nominal, schedule) {
  const row = PIPE.find(([nom]) => nom === Number(nominal));
  if (!row) return 0;
  const std = row[1] * PI;
  if (schedule === 'sch80') return std * 1.4;
  if (schedule === 'sch100') return std * 1.6;
  return std;
}
function schedLabel(schedule) {
  return schedule === 'sch80' ? 'Sch80' : schedule === 'sch100' ? 'Sch100+' : 'Std';
}

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

// A welder who works two jobs in a day files one report per job, because inches
// have to land on the right job for costing. He still only worked one day, so the
// log shows him once and splits the jobs inside — one name, one day total, one
// hours line, with each job called out under it.
function buildDayGroups(reports) {
  const byDay = {};
  reports.forEach(r => {
    if (!byDay[r.report_date]) byDay[r.report_date] = { dateStr: r.report_date, total: 0, welders: {} };
    const day = byDay[r.report_date];
    day.total += Number(r.total_inches);

    const wid = r.welder_id || 'unknown';
    if (!day.welders[wid]) {
      day.welders[wid] = {
        welderId: wid,
        name: (r.profiles && r.profiles.full_name) || 'Unknown welder',
        total: 0,
        rows: [],
      };
    }
    const w = day.welders[wid];
    w.total += Number(r.total_inches);
    w.rows.push(r);
  });

  return Object.values(byDay)
    .sort((a, b) => a.dateStr.localeCompare(b.dateStr))
    .map(day => ({
      dateStr: day.dateStr,
      total: day.total,
      welders: Object.values(day.welders)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(w => ({
          ...w,
          rows: [...w.rows].sort((a, b) =>
            (jobLabelFor(a) || '').localeCompare(jobLabelFor(b) || '')),
        })),
    }));
}

function lineItemsHtml(r) {
  const breakdown = r.breakdown || [];
  const misc = r.misc_items || [];
  const lines = [];
  breakdown.forEach(b => lines.push(`<div class="wl-item">${esc(b.label)} &times; ${b.qty} <span class="wl-item-in">${Number(b.total).toFixed(2)} in</span></div>`));
  misc.forEach(m => lines.push(`<div class="wl-item wl-item-misc">${esc(m.description)}${m.inches ? ` <span class="wl-item-in">${Number(m.inches).toFixed(2)} in</span>` : ''}</div>`));
  return lines.join('');
}

function localDateStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function submissionMetaHtml(r) {
  if (!r.created_at) return '';
  const created = new Date(r.created_at);
  const submittedDateStr = localDateStr(created);
  const mismatch = submittedDateStr !== r.report_date;
  const timeStr = created.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  let editedNote = '';
  if (r.updated_at) {
    const updated = new Date(r.updated_at);
    if (Math.abs(updated - created) > 60000) {
      editedNote = ` &middot; edited ${updated.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
    }
  }

  return `<div class="wl-submit-meta${mismatch ? ' wl-submit-mismatch' : ''}">${mismatch ? '&#9888; ' : ''}Submitted ${timeStr}${mismatch ? ` for ${dayLabel(r.report_date)}` : ''}${editedNote}</div>`;
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
function newMiscRow(desc) {
  return { uid: uid(), desc: desc || '' };
}
function newSplitLine(nominal, schedule, qty) {
  return { uid: uid(), nominal: nominal || '', schedule: schedule || 'std', qty: qty != null ? qty : 1 };
}
function splitLineHtml(line) {
  return `
    <div class="wr-split-row" data-split-uid="${line.uid}">
      <select class="input split-size-select">
        <option value="">Size…</option>
        ${BIG_PIPE.map(([nom]) => `<option value="${nom}" ${Number(line.nominal) === nom ? 'selected' : ''}>${nom}"</option>`).join('')}
      </select>
      <select class="input split-sched-select">
        <option value="std" ${line.schedule === 'std' ? 'selected' : ''}>Std</option>
        <option value="sch80" ${line.schedule === 'sch80' ? 'selected' : ''}>Sch 80</option>
        <option value="sch100" ${line.schedule === 'sch100' ? 'selected' : ''}>Sch 100+</option>
      </select>
      <input type="number" min="0" step="1" class="input split-qty-input" placeholder="Qty" value="${escAttr(line.qty)}">
      <span class="split-line-total" data-split-uid="${line.uid}">0 in (half each)</span>
      <button type="button" class="row-x" data-action="remove-split">&times;</button>
    </div>`;
}
function miscRowHtml(r) {
  return `
    <div class="wr-misc-row" data-misc-uid="${r.uid}">
      <input type="text" class="input wr-misc-desc" placeholder="Description" value="${escAttr(r.desc)}">
      <button type="button" class="row-x" data-action="remove-misc">&times;</button>
    </div>`;
}

function editCardHtml(state) {
  const other = state.jobId === 'other';
  const yard = isYardJob(state.jobId);
  const isNew = state.id === 'new';
  return `
    <div class="job-card wl-edit-card" data-report-id="${state.id}">
      <div class="job-card-top">
        <span class="job-idx">${isNew ? 'New weld report' : 'Editing'}</span>
        <button type="button" class="remove-job" data-action="cancel-edit">&times; Cancel</button>
      </div>
      <div class="wl-edit-row">
        <div class="wl-edit-field">
          <label class="field-label">Welder</label>
          <select class="input edit-welder-select">
            ${isNew ? '<option value="">Pick welder…</option>' : ''}
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
        <div class="wr-section-head"><span>Miscellaneous / Off-chart</span></div>
        <div data-misc-body>${state.miscRows.map(miscRowHtml).join('')}</div>
        <button type="button" class="add-part" data-action="add-misc">+ Add line</button>
      </div>
      ${state.splitItems.length ? `
        <div class="wr-section-inner wl-split-preserved">
          <div class="wr-section-head"><span>Split credit (already applied)</span></div>
          <span class="oneoff-note" style="display:block;margin-bottom:10px;">Wrong partner or qty? Remove it here (also pulls it off their log), then add the corrected split below.</span>
          ${state.splitItems.map((b, i) => `
            <div class="wl-item wl-split-preserved-item" data-preserved-idx="${i}">
              <span>${esc(b.label)} &times; ${b.qty} <span class="wl-item-in">${Number(b.total).toFixed(2)} in</span></span>
              <button type="button" class="row-x" data-action="remove-preserved-split" data-preserved-idx="${i}">&times;</button>
            </div>`).join('')}
        </div>` : ''}
      <div class="wr-section-inner wr-split-section">
        <div class="wr-section-head"><span>Split Welds (12&Prime;+ with a partner)</span><span class="wr-section-total" data-newsplit-sub>0 in (half each)</span></div>
        <span class="oneoff-note" style="display:block;margin-bottom:10px;">Fixing a ticket that should have been split? Add it here — the partner welder gets their half credited automatically to their own log.</span>
        <label class="field-label">Split with</label>
        <select class="input split-partner-select">
          <option value="">Pick the other welder…</option>
          ${weldersAll.filter(w => w.id !== state.welderId).map(w => `<option value="${w.id}" ${state.splitPartnerId === w.id ? 'selected' : ''}>${esc(w.full_name)}</option>`).join('')}
        </select>
        <div data-split-body>${state.splitLines.map(splitLineHtml).join('')}</div>
        <button type="button" class="add-part" data-action="add-split">+ Add split weld</button>
      </div>
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
        ${isNew ? '' : '<button type="button" class="btn2 btn2-line small" data-action="delete-report">Delete report</button>'}
        <button type="button" class="btn2 btn2-solid small" data-action="save-edit">${isNew ? 'Submit report' : 'Save changes'}</button>
      </div>
    </div>`;
}

function emptyNewReportState() {
  return {
    id: 'new',
    welderId: '',
    reportDate: todayIso(),
    jobId: '',
    oneOffName: '',
    forJobId: '',
    miscRows: [newMiscRow()],
    splitItems: [],
    splitPartnerId: '',
    splitLines: [],
    _chartBreakdown: [],
    _credits: [],
    _splitTotal: 0
  };
}

function recalcEditCard(cardEl, preservedSplitTotal) {
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
  let newSplitTotal = 0;
  cardEl.querySelectorAll('.wr-split-row').forEach(row => {
    const nominal = row.querySelector('.split-size-select').value;
    const schedule = row.querySelector('.split-sched-select').value;
    const qty = Number(row.querySelector('.split-qty-input').value) || 0;
    const half = nominal ? pipeWeldInches(nominal, schedule) / 2 : 0;
    const lineTotal = half * qty;
    const totalEl = row.querySelector('.split-line-total');
    if (totalEl) totalEl.textContent = fmt(lineTotal) + ' in (half each)';
    newSplitTotal += lineTotal;
  });
  const newSplitSubEl = cardEl.querySelector('[data-newsplit-sub]');
  if (newSplitSubEl) newSplitSubEl.textContent = fmt(newSplitTotal) + ' in (half each)';

  const splitTotal = (preservedSplitTotal || 0) + newSplitTotal;
  const grand = pipeTotal + oletTotal + miscTotal + splitTotal;
  cardEl.querySelector('[data-pipe-sub]').textContent = fmt(pipeTotal + splitTotal) + ' in';
  cardEl.querySelector('[data-olet-sub]').textContent = fmt(oletTotal) + ' in';
  cardEl.querySelector('[data-entry-total]').textContent = fmt(grand) + ' in';
  return { pipeTotal: fmt(pipeTotal + splitTotal), oletTotal: fmt(oletTotal), miscTotal: fmt(miscTotal), newSplitTotal: fmt(newSplitTotal), grand: fmt(grand) };
}

function buildEditBreakdown(cardEl) {
  const breakdown = [];
  cardEl.querySelectorAll('.wr-qty-input').forEach(q => {
    const v = Number(q.value) || 0;
    if (v > 0) breakdown.push({ label: q.dataset.lbl, qty: v, total: fmt(v * Number(q.dataset.val)) });
  });
  return breakdown;
}

function buildNewSplitBreakdown(cardEl, partnerId, partnerName) {
  const items = [];
  cardEl.querySelectorAll('.wr-split-row').forEach(row => {
    const nominal = row.querySelector('.split-size-select').value;
    const schedule = row.querySelector('.split-sched-select').value;
    const qty = Number(row.querySelector('.split-qty-input').value) || 0;
    if (!nominal || qty <= 0) return;
    const half = pipeWeldInches(nominal, schedule) / 2;
    items.push({
      label: `${nominal}" ${schedLabel(schedule)} (split w/ ${partnerName})`,
      qty, total: fmt(half * qty),
      nominal: Number(nominal), schedule, partnerId
    });
  });
  return items;
}
function buildSplitItemsForPartner(cardEl, myName) {
  const items = [];
  cardEl.querySelectorAll('.wr-split-row').forEach(row => {
    const nominal = row.querySelector('.split-size-select').value;
    const schedule = row.querySelector('.split-sched-select').value;
    const qty = Number(row.querySelector('.split-qty-input').value) || 0;
    if (!nominal || qty <= 0) return;
    const half = pipeWeldInches(nominal, schedule) / 2;
    items.push({ label: `${nominal}" ${schedLabel(schedule)} (split w/ ${myName})`, qty, total: fmt(half * qty) });
  });
  return items;
}

async function removePreservedSplit(item, myName, reportDate) {
  const { data: partnerReports } = await sb.from('weld_reports')
    .select('*')
    .eq('welder_id', item.partnerId)
    .eq('report_date', reportDate);
  const label = `${item.nominal}" ${schedLabel(item.schedule)} (split w/ ${myName})`;
  const match = (partnerReports || []).find(pr => (pr.breakdown || []).some(b => b.label === label));
  if (!match) return;
  const removed = match.breakdown.find(b => b.label === label);
  const newBreakdown = match.breakdown.filter(b => b.label !== label);
  const newTotal = fmt(Number(match.total_inches) - Number(removed.total));
  const newPipe = fmt(Number(match.pipe_inches) - Number(removed.total));
  await sb.from('weld_reports').update({
    breakdown: newBreakdown,
    total_inches: newTotal,
    pipe_inches: newPipe
  }).eq('id', match.id);
}

function startEdit(reportId) {
  const row = allReports.find(r => r.id === reportId);
  if (!row) return;
  // Three kinds of line live in a breakdown:
  //   - splits this welder logged himself  (carry partnerId)
  //   - half-credits his partner's ticket gave him  (carry fromWelderId, or on
  //     older rows just a "(split w/ ...)" label and nothing else)
  //   - ordinary chart work
  // Credits used to fall in with the chart lines, and because their labels match
  // no chart input they were dropped the moment anyone edited the ticket. That is
  // how welders quietly lost inches. Hold them aside and write them back.
  const isCredit = b => !b.partnerId && (b.fromWelderId || /\(split w\//.test(String(b.label || '')));
  const splitItems = (row.breakdown || []).filter(b => b.partnerId);
  const credits = (row.breakdown || []).filter(isCredit);
  const chartBreakdown = (row.breakdown || []).filter(b => !b.partnerId && !isCredit(b));
  editingReportId = reportId;
  editState = {
    id: row.id,
    welderId: row.welder_id,
    reportDate: row.report_date,
    jobId: row.job_id || (row.one_off_name ? 'other' : ''),
    oneOffName: row.one_off_name || '',
    forJobId: row.for_job_id || '',
    miscRows: (row.misc_items && row.misc_items.length) ? row.misc_items.map(m => newMiscRow(m.description)) : [newMiscRow()],
    splitItems,
    splitPartnerId: '',
    splitLines: [],
    _chartBreakdown: chartBreakdown,
    _credits: credits,
    _splitTotal: splitItems.reduce((s, b) => s + Number(b.total), 0)
      + credits.reduce((s, b) => s + Number(b.total), 0)
  };
  renderBody(buildDayGroups(allReports));
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
  const isNew = reportId === 'new';
  const other = editState.jobId === 'other';
  const yard = isYardJob(editState.jobId);

  const welderId = cardEl.querySelector('.edit-welder-select').value;
  const reportDate = cardEl.querySelector('.edit-date-input').value;
  if (!welderId || !reportDate || !editState.jobId) { alert('Welder, date, and job are all required.'); return; }
  if (other && !cardEl.querySelector('.edit-oneoff-input').value.trim()) { alert('Name the one-off job.'); return; }
  if (yard && !cardEl.querySelector('.edit-forjob-select').value) { alert("Pick which job the yard work is for."); return; }

  const hasNewSplitQty = [...cardEl.querySelectorAll('.wr-split-row')].some(row =>
    row.querySelector('.split-size-select').value && Number(row.querySelector('.split-qty-input').value) > 0);
  if (hasNewSplitQty && !editState.splitPartnerId) { alert('Pick who this split weld was shared with.'); return; }

  const partner = editState.splitPartnerId ? weldersAll.find(w => w.id === editState.splitPartnerId) : null;
  const myName = (weldersAll.find(w => w.id === welderId) || {}).full_name || 'Unknown welder';

  const totals = recalcEditCard(cardEl, editState._splitTotal);

  const newSplitBreakdown = partner ? buildNewSplitBreakdown(cardEl, partner.id, partner.full_name) : [];
  const breakdown = [...buildEditBreakdown(cardEl), ...editState.splitItems,
                     ...(editState._credits || []), ...newSplitBreakdown];
  const miscItems = editState.miscRows
    .filter(r => r.desc.trim())
    .map(r => ({ description: r.desc.trim(), inches: 0 }));

  if (isNew && totals.grand <= 0 && !breakdown.length && !miscItems.length) { alert('Enter at least some weld inches or an off-chart line before submitting.'); return; }

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

  const { error } = isNew
    ? await sb.from('weld_reports').insert(payload)
    : await sb.from('weld_reports').update(payload).eq('id', reportId);
  if (error) { alert('Could not save: ' + error.message); return; }

  if (partner) {
    const splitItems = buildSplitItemsForPartner(cardEl, myName);
    if (splitItems.length) {
      const { data: { session } } = await sb.auth.getSession();
      try {
        const res = await fetch(SPLIT_FN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
          body: JSON.stringify({
            partnerWelderId: partner.id,
            sourceWelderId: welderId,
            reportDate,
            jobId: other ? null : editState.jobId,
            oneOffName: other ? cardEl.querySelector('.edit-oneoff-input').value.trim() : null,
            forJobId: yard ? (cardEl.querySelector('.edit-forjob-select').value || null) : null,
            items: splitItems
          })
        });
        const resJson = await res.json();
        if (!res.ok || !resJson.ok) alert('Ticket saved, but crediting the partner failed: ' + (resJson.error || 'unknown error'));
      } catch (splitErr) {
        alert('Ticket saved, but crediting the partner failed: ' + splitErr.message);
      }
    }
  }

  editingReportId = null;
  editState = null;
  await loadWeek();
}

async function deleteReport(reportId) {
  if (!confirm("Delete this weld report? This can't be undone.")) return;
  const { data: gone, error } = await sb.from('weld_reports')
    .delete().eq('id', reportId).select('id');
  if (error) { alert('Could not delete: ' + error.message); return; }
  if (!gone || gone.length === 0) {
    alert('That report could not be deleted.\n\n'
        + 'Nothing was removed. This is a permissions problem rather than something you did wrong.');
    return;
  }
  editingReportId = null;
  editState = null;
  await loadWeek();
}

// ---------- Render ----------

function renderBody(dayGroups) {
  const body = document.getElementById('weldLogBody');
  const newReportHtml = editingReportId === 'new' ? editCardHtml(editState) : '';

  if (!dayGroups.length) {
    body.innerHTML = newReportHtml + '<div class="card"><p class="empty-state2">No weld reports for this week.</p></div>';
    return;
  }

  body.innerHTML = newReportHtml + dayGroups.map(day => `
      <div class="card wl-welder-card">
        <div class="wl-welder-head">
          <span class="wl-welder-name">${esc(dayLabel(day.dateStr))}</span>
          <span class="wl-welder-total">${day.total.toFixed(2)} in this day</span>
        </div>
        ${day.welders.map(w => {
          // If this welder's report is open for editing, the edit card replaces
          // just that job, not the whole welder block.
          const editingHere = w.rows.some(r => editingReportId === r.id);
          const hrsWorked = hoursByWelderDate[`${w.welderId}_${day.dateStr}`];
          const hrsHtml = hrsWorked != null
            ? `<span class="wl-job-hours">&middot; ${hrsWorked} hrs logged</span>`
            : `<span class="wl-job-hours wl-job-hours-missing">&middot; no hours logged</span>`;
          const multi = w.rows.length > 1;

          return `
          <div class="wl-welder-block">
            <div class="wl-job-head">
              <span class="wl-job-name">${esc(w.name)}</span>
              <span class="wl-job-total">${w.total.toFixed(2)} in ${hrsHtml}</span>
            </div>
            ${multi ? `<div class="wl-multi-note">${w.rows.length} jobs this day</div>` : ''}
            ${w.rows.map(r => {
              if (editingReportId === r.id) return editCardHtml(editState);
              return `
              <div class="wl-job wl-job-nested">
                <div class="wl-job-sub">${esc(jobLabelFor(r))}${
                  multi ? ` <span class="wl-job-subtotal">${Number(r.total_inches).toFixed(2)} in</span>` : ''
                }</div>
                <div class="wl-items">${lineItemsHtml(r)}</div>
                ${submissionMetaHtml(r)}
                <div class="wl-job-actions">
                  <button type="button" class="we-edit-btn" data-action="edit-report" data-report-id="${r.id}">Edit</button>
                  <button type="button" class="we-del-btn" data-action="delete-report-inline" data-report-id="${r.id}">Delete</button>
                </div>
              </div>`;
            }).join('')}
          </div>`;
        }).join('')}
      </div>`).join('');
}

document.getElementById('weldLogBody').addEventListener('click', async (e) => {
  const editBtn = e.target.closest('[data-action="edit-report"]');
  if (editBtn) { startEdit(editBtn.dataset.reportId); return; }

  const delInlineBtn = e.target.closest('[data-action="delete-report-inline"]');
  if (delInlineBtn) { await deleteReport(delInlineBtn.dataset.reportId); return; }

  const cancelBtn = e.target.closest('[data-action="cancel-edit"]');
  if (cancelBtn) { editingReportId = null; editState = null; renderBody(buildDayGroups(allReports)); return; }

  const cardEl = e.target.closest('[data-report-id]');
  if (!cardEl || !editState) return;
  const reportId = cardEl.dataset.reportId;

  if (e.target.closest('[data-action="save-edit"]')) { await saveEdit(reportId); return; }
  if (e.target.closest('[data-action="delete-report"]')) { await deleteReport(reportId); return; }

  const removePreservedBtn = e.target.closest('[data-action="remove-preserved-split"]');
  if (removePreservedBtn) {
    const idx = Number(removePreservedBtn.dataset.preservedIdx);
    const item = editState.splitItems[idx];
    const partnerName = (weldersAll.find(w => w.id === item.partnerId) || {}).full_name || 'the partner';
    if (!confirm(`Remove this split credit? This also pulls ${item.qty} × ${item.nominal}" ${schedLabel(item.schedule)} off ${partnerName}'s log.`)) return;
    const myWelderId = cardEl.querySelector('.edit-welder-select').value;
    const myName = (weldersAll.find(w => w.id === myWelderId) || {}).full_name || 'Unknown welder';
    editState.splitItems.splice(idx, 1);
    editState._splitTotal = editState.splitItems.reduce((s, b) => s + Number(b.total), 0);
    await removePreservedSplit(item, myName, editState.reportDate);
    renderBody(buildDayGroups(allReports));
    const newCard = document.querySelector(`[data-report-id="${editState.id}"]`);
    if (newCard) {
      editState._chartBreakdown.forEach(chartItem => {
        const input = newCard.querySelector(`.wr-qty-input[data-lbl="${cssEscape(chartItem.label)}"]`);
        if (input) input.value = chartItem.qty;
      });
      recalcEditCard(newCard, editState._splitTotal);
    }
    return;
  }

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
    return;
  }

  if (e.target.closest('[data-action="add-split"]')) {
    editState.splitLines.push(newSplitLine());
    cardEl.querySelector('[data-split-body]').innerHTML = editState.splitLines.map(splitLineHtml).join('');
    recalcEditCard(cardEl, editState._splitTotal);
    return;
  }
  const removeSplitBtn = e.target.closest('[data-action="remove-split"]');
  if (removeSplitBtn) {
    const row = e.target.closest('[data-split-uid]');
    editState.splitLines = editState.splitLines.filter(x => x.uid !== row.dataset.splitUid);
    cardEl.querySelector('[data-split-body]').innerHTML = editState.splitLines.map(splitLineHtml).join('');
    recalcEditCard(cardEl, editState._splitTotal);
  }
});

document.getElementById('weldLogBody').addEventListener('input', (e) => {
  const cardEl = e.target.closest('[data-report-id]');
  if (!cardEl || !editState) return;
  if (e.target.classList.contains('wr-qty-input') || e.target.classList.contains('split-qty-input')) {
    recalcEditCard(cardEl, editState._splitTotal);
  }
  const miscRow = e.target.closest('[data-misc-uid]');
  if (miscRow) {
    const r = editState.miscRows.find(x => x.uid === miscRow.dataset.miscUid);
    if (r && e.target.classList.contains('wr-misc-desc')) r.desc = e.target.value;
  }
  const splitRow = e.target.closest('[data-split-uid]');
  if (splitRow && e.target.classList.contains('split-qty-input')) {
    const line = editState.splitLines.find(x => x.uid === splitRow.dataset.splitUid);
    if (line) line.qty = e.target.value;
  }
});

document.getElementById('weldLogBody').addEventListener('change', (e) => {
  const cardEl = e.target.closest('[data-report-id]');
  if (!cardEl || !editState) return;

  if (e.target.classList.contains('edit-job-select')) {
    editState.jobId = e.target.value;
    if (editState.jobId !== 'other') editState.oneOffName = '';
    if (!isYardJob(editState.jobId)) editState.forJobId = '';
    renderBody(buildDayGroups(allReports));
    const newCard = document.querySelector(`[data-report-id="${editState.id}"]`);
    if (newCard) {
      editState._chartBreakdown.forEach(item => {
        const input = newCard.querySelector(`.wr-qty-input[data-lbl="${cssEscape(item.label)}"]`);
        if (input) input.value = item.qty;
      });
      recalcEditCard(newCard, editState._splitTotal);
    }
    return;
  }

  if (e.target.classList.contains('split-partner-select')) {
    editState.splitPartnerId = e.target.value;
    return;
  }
  const splitRow = e.target.closest('[data-split-uid]');
  if (splitRow && (e.target.classList.contains('split-size-select') || e.target.classList.contains('split-sched-select'))) {
    const line = editState.splitLines.find(x => x.uid === splitRow.dataset.splitUid);
    if (line) {
      if (e.target.classList.contains('split-size-select')) line.nominal = e.target.value;
      if (e.target.classList.contains('split-sched-select')) line.schedule = e.target.value;
    }
    recalcEditCard(cardEl, editState._splitTotal);
  }
});

async function loadWeek() {
  const start = ymd(weekStart);
  const end = ymd(addDays(weekStart, 6));
  document.getElementById('weekLabel').textContent = formatWeekLabel(weekStart);
  document.getElementById('weldLogBody').innerHTML = '<div class="card"><p class="empty-state2">Loading…</p></div>';

  const [{ data: reports }, { data: jobs }, { data: welders }, { data: entries }] = await Promise.all([
    sb.from('weld_reports')
      .select('*, profiles(full_name)')
      .gte('report_date', start).lte('report_date', end)
      .order('report_date'),
    sb.from('jobs').select('*'),
    sb.from('profiles').select('id, full_name').order('full_name'),
    sb.from('daily_entries')
      .select('welder_id, entry_date, hours')
      .gte('entry_date', start).lte('entry_date', end)
  ]);

  jobsById = {};
  jobsList = jobs || [];
  jobsList.forEach(j => jobsById[j.id] = j);
  weldersAll = welders || [];
  allReports = reports || [];
  editingReportId = null;
  editState = null;

  hoursByWelderDate = {};
  (entries || []).forEach(e => {
    const key = `${e.welder_id}_${e.entry_date}`;
    hoursByWelderDate[key] = (hoursByWelderDate[key] || 0) + Number(e.hours);
  });

  const dayGroups = buildDayGroups(allReports);
  const weekTotal = dayGroups.reduce((s, d) => s + d.total, 0);
  const welderCount = new Set(allReports.map(r => r.welder_id)).size;
  const jobCount = new Set(allReports.map(r => {
    const j = effectiveJobFor(r);
    return j ? j.id : (r.job_id || `oneoff:${r.one_off_name}`);
  })).size;
  document.getElementById('weekSummary').textContent = dayGroups.length
    ? `${weekTotal.toFixed(2)} in total · ${jobCount} job${jobCount === 1 ? '' : 's'} · ${welderCount} welder${welderCount === 1 ? '' : 's'} reported`
    : '';

  renderBody(dayGroups);
}

document.getElementById('prevWeekBtn').addEventListener('click', () => { weekStart = addDays(weekStart, -7); loadWeek(); });
document.getElementById('nextWeekBtn').addEventListener('click', () => { weekStart = addDays(weekStart, 7); loadWeek(); });

const WELD_DIGEST_URL = 'https://woqzbterwialanccprhp.supabase.co/functions/v1/weld-digest';

document.getElementById('emailCcPreset').addEventListener('change', (e) => {
  const email = e.target.value;
  if (!email) return;
  const ccInput = document.getElementById('emailCcInput');
  const current = ccInput.value.split(',').map(s => s.trim()).filter(Boolean);
  if (!current.includes(email)) current.push(email);
  ccInput.value = current.join(', ');
  e.target.value = '';
});

document.getElementById('sendLogEmailBtn').addEventListener('click', async () => {
  const btn = document.getElementById('sendLogEmailBtn');
  const statusEl = document.getElementById('emailStatus');
  const date = document.getElementById('emailDateInput').value;
  const to = document.getElementById('emailToInput').value.trim();
  const cc = document.getElementById('emailCcInput').value.trim();

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
      body: JSON.stringify({ date, to, cc })
    });
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.error || 'Send failed');

    if (json.skipped) {
      statusEl.textContent = `No weld reports found for ${date} — nothing to send.`;
      statusEl.className = 'wl-email-status wl-email-err';
    } else {
      const ccNote = json.ccList && json.ccList.length ? ` (cc: ${json.ccList.join(', ')})` : '';
      statusEl.textContent = `Sent — ${json.grandTotal.toFixed(2)} in across ${json.welders} welder(s) to ${to}${ccNote}.`;
      statusEl.className = 'wl-email-status wl-email-ok';
    }
  } catch (err) {
    statusEl.textContent = 'Could not send: ' + err.message;
    statusEl.className = 'wl-email-status wl-email-err';
  }

  btn.disabled = false;
  btn.textContent = 'Send';
});

document.getElementById('newReportBtn').addEventListener('click', () => {
  editingReportId = 'new';
  editState = emptyNewReportState();
  renderBody(buildDayGroups(allReports));
  const cardEl = document.querySelector('[data-report-id="new"]');
  if (cardEl) cardEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

  // Hours come from the daily entries, which Approvals can change after a report
  // was turned in, so watch those as closely as the reports themselves.
  await liveData({
    reload: loadWeek,
    isBusy: () => editingReportId !== null,
    tables: ['weld_reports', 'daily_entries'],
    channel: 'weld-log'
  });
})();
