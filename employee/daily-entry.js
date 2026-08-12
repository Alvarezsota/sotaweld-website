let currentUser = null;
let currentProfile = null;
let jobs = [];
let helpers = [];
let entries = [];
let gasFlag = '';
let extFlag = '';
let needGloves = false;
let needShields = false;

const entriesContainer = document.getElementById('entriesContainer');
const totalHoursEl = document.getElementById('totalHours');
const submitBtn = document.getElementById('submitBtn');
const addJobBtn = document.getElementById('addJobBtn');
const dateInput = document.getElementById('dateInput');

function todayIso() { return new Date().toISOString().slice(0, 10); }
function selectedDateLabel() {
  const val = dateInput.value || todayIso();
  const [y, m, d] = val.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

let weekPanelStart = getMonday(new Date());
let weekPanelLoaded = false;
let weekPanelDays = [];
let weekPanelLockedJobIds = new Set();
let editingEntryUid = null;
let editState = null;
const weekToggleBtn = document.getElementById('weekToggleBtn');
const weekPanel = document.getElementById('weekPanel');
const weekChev = document.getElementById('weekChev');
const weekPanelLabel = document.getElementById('weekPanelLabel');
const weekPanelBody = document.getElementById('weekPanelBody');

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date;
}
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function ymd(d) { return d.toISOString().slice(0, 10); }
function dayLabel(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
function formatWeekLabel(start) {
  const end = addDays(start, 6);
  const opts = { month: 'short', day: 'numeric' };
  return `${start.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, opts)}`;
}
function jobLabelFor(row) {
  if (row.job_id) {
    const j = jobs.find(x => x.id === row.job_id);
    return j ? j.name : (row.one_off_name || 'Job');
  }
  return row.one_off_name || 'One-off job';
}

async function loadWeekPanel() {
  weekPanelLabel.textContent = formatWeekLabel(weekPanelStart);
  weekPanelBody.innerHTML = '<div class="week-day-empty">Loading…</div>';
  editingEntryUid = null;
  editState = null;

  const start = ymd(weekPanelStart);
  const end = ymd(addDays(weekPanelStart, 6));

  const [{ data: rows }, { data: jwRows }] = await Promise.all([
    sb.from('daily_entries').select('*').eq('welder_id', currentUser.id)
      .gte('entry_date', start).lte('entry_date', end).order('entry_date'),
    sb.from('job_weeks').select('*').eq('week_start', start)
  ]);

  const weekEntries = rows || [];
  weekPanelLockedJobIds = new Set((jwRows || []).filter(r => r.status === 'approved' || r.status === 'synced').map(r => r.job_id));

  let helperRows = [];
  let partRows = [];
  if (weekEntries.length) {
    const [{ data: hRows }, { data: pRows }] = await Promise.all([
      sb.from('daily_entry_helpers').select('*').in('daily_entry_id', weekEntries.map(e => e.id)),
      sb.from('daily_entry_parts').select('*').in('daily_entry_id', weekEntries.map(e => e.id))
    ]);
    helperRows = hRows || [];
    partRows = pRows || [];
  }

  weekPanelDays = [];
  for (let i = 0; i < 7; i++) {
    const dateStr = ymd(addDays(weekPanelStart, i));
    const dayEntries = weekEntries.filter(e => e.entry_date === dateStr).map(e => ({
      row: e,
      helpers: helperRows.filter(h => h.daily_entry_id === e.id),
      parts: partRows.filter(p => p.daily_entry_id === e.id)
    }));
    weekPanelDays.push({ dateStr, dayEntries });
  }

  renderWeekPanelBody();
}

function effectiveJobIdFor(row) {
  const job = row.job_id ? jobs.find(j => j.id === row.job_id) : null;
  const isYardRow = job && job.is_yard;
  return (isYardRow && row.for_job_id) ? row.for_job_id : (row.job_id || null);
}
function isLockedRow(row) {
  const eid = effectiveJobIdFor(row);
  return !!eid && weekPanelLockedJobIds.has(eid);
}

function renderWeekPanelBody() {
  let weekTotal = 0;
  weekPanelDays.forEach(day => {
    day.dayHrs = day.dayEntries.reduce((s, d) => s + Number(d.row.hours), 0);
    weekTotal += day.dayHrs;
  });

  weekPanelBody.innerHTML = weekPanelDays.map(day => `
    <div class="week-day">
      <div class="week-day-head">
        <span class="week-day-date">${dayLabel(day.dateStr)}</span>
        <span class="week-day-hrs">${day.dayHrs ? day.dayHrs + ' hrs' : ''}</span>
      </div>
      ${day.dayEntries.length ? day.dayEntries.map(d => weekEntryHtml(d)).join('') : '<div class="week-day-empty">No work logged</div>'}
    </div>
  `).join('') + `<div class="week-total-row"><span>Week total</span><span>${weekTotal} hrs</span></div>`;
}

function weekEntryHtml(d) {
  const e = d.row;
  if (editingEntryUid === e.id) {
    return `<div class="week-entry-editing" data-entry-id="${e.id}">${editCardHtml(editState)}</div>`;
  }
  const locked = isLockedRow(e);
  return `
    <div class="week-entry" data-entry-id="${e.id}">
      <div class="week-entry-row">
        <span class="week-entry-name">${esc(jobLabelFor(e))}</span>
        <span class="week-entry-hrs">${hoursTracked(e.job_id) ? e.hours + ' hrs' : ''}${e.per_diem ? ' · PD' : ''}</span>
      </div>
      ${e.description ? `<div class="week-entry-desc">${esc(e.description)}</div>` : ''}
      ${d.parts.map(p => `<div class="week-entry-helper">&#8618; ${esc(p.description)} (${p.quantity} &times; $${p.rate}) — $${(Number(p.quantity) * Number(p.rate)).toLocaleString()}</div>`).join('')}
      ${d.helpers.map(h => {
        const hp = helpers.find(x => x.id === h.helper_id);
        return `<div class="week-entry-helper">&#8618; ${esc(hp ? hp.name : 'Helper')} — ${h.hours} hrs${h.per_diem ? ' · PD' : ''}</div>`;
      }).join('')}
      <div class="week-entry-actions">
        ${locked ? '<span class="week-entry-lock">Approved by office — contact them to change</span>' : `
          <button type="button" class="we-edit-btn" data-action="edit-entry">Edit</button>
          <button type="button" class="we-del-btn" data-action="delete-entry">Delete</button>
        `}
      </div>
    </div>`;
}

function startEditEntry(entryId) {
  let found = null;
  for (const day of weekPanelDays) {
    const d = day.dayEntries.find(x => x.row.id === entryId);
    if (d) { found = d; break; }
  }
  if (!found) return;
  const e = found.row;
  editingEntryUid = entryId;
  editState = {
    uid: entryId,
    jobId: e.job_id || (e.one_off_name ? 'other' : ''),
    oneOffName: e.one_off_name || '',
    forJobId: e.for_job_id || '',
    description: e.description || '',
    hours: Number(e.hours) || 0,
    perDiem: !!e.per_diem,
    helpers: found.helpers.map(h => ({ uid: uid(), helperId: h.helper_id, hours: Number(h.hours), perDiem: !!h.per_diem })),
    parts: found.parts.length ? found.parts.map(p => ({ uid: uid(), name: p.description, qty: p.quantity, rate: p.rate })) : [newPart()]
  };
  renderWeekPanelBody();
}

async function saveEditEntry(entryId) {
  const other = editState.jobId === 'other';
  const yard = isYard(editState.jobId);
  const flat = isFlat(editState.jobId);

  if (!editState.jobId) { alert('Pick a job.'); return; }
  if (!editState.description.trim()) { alert('Add a description.'); return; }
  if (other && !editState.oneOffName.trim()) { alert('Name the one-off job.'); return; }
  if (yard && !editState.forJobId) { alert('Pick which job this yard work is for.'); return; }
  if (flat && !editState.parts.some(p => p.name.trim() && Number(p.qty) > 0 && Number(p.rate) > 0)) {
    alert('Add at least one part with a quantity and rate.');
    return;
  }

  const saveBtn = weekPanelBody.querySelector('[data-action="save-edit"]');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

  try {
    const { error: upErr } = await sb.from('daily_entries').update({
      job_id: other ? null : editState.jobId,
      one_off_name: other ? editState.oneOffName.trim() : null,
      for_job_id: yard ? editState.forJobId : null,
      description: editState.description.trim(),
      hours: editState.hours,
      per_diem: editState.perDiem
    }).eq('id', entryId);
    if (upErr) throw upErr;

    await sb.from('daily_entry_helpers').delete().eq('daily_entry_id', entryId);
    const helperRows = editState.helpers
      .filter(h => h.helperId)
      .map(h => ({ daily_entry_id: entryId, helper_id: h.helperId, hours: h.hours, per_diem: h.perDiem }));
    if (helperRows.length) {
      const { error: heErr } = await sb.from('daily_entry_helpers').insert(helperRows);
      if (heErr) throw heErr;
    }

    await sb.from('daily_entry_parts').delete().eq('daily_entry_id', entryId);
    if (flat) {
      const partRows = editState.parts
        .filter(p => p.name.trim() && Number(p.qty) > 0 && Number(p.rate) > 0)
        .map(p => ({ daily_entry_id: entryId, description: p.name.trim(), quantity: Number(p.qty), rate: Number(p.rate) }));
      if (partRows.length) {
        const { error: peErr } = await sb.from('daily_entry_parts').insert(partRows);
        if (peErr) throw peErr;
      }
    }

    editingEntryUid = null;
    editState = null;
    loadWeekPanel();
  } catch (err) {
    console.error(err);
    alert('Could not save changes. Please try again.');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save changes'; }
  }
}

function updateEditPartTotals() {
  editState.parts.forEach(p => {
    const el = weekPanelBody.querySelector(`.part-line-total[data-part-uid="${p.uid}"]`);
    if (el) el.textContent = '$' + partTotal(p).toLocaleString();
  });
  const totalEl = weekPanelBody.querySelector(`.flat-total-value[data-entry-uid="${editState.uid}"]`);
  if (totalEl) totalEl.textContent = '$' + partsTotal(editState.parts).toLocaleString();
}

weekToggleBtn.addEventListener('click', () => {
  const opening = weekPanel.style.display === 'none';
  weekPanel.style.display = opening ? 'block' : 'none';
  weekToggleBtn.classList.toggle('open', opening);
  if (opening && !weekPanelLoaded) {
    weekPanelLoaded = true;
    loadWeekPanel();
  }
});
document.getElementById('prevWeekBtn2').addEventListener('click', () => {
  weekPanelStart = addDays(weekPanelStart, -7);
  loadWeekPanel();
});
document.getElementById('nextWeekBtn2').addEventListener('click', () => {
  weekPanelStart = addDays(weekPanelStart, 7);
  loadWeekPanel();
});

weekPanelBody.addEventListener('click', async (e) => {
  const entryDiv = e.target.closest('[data-entry-id]');
  if (!entryDiv) return;
  const entryId = entryDiv.dataset.entryId;

  if (e.target.closest('[data-action="edit-entry"]')) {
    startEditEntry(entryId);
    return;
  }
  if (e.target.closest('[data-action="cancel-edit"]')) {
    editingEntryUid = null;
    editState = null;
    renderWeekPanelBody();
    return;
  }
  if (e.target.closest('[data-action="delete-entry"]')) {
    if (!confirm("Delete this ticket? This can't be undone.")) return;
    const { error } = await sb.from('daily_entries').delete().eq('id', entryId);
    if (error) { alert('Could not delete: ' + error.message); return; }
    editingEntryUid = null;
    editState = null;
    loadWeekPanel();
    return;
  }
  if (!editState || editingEntryUid !== entryId) return;

  if (e.target.closest('[data-action="save-edit"]')) {
    saveEditEntry(entryId);
    return;
  }
  if (e.target.closest('[data-action="add-helper"]')) {
    editState.helpers.push(newHelperRow());
    renderWeekPanelBody();
    return;
  }
  if (e.target.closest('[data-action="add-part"]')) {
    editState.parts.push(newPart());
    renderWeekPanelBody();
    return;
  }
  const removePartBtn = e.target.closest('[data-action="remove-part"]');
  if (removePartBtn) {
    const partEl = e.target.closest('[data-part-uid]');
    editState.parts = editState.parts.filter(x => x.uid !== partEl.dataset.partUid);
    if (!editState.parts.length) editState.parts.push(newPart());
    renderWeekPanelBody();
    return;
  }
  const stepBtn = e.target.closest('.step-btn');
  if (stepBtn) {
    const helperEl = e.target.closest('[data-helper-uid]');
    const delta = stepBtn.dataset.dir === 'inc' ? 0.5 : -0.5;
    const target = helperEl ? editState.helpers.find(x => x.uid === helperEl.dataset.helperUid) : editState;
    target.hours = Math.max(0, Math.min(24, +(Number(target.hours) + delta).toFixed(1)));
    renderWeekPanelBody();
    return;
  }
  const pdToggle = e.target.closest('.pd-toggle');
  if (pdToggle) {
    const helperEl = e.target.closest('[data-helper-uid]');
    const target = helperEl ? editState.helpers.find(x => x.uid === helperEl.dataset.helperUid) : editState;
    target.perDiem = !target.perDiem;
    renderWeekPanelBody();
    return;
  }
  const removeHelperBtn = e.target.closest('[data-action="remove-helper"]');
  if (removeHelperBtn) {
    const helperEl = e.target.closest('[data-helper-uid]');
    editState.helpers = editState.helpers.filter(x => x.uid !== helperEl.dataset.helperUid);
    renderWeekPanelBody();
    return;
  }
});

weekPanelBody.addEventListener('change', (e) => {
  if (!editState) return;
  const entryDiv = e.target.closest('[data-entry-id]');
  if (!entryDiv || entryDiv.dataset.entryId !== editingEntryUid) return;

  if (e.target.classList.contains('job-select')) {
    editState.jobId = e.target.value;
    if (editState.jobId !== 'other') editState.oneOffName = '';
    if (!isYard(editState.jobId)) editState.forJobId = '';
    if (!hoursTracked(editState.jobId)) editState.hours = 0;
    renderWeekPanelBody();
    return;
  }
  if (e.target.classList.contains('for-job-select')) {
    editState.forJobId = e.target.value;
    return;
  }
  const helperEl = e.target.closest('[data-helper-uid]');
  if (helperEl && e.target.classList.contains('helper-select')) {
    const h = editState.helpers.find(x => x.uid === helperEl.dataset.helperUid);
    h.helperId = e.target.value;
    return;
  }
});

weekPanelBody.addEventListener('input', (e) => {
  if (!editState) return;
  const entryDiv = e.target.closest('[data-entry-id]');
  if (!entryDiv || entryDiv.dataset.entryId !== editingEntryUid) return;

  if (e.target.classList.contains('descr-input')) { editState.description = e.target.value; return; }
  if (e.target.classList.contains('oneoff-name-input')) { editState.oneOffName = e.target.value; return; }
  const partEl = e.target.closest('[data-part-uid]');
  if (partEl) {
    const p = editState.parts.find(x => x.uid === partEl.dataset.partUid);
    if (!p) return;
    if (e.target.classList.contains('part-name-input')) { p.name = e.target.value; return; }
    if (e.target.classList.contains('part-qty-input')) { p.qty = e.target.value; updateEditPartTotals(); return; }
    if (e.target.classList.contains('part-rate-input')) { p.rate = e.target.value; updateEditPartTotals(); return; }
  }
});

function uid() { return Math.random().toString(36).slice(2); }
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
function escAttr(str) { return esc(str).replace(/"/g, '&quot;'); }

function newEntry() {
  return { uid: uid(), jobId: '', oneOffName: '', forJobId: '', description: '', hours: 10, perDiem: true, helpers: [], parts: [newPart()] };
}
function newHelperRow() {
  return { uid: uid(), helperId: '', hours: 10, perDiem: true };
}
function newPart() {
  return { uid: uid(), name: '', qty: 1, rate: '' };
}
function partTotal(p) { return Number(p.qty || 0) * Number(p.rate || 0); }
function partsTotal(parts) { return parts.reduce((s, p) => s + partTotal(p), 0); }
function isYard(jobId) {
  const j = jobs.find(x => x.id === jobId);
  return !!(j && j.is_yard);
}
function isFlat(jobId) {
  const j = jobs.find(x => x.id === jobId);
  return !!(j && j.billing_type === 'flat');
}
function hoursTracked(jobId) {
  const j = jobs.find(x => x.id === jobId);
  return !j || j.track_hours !== false;
}
function jobName(entry) {
  if (entry.jobId === 'other') return entry.oneOffName || 'One-off job';
  const j = jobs.find(x => x.id === entry.jobId);
  return j ? j.name : '';
}

function stepperHtml(label, value) {
  return `
    <div class="stepper">
      <span class="stepper-label">${label}</span>
      <div class="stepper-controls">
        <button type="button" class="step-btn" data-dir="dec">&minus;</button>
        <div class="step-value"><span class="step-num">${value}</span><span class="step-unit">hrs</span></div>
        <button type="button" class="step-btn" data-dir="inc">+</button>
      </div>
    </div>`;
}
function pdToggleHtml(on) {
  return `<button type="button" class="pd-toggle${on ? ' pd-on' : ''}"><span class="pd-knob"></span><span class="pd-text">Per diem<br><b>${on ? 'ON' : 'OFF'}</b></span></button>`;
}
function partRowHtml(p) {
  return `
    <div class="part-row" data-part-uid="${p.uid}">
      <input type="text" class="input part-name-input" placeholder="e.g. 4x4 leg bracket" value="${escAttr(p.name)}">
      <div class="part-nums">
        <input type="number" step="1" min="0" class="input part-qty-input" placeholder="Qty" value="${escAttr(p.qty)}">
        <span class="part-x">&times;</span>
        <input type="number" step="0.01" min="0" class="input part-rate-input" placeholder="Rate $" value="${escAttr(p.rate)}">
        <span class="part-eq">=</span>
        <span class="part-line-total" data-part-uid="${p.uid}">$${partTotal(p).toLocaleString()}</span>
        <button type="button" class="remove-part" data-action="remove-part">&times;</button>
      </div>
    </div>`;
}
function helperBlockHtml(h) {
  return `
    <div class="helper-block" data-helper-uid="${h.uid}">
      <div class="helper-top">
        <select class="input helper-select">
          <option value="">Pick helper…</option>
          ${helpers.map(hp => `<option value="${hp.id}" ${h.helperId === hp.id ? 'selected' : ''}>${esc(hp.name)}</option>`).join('')}
        </select>
        <button type="button" class="remove-helper" data-action="remove-helper">&times;</button>
      </div>
      <div class="you-row">
        ${stepperHtml('Helper hours', h.hours)}
        ${pdToggleHtml(h.perDiem)}
      </div>
    </div>`;
}
function editCardHtml(entry) {
  const other = entry.jobId === 'other';
  const yard = isYard(entry.jobId);
  const flat = isFlat(entry.jobId);
  const hrsOn = hoursTracked(entry.jobId);
  return `
    <div class="job-card edit-card" data-entry-uid="${entry.uid}">
      <div class="job-card-top">
        <span class="job-idx">Edit ticket</span>
        <button type="button" class="remove-job" data-action="cancel-edit">&times; Cancel</button>
      </div>
      <label class="field-label">Jobsite</label>
      <select class="input job-select">
        <option value="">Pick your job…</option>
        ${jobs.map(j => `<option value="${j.id}" ${entry.jobId === j.id ? 'selected' : ''}>${esc(j.name)}${j.operator ? ' — ' + esc(j.operator) : ''}${j.is_yard ? ' (yard)' : ''}</option>`).join('')}
        <option value="other" ${other ? 'selected' : ''}>+ Other / one-off job…</option>
      </select>
      ${other ? `
        <div class="oneoff">
          <label class="field-label">Name this one-off job</label>
          <input type="text" class="input oneoff-name-input" placeholder="e.g. Emergency repair — Miller lease" value="${escAttr(entry.oneOffName)}">
        </div>` : ''}
      ${yard ? `
        <div class="oneoff yard">
          <label class="field-label">Which job is this yard work for?</label>
          <select class="input for-job-select">
            <option value="">Pick the job it's for…</option>
            ${jobs.filter(j => !j.is_yard).map(j => `<option value="${j.id}" ${entry.forJobId === j.id ? 'selected' : ''}>${esc(j.name)}${j.operator ? ' — ' + esc(j.operator) : ''}</option>`).join('')}
          </select>
        </div>` : ''}
      <label class="field-label">What did you work on?</label>
      <textarea class="input descr-input" rows="2">${esc(entry.description)}</textarea>
      ${flat ? `
        <div class="oneoff flat">
          <label class="field-label">Parts billed that day</label>
          <div class="parts-list">
            ${entry.parts.map(p => partRowHtml(p)).join('')}
          </div>
          <button type="button" class="add-part" data-action="add-part">+ Add another part</button>
          <div class="parts-total-row">
            <span>Total billed</span>
            <span class="flat-total-value" data-entry-uid="${entry.uid}">$${partsTotal(entry.parts).toLocaleString()}</span>
          </div>
        </div>` : ''}
      <div class="you-row">
        ${hrsOn ? stepperHtml('Your hours', entry.hours) : ''}
        ${pdToggleHtml(entry.perDiem)}
      </div>
      ${entry.helpers.map(h => helperBlockHtml(h)).join('')}
      <button type="button" class="add-helper" data-action="add-helper">+ Add helper</button>
      <div class="edit-card-footer">
        <button type="button" class="btn2 btn2-line small" data-action="delete-entry">Delete ticket</button>
        <button type="button" class="btn2 btn2-solid small" data-action="save-edit">Save changes</button>
      </div>
    </div>`;
}

function entryCardHtml(entry, idx) {
  const other = entry.jobId === 'other';
  const yard = isYard(entry.jobId);
  const flat = isFlat(entry.jobId);
  const hrsOn = hoursTracked(entry.jobId);
  return `
    <div class="job-card" data-entry-uid="${entry.uid}">
      <div class="job-card-top">
        <span class="job-idx">Job ${idx + 1}</span>
        ${entries.length > 1 ? `<button type="button" class="remove-job" data-action="remove-entry">&times; Remove</button>` : ''}
      </div>
      <label class="field-label">Jobsite</label>
      <select class="input job-select">
        <option value="">Pick your job…</option>
        ${jobs.map(j => `<option value="${j.id}" ${entry.jobId === j.id ? 'selected' : ''}>${esc(j.name)}${j.operator ? ' — ' + esc(j.operator) : ''}${j.is_yard ? ' (yard)' : ''}</option>`).join('')}
        <option value="other" ${other ? 'selected' : ''}>+ Other / one-off job…</option>
      </select>
      ${other ? `
        <div class="oneoff">
          <label class="field-label">Name this one-off job</label>
          <input type="text" class="input oneoff-name-input" placeholder="e.g. Emergency repair — Miller lease" value="${escAttr(entry.oneOffName)}">
          <span class="oneoff-note">The office will confirm the operator &amp; bill-to before it's invoiced.</span>
        </div>` : ''}
      ${yard ? `
        <div class="oneoff yard">
          <label class="field-label">Which job is this yard work for?</label>
          <select class="input for-job-select">
            <option value="">Pick the job it's for…</option>
            ${jobs.filter(j => !j.is_yard).map(j => `<option value="${j.id}" ${entry.forJobId === j.id ? 'selected' : ''}>${esc(j.name)}${j.operator ? ' — ' + esc(j.operator) : ''}</option>`).join('')}
          </select>
          <span class="oneoff-note">These hours land on that job's ticket — so your shop time bills to the right customer.</span>
        </div>` : ''}
      <label class="field-label">What did you work on?</label>
      <textarea class="input descr-input" rows="2" placeholder="e.g. Cont. fab on compressor piping">${esc(entry.description)}</textarea>
      ${flat ? `
        <div class="oneoff flat">
          <label class="field-label">Parts billed today</label>
          <span class="oneoff-note" style="margin:0 0 10px;">List each different part you built — quantity &times; rate gets billed to the customer.${hrsOn ? ' Your hours below are still tracked separately for your pay.' : ''}</span>
          <div class="parts-list">
            ${entry.parts.map(p => partRowHtml(p)).join('')}
          </div>
          <button type="button" class="add-part" data-action="add-part">+ Add another part</button>
          <div class="parts-total-row">
            <span>Total billed today</span>
            <span class="flat-total-value" data-entry-uid="${entry.uid}">$${partsTotal(entry.parts).toLocaleString()}</span>
          </div>
        </div>` : ''}
      <div class="you-row">
        ${hrsOn ? stepperHtml('Your hours', entry.hours) : ''}
        ${pdToggleHtml(entry.perDiem)}
      </div>
      ${entry.helpers.map(h => helperBlockHtml(h)).join('')}
      <button type="button" class="add-helper" data-action="add-helper">+ Add helper</button>
    </div>`;
}

function render() {
  entriesContainer.innerHTML = entries.map((entry, idx) => entryCardHtml(entry, idx)).join('');
  updateSubmitState();
}

function updateSubmitState() {
  const total = entries.reduce((sum, e) => sum + Number(e.hours) + e.helpers.reduce((s, h) => s + (h.helperId ? Number(h.hours) : 0), 0), 0);
  totalHoursEl.textContent = total;

  const canSubmit = !!dateInput.value && entries.every(e => {
    if (!e.jobId) return false;
    if (!e.description.trim()) return false;
    if (e.jobId === 'other' && !e.oneOffName.trim()) return false;
    if (isYard(e.jobId) && !e.forJobId) return false;
    if (isFlat(e.jobId) && !e.parts.some(p => p.name.trim() && Number(p.qty) > 0 && Number(p.rate) > 0)) return false;
    return true;
  });
  submitBtn.disabled = !canSubmit;
}

entriesContainer.addEventListener('click', (e) => {
  const entryEl = e.target.closest('[data-entry-uid]');
  if (!entryEl) return;
  const entry = entries.find(x => x.uid === entryEl.dataset.entryUid);
  if (!entry) return;

  if (e.target.closest('[data-action="remove-entry"]')) {
    entries = entries.filter(x => x.uid !== entry.uid);
    render();
    return;
  }
  if (e.target.closest('[data-action="add-helper"]')) {
    entry.helpers.push(newHelperRow());
    render();
    return;
  }
  if (e.target.closest('[data-action="add-part"]')) {
    entry.parts.push(newPart());
    render();
    return;
  }
  const removePartBtn = e.target.closest('[data-action="remove-part"]');
  if (removePartBtn) {
    const partEl = e.target.closest('[data-part-uid]');
    entry.parts = entry.parts.filter(x => x.uid !== partEl.dataset.partUid);
    if (!entry.parts.length) entry.parts.push(newPart());
    render();
    return;
  }

  const stepBtn = e.target.closest('.step-btn');
  if (stepBtn) {
    const helperEl = e.target.closest('[data-helper-uid]');
    const delta = stepBtn.dataset.dir === 'inc' ? 0.5 : -0.5;
    const target = helperEl ? entry.helpers.find(x => x.uid === helperEl.dataset.helperUid) : entry;
    target.hours = Math.max(0, Math.min(24, +(Number(target.hours) + delta).toFixed(1)));
    render();
    return;
  }

  const pdToggle = e.target.closest('.pd-toggle');
  if (pdToggle) {
    const helperEl = e.target.closest('[data-helper-uid]');
    const target = helperEl ? entry.helpers.find(x => x.uid === helperEl.dataset.helperUid) : entry;
    target.perDiem = !target.perDiem;
    render();
    return;
  }

  const removeHelperBtn = e.target.closest('[data-action="remove-helper"]');
  if (removeHelperBtn) {
    const helperEl = e.target.closest('[data-helper-uid]');
    entry.helpers = entry.helpers.filter(x => x.uid !== helperEl.dataset.helperUid);
    render();
    return;
  }
});

entriesContainer.addEventListener('change', (e) => {
  const entryEl = e.target.closest('[data-entry-uid]');
  if (!entryEl) return;
  const entry = entries.find(x => x.uid === entryEl.dataset.entryUid);
  if (!entry) return;

  if (e.target.classList.contains('job-select')) {
    entry.jobId = e.target.value;
    if (entry.jobId !== 'other') entry.oneOffName = '';
    if (!isYard(entry.jobId)) entry.forJobId = '';
    if (!hoursTracked(entry.jobId)) entry.hours = 0;
    render();
    return;
  }
  if (e.target.classList.contains('for-job-select')) {
    entry.forJobId = e.target.value;
    render();
    return;
  }
  const helperEl = e.target.closest('[data-helper-uid]');
  if (helperEl && e.target.classList.contains('helper-select')) {
    const h = entry.helpers.find(x => x.uid === helperEl.dataset.helperUid);
    h.helperId = e.target.value;
    updateSubmitState();
    return;
  }
});

entriesContainer.addEventListener('input', (e) => {
  const entryEl = e.target.closest('[data-entry-uid]');
  if (!entryEl) return;
  const entry = entries.find(x => x.uid === entryEl.dataset.entryUid);
  if (!entry) return;

  if (e.target.classList.contains('descr-input')) {
    entry.description = e.target.value;
    updateSubmitState();
    return;
  }
  if (e.target.classList.contains('oneoff-name-input')) {
    entry.oneOffName = e.target.value;
    updateSubmitState();
    return;
  }
  const partEl = e.target.closest('[data-part-uid]');
  if (partEl) {
    const p = entry.parts.find(x => x.uid === partEl.dataset.partUid);
    if (!p) return;
    if (e.target.classList.contains('part-name-input')) {
      p.name = e.target.value;
      return;
    }
    if (e.target.classList.contains('part-qty-input')) {
      p.qty = e.target.value;
      updatePartTotals(entry);
      return;
    }
    if (e.target.classList.contains('part-rate-input')) {
      p.rate = e.target.value;
      updatePartTotals(entry);
      return;
    }
  }
});

function updatePartTotals(entry) {
  entry.parts.forEach(p => {
    const el = entriesContainer.querySelector(`.part-line-total[data-part-uid="${p.uid}"]`);
    if (el) el.textContent = '$' + partTotal(p).toLocaleString();
  });
  const totalEl = entriesContainer.querySelector(`.flat-total-value[data-entry-uid="${entry.uid}"]`);
  if (totalEl) totalEl.textContent = '$' + partsTotal(entry.parts).toLocaleString();
  updateSubmitState();
}

addJobBtn.addEventListener('click', () => {
  entries.push(newEntry());
  render();
});

dateInput.addEventListener('change', () => {
  updateSubmitState();
});

document.querySelectorAll('#gasOpts .gear-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    gasFlag = btn.dataset.val;
    document.querySelectorAll('#gasOpts .gear-btn').forEach(b => b.classList.toggle('sel', b === btn));
  });
});
document.querySelectorAll('#extOpts .gear-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    extFlag = btn.dataset.val;
    document.querySelectorAll('#extOpts .gear-btn').forEach(b => b.classList.toggle('sel', b === btn));
  });
});
document.getElementById('glovesBtn').addEventListener('click', () => {
  needGloves = !needGloves;
  document.getElementById('glovesBtn').classList.toggle('sel', needGloves);
});
document.getElementById('shieldsBtn').addEventListener('click', () => {
  needShields = !needShields;
  document.getElementById('shieldsBtn').classList.toggle('sel', needShields);
});

async function handleSubmit() {
  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting...';

  const entryDate = dateInput.value || todayIso();

  try {
    for (const entry of entries) {
      const other = entry.jobId === 'other';
      const yard = isYard(entry.jobId);
      const flat = isFlat(entry.jobId);

      const { data: deData, error: deError } = await sb.from('daily_entries').insert({
        welder_id: currentUser.id,
        entry_date: entryDate,
        job_id: other ? null : entry.jobId,
        one_off_name: other ? entry.oneOffName.trim() : null,
        for_job_id: yard ? entry.forJobId : null,
        description: entry.description.trim(),
        hours: entry.hours,
        per_diem: entry.perDiem
      }).select().single();

      if (deError) throw deError;

      const helperRows = entry.helpers
        .filter(h => h.helperId)
        .map(h => ({ daily_entry_id: deData.id, helper_id: h.helperId, hours: h.hours, per_diem: h.perDiem }));

      if (helperRows.length) {
        const { error: heError } = await sb.from('daily_entry_helpers').insert(helperRows);
        if (heError) throw heError;
      }

      if (flat) {
        const partRows = entry.parts
          .filter(p => p.name.trim() && Number(p.qty) > 0 && Number(p.rate) > 0)
          .map(p => ({ daily_entry_id: deData.id, description: p.name.trim(), quantity: Number(p.qty), rate: Number(p.rate) }));
        if (partRows.length) {
          const { error: partError } = await sb.from('daily_entry_parts').insert(partRows);
          if (partError) throw partError;
        }
      }
    }

    if (gasFlag || extFlag || needGloves || needShields) {
      await sb.from('safety_flags').insert({
        welder_id: currentUser.id,
        entry_date: entryDate,
        gas_flag: gasFlag || null,
        ext_flag: extFlag || null,
        need_gloves: needGloves,
        need_shields: needShields
      });
    }

    weekPanelLoaded = false;
    showSuccess();
  } catch (err) {
    console.error(err);
    alert('Something went wrong submitting. Please try again or contact the office.');
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit work";
  }
}

submitBtn.addEventListener('click', handleSubmit);

function showSuccess() {
  document.getElementById('entryScreen').style.display = 'none';
  const successScreen = document.getElementById('successScreen');
  successScreen.style.display = 'block';

  const total = entries.reduce((sum, e) => sum + Number(e.hours) + e.helpers.reduce((s, h) => s + (h.helperId ? Number(h.hours) : 0), 0), 0);

  const receiptBox = document.getElementById('receiptBox');
  receiptBox.innerHTML = `
    <div class="receipt-row2 receipt-head2"><span>${selectedDateLabel()}</span><span>${total} hrs</span></div>
    ${entries.map(e => `
      <div class="receipt-job2">
        <div class="receipt-row2">
          <span class="rj-name2">${esc(jobName(e))}${isYard(e.jobId) && e.forJobId ? ' &rarr; ' + esc(jobs.find(j => j.id === e.forJobId)?.name || '') : ''}</span>
          <span class="rj-hrs2">${hoursTracked(e.jobId) ? e.hours + ' hrs' : ''}${e.perDiem ? ' · PD' : ''}</span>
        </div>
        ${isFlat(e.jobId) ? e.parts.filter(p => p.name.trim() && Number(p.qty) > 0 && Number(p.rate) > 0).map(p => `
          <div class="receipt-row2 receipt-helper2"><span>&#8618; ${esc(p.name)} (${p.qty} &times; $${p.rate})</span><span>$${partTotal(p).toLocaleString()}</span></div>
        `).join('') : ''}
        ${e.helpers.filter(h => h.helperId).map(h => {
          const hp = helpers.find(x => x.id === h.helperId);
          return `<div class="receipt-row2 receipt-helper2"><span>&#8618; ${esc(hp ? hp.name : '')}</span><span>${h.hours} hrs${h.perDiem ? ' · PD' : ''}</span></div>`;
        }).join('')}
      </div>
    `).join('')}
  `;

  const alertBox = document.getElementById('alertSentBox');
  if (gasFlag || extFlag || needGloves || needShields) {
    alertBox.innerHTML = `
      <div class="alert-sent2">
        <div class="alert-sent-head2">Office notified</div>
        ${gasFlag ? `<div class="alert-line2">4-gas monitor — ${gasFlag === 'bump' ? 'needs bump test' : 'out of date, needs replacing'}</div>` : ''}
        ${extFlag ? `<div class="alert-line2">Fire extinguisher — ${extFlag === 'inspect' ? 'needs inspection' : 'no good, needs replacing'}</div>` : ''}
        ${(needGloves || needShields) ? `<div class="alert-line2">Helper PPE needed — ${[needGloves && 'gloves', needShields && 'face shields'].filter(Boolean).join(' & ')}</div>` : ''}
      </div>`;
  } else {
    alertBox.innerHTML = '';
  }
}

document.getElementById('logAnotherBtn').addEventListener('click', () => {
  entries = [newEntry()];
  gasFlag = '';
  extFlag = '';
  needGloves = false;
  needShields = false;
  document.querySelectorAll('#gasOpts .gear-btn, #extOpts .gear-btn').forEach(b => b.classList.remove('sel'));
  document.querySelector('#gasOpts .gear-btn[data-val=""]').classList.add('sel');
  document.querySelector('#extOpts .gear-btn[data-val=""]').classList.add('sel');
  document.getElementById('glovesBtn').classList.remove('sel');
  document.getElementById('shieldsBtn').classList.remove('sel');
  submitBtn.textContent = "Submit work";
  dateInput.value = todayIso();
  document.getElementById('successScreen').style.display = 'none';
  document.getElementById('entryScreen').style.display = 'block';
  render();
});

async function requireAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    window.location.href = 'login.html';
    return null;
  }
  return session.user;
}

(async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  const { data: profile } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
  currentProfile = profile;

  document.getElementById('userName').textContent = currentProfile ? currentProfile.full_name : currentUser.email;
  if (currentProfile && currentProfile.role === 'admin') {
    document.getElementById('adminBadge').style.display = 'inline-block';
    document.getElementById('adminNavLinks').style.display = 'inline';
  }

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await sb.auth.signOut();
    window.location.href = 'login.html';
  });

  dateInput.value = todayIso();
  dateInput.max = todayIso();

  const [{ data: jobsData }, { data: helpersData }] = await Promise.all([
    sb.from('jobs').select('*').eq('active', true).order('name'),
    sb.from('helpers_public').select('*').eq('active', true).order('name')
  ]);
  jobs = jobsData || [];
  helpers = helpersData || [];

  entries = [newEntry()];
  render();
})();
