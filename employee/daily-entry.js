let currentUser = null;
let currentProfile = null;
let jobs = [];
let helpers = [];
let bidItemsByJob = {};   // job_id -> [{id, description, unit}] from bid_items_public
let entries = [];
let gasFlag = '';
let extFlag = '';
let needGloves = false;
let gloveSize = '';
let needShields = false;

const entriesContainer = document.getElementById('entriesContainer');
const totalHoursEl = document.getElementById('totalHours');
const submitBtn = document.getElementById('submitBtn');
const addJobBtn = document.getElementById('addJobBtn');
const dateInput = document.getElementById('dateInput');

function todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
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
function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
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

  const [rowsRes, jwRes] = await Promise.all([
    sb.from('daily_entries').select('*')
      .or(`welder_id.eq.${currentUser.id},supervisor_id.eq.${currentUser.id}`)
      .gte('entry_date', start).lte('entry_date', end).order('entry_date'),
    sb.from('job_weeks').select('*').eq('week_start', start)
  ]);

  // Same trap as the office page had: drop the error and a failed read becomes an
  // empty week. A man who has turned in his hours all week deserves better than a
  // panel calmly telling him he has logged nothing.
  if (rowsRes.error) {
    weekPanelBody.innerHTML = `<div class="week-day-empty">Your week could not be loaded &mdash;
      your hours are still there. ${esc(rowsRes.error.message)}</div>`;
    return;
  }

  const weekEntries = rowsRes.data || [];
  const jwRows = jwRes.data || [];
  weekPanelLockedJobIds = new Set(jwRows.filter(r => r.status === 'approved' || r.status === 'synced').map(r => r.job_id));

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
        <span class="week-entry-hrs">${!e.welder_id ? 'Helpers only' : `${hoursTracked(e.job_id) ? e.hours + ' hrs' : ''}${e.per_diem ? ' · PD' : ''}${e.is_stainless ? ' · Stainless' : ''}`}</span>
      </div>
      ${e.bid_item_id ? `<div class="week-entry-bid">${esc(bidItemName(e.bid_item_id))}</div>` : ''}
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
    entryDate: e.entry_date,
    jobId: e.job_id || (e.one_off_name ? 'other' : ''),
    oneOffName: e.one_off_name || '',
    forJobId: e.for_job_id || '',
    bidItemId: e.bid_item_id || '',
    description: e.description || '',
    hours: Number(e.hours) || 0,
    perDiem: !!e.per_diem,
    stainless: !!e.is_stainless,
    helpersOnly: !e.welder_id,
    helpers: found.helpers.map(h => ({ uid: uid(), helperId: h.helper_id, hours: Number(h.hours), perDiem: !!h.per_diem })),
    parts: found.parts.length ? found.parts.map(p => ({ uid: uid(), name: p.description, qty: p.quantity, rate: p.rate })) : [newPart()],
    // How many child rows are on this ticket in the database right now. Saving
    // clears them and re-inserts; if the clear removes fewer than this, we must
    // not insert or the helper/part lines get duplicated.
    savedHelperCount: found.helpers.length,
    savedPartCount: found.parts.length
  };
  renderWeekPanelBody();
}

async function saveEditEntry(entryId) {
  const other = editState.jobId === 'other';
  const yard = isYard(editState.jobId);
  const flat = isFlat(editState.jobId);

  if (!editState.jobId) { alert('Pick a job.'); return; }
  if (!editState.description.trim()) { alert('Add a description.'); return; }
  if (editState.helpersOnly && !editState.helpers.some(h => h.helperId)) {
    alert('Pick the helper on this ticket, or turn Helpers only off.'); return;
  }
  if (other && !editState.oneOffName.trim()) { alert('Name the one-off job.'); return; }
  if (yard && !editState.forJobId) { alert('Pick which job this yard work is for.'); return; }

  const saveBtn = weekPanelBody.querySelector('[data-action="save-edit"]');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

  try {
    // An edit collides as easily as a new ticket: point this one at the job and
    // hours another ticket on the same day already has, and you have a clean
    // double. The submit path checks for that; this one did not, so a man
    // correcting a mistake could quietly create the very thing he was fixing.
    const sig = dupSigForCard(editState);
    if (sig && editState.entryDate) {
      const { data: sameDay, error: sdErr } = await sb.from('daily_entries')
        .select('id,welder_id,job_id,one_off_name,hours,description')
        .or(`welder_id.eq.${currentUser.id},supervisor_id.eq.${currentUser.id}`)
        .eq('entry_date', editState.entryDate)
        .neq('id', entryId);
      if (sdErr) throw sdErr;
      const clash = (sameDay || []).find((r) => dupSigForRow(r) === sig);
      if (clash) {
        alert('That would make two of the same ticket.\n\n'
          + jobLabelFor(clash)
          + (hoursTracked(clash.job_id) ? ' for ' + Number(clash.hours) + ' hrs' : '')
          + ' is already turned in for ' + dayLabel(editState.entryDate) + '.\n\n'
          + 'Change the hours or the job on this one, or delete the other ticket instead.');
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save changes'; }
        return;
      }
    }

    const helpersOnly = !!editState.helpersOnly;
    const { error: upErr } = await sb.from('daily_entries').update({
      welder_id: helpersOnly ? null : currentUser.id,
      supervisor_id: helpersOnly ? currentUser.id : null,
      job_id: other ? null : editState.jobId,
      one_off_name: other ? editState.oneOffName.trim() : null,
      for_job_id: yard ? editState.forJobId : null,
      bid_item_id: editState.bidItemId || null,
      description: editState.description.trim(),
      hours: helpersOnly ? 0 : editState.hours,
      per_diem: helpersOnly ? false : editState.perDiem,
      is_stainless: helpersOnly ? false : editState.stainless
    }).eq('id', entryId);
    if (upErr) throw upErr;

    // Clear the old helper rows before re-inserting. If this removes fewer rows
    // than the ticket actually has, the clear was refused — bail out rather than
    // insert, or every helper line ends up on the ticket twice.
    const { data: delHelpers, error: dhErr } = await sb.from('daily_entry_helpers')
      .delete().eq('daily_entry_id', entryId).select('id');
    if (dhErr) throw dhErr;
    if ((delHelpers || []).length < (editState.savedHelperCount || 0)) throw new Error('CHILD_DELETE_BLOCKED');

    const helperRows = editState.helpers
      .filter(h => h.helperId)
      .map(h => ({ daily_entry_id: entryId, helper_id: h.helperId, hours: h.hours, per_diem: h.perDiem }));
    if (helperRows.length) {
      const { error: heErr } = await sb.from('daily_entry_helpers').insert(helperRows);
      if (heErr) throw heErr;
    }

    const { data: delParts, error: dpErr } = await sb.from('daily_entry_parts')
      .delete().eq('daily_entry_id', entryId).select('id');
    if (dpErr) throw dpErr;
    if ((delParts || []).length < (editState.savedPartCount || 0)) throw new Error('CHILD_DELETE_BLOCKED');

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
    if (err && err.message === 'CHILD_DELETE_BLOCKED') {
      alert("Your hours were saved, but the helper and parts lines could not be changed.\n\n"
        + "Nothing was doubled up — we stopped before that could happen. Ask the office to fix the helper or parts lines on this ticket.");
      loadWeekPanel();
      return;
    }
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

    // Clear the child rows first: without an ON DELETE CASCADE on these foreign
    // keys, deleting the parent entry fails outright.
    //
    // These two do not need a zero-row check of their own. That missing cascade
    // is what protects them: if either clear is refused, the child rows remain,
    // the parent delete below fails on the foreign key, and that error is caught
    // there. A silent no-op here cannot slip through as a success.
    const { error: helpErr } = await sb.from('daily_entry_helpers').delete().eq('daily_entry_id', entryId);
    if (helpErr) { alert("Could not delete this ticket.\n\n" + helpErr.message + "\n\nTell the office."); return; }
    const { error: partErr } = await sb.from('daily_entry_parts').delete().eq('daily_entry_id', entryId);
    if (partErr) { alert("Could not delete this ticket.\n\n" + partErr.message + "\n\nTell the office."); return; }

    // .select() makes the deleted rows come back, so a delete that silently
    // removed nothing (blocked by a row-level security policy) is detectable
    // instead of looking like it worked.
    const { data: gone, error } = await sb.from('daily_entries').delete().eq('id', entryId).select('id');
    if (error) { alert("Could not delete this ticket.\n\n" + error.message + "\n\nTell the office."); return; }
    if (!gone || gone.length === 0) {
      alert("This ticket could not be deleted.\n\nYou may not have permission to remove it, or the office already picked it up. Ask the office to delete it for you.");
      loadWeekPanel();
      return;
    }

    editingEntryUid = null;
    editState = null;
    loadWeekPanel();
    loadLoggedForDate();  // it's no longer turned in, so let them log it again
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
  if (e.target.closest('[data-action="toggle-helpers-only"]')) {
    editState.helpersOnly = !editState.helpersOnly;
    if (editState.helpersOnly && !editState.helpers.length) editState.helpers.push(newHelperRow());
    renderWeekPanelBody();
    return;
  }
  const stainlessToggle = e.target.closest('.stainless-toggle');
  if (stainlessToggle) {
    editState.stainless = !editState.stainless;
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
    editState.stainless = false;
    editState.bidItemId = '';
    renderWeekPanelBody();
    return;
  }
  if (e.target.classList.contains('for-job-select')) {
    editState.forJobId = e.target.value;
    editState.bidItemId = '';
    renderWeekPanelBody();
    return;
  }
  if (e.target.classList.contains('bid-item-select')) {
    editState.bidItemId = e.target.value;
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
  return { uid: uid(), jobId: '', oneOffName: '', forJobId: '', bidItemId: '', description: '', hours: 10, perDiem: true, stainless: false, helpersOnly: false, helpers: [], parts: [newPart()] };
}

// A card for a day the helpers worked and you did not. Your hours, per diem,
// stainless and parts all come off it, because they are yours and you were not
// there; what is left is the job, what was done, and who did it.
function helpersOnlyToggleHtml(on) {
  return `<button type="button" class="ho-toggle${on ? ' ho-on' : ''}" data-action="toggle-helpers-only">
    <span class="pd-knob"></span><span class="pd-text">Helpers only<br><b>${on ? 'ON' : 'OFF'}</b></span></button>`;
}

/* ---- Duplicate ticket guard ----
   Stops the same job being turned in twice for the same day. For jobs that
   track hours, "the same" means same job + same hours. Flat-rate jobs don't
   track hours (they'd all look like 0), so there we compare the description
   instead — otherwise a second legitimate flat entry would get blocked. */
let loggedForDate = [];      // entries already saved for the date in the picker
let loggedForDateKey = '';   // the date loggedForDate belongs to

function jobKeyFor(jobId, oneOffName) {
  return jobId === 'other' || !jobId
    ? 'other:' + (oneOffName || '').trim().toLowerCase()
    : 'job:' + jobId;
}
// A helpers-only ticket carries no hours of his own, so on an hours-tracked job
// every one of them would sign as "0 hrs" and collide with his own ticket and
// with each other. They get their own key, off the description, which still
// catches the double-tap it is there to catch.
function dupSigForCard(entry) {
  if (!entry.jobId) return null;
  if (entry.jobId === 'other' && !entry.oneOffName.trim()) return null;
  const key = jobKeyFor(entry.jobId, entry.oneOffName);
  if (entry.helpersOnly) return 'ho:' + key + '|d:' + entry.description.trim().toLowerCase();
  return hoursTracked(entry.jobId)
    ? key + '|h:' + Number(entry.hours)
    : key + '|d:' + entry.description.trim().toLowerCase();
}
function dupSigForRow(row) {
  const key = jobKeyFor(row.job_id || 'other', row.one_off_name);
  if (!row.welder_id) return 'ho:' + key + '|d:' + (row.description || '').trim().toLowerCase();
  return hoursTracked(row.job_id)
    ? key + '|h:' + Number(row.hours)
    : key + '|d:' + (row.description || '').trim().toLowerCase();
}

async function loadLoggedForDate() {
  const d = dateInput.value;
  loggedForDateKey = d;
  loggedForDate = [];
  if (!d || !currentUser) { updateSubmitState(); return; }
  const { data } = await sb.from('daily_entries')
    .select('id,welder_id,job_id,one_off_name,hours,description')
    .or(`welder_id.eq.${currentUser.id},supervisor_id.eq.${currentUser.id}`)
    .eq('entry_date', d);
  if (dateInput.value !== d) return;  // they changed the date while this was in flight
  loggedForDate = data || [];
  updateSubmitState();
}

// Returns { uids:Set of duplicate cards, msg:short reason } for the current form.
function findDuplicates() {
  const uids = new Set();
  let msg = '';
  const seen = new Map();
  const savedSigs = (loggedForDateKey && loggedForDateKey === dateInput.value)
    ? new Set(loggedForDate.map(dupSigForRow))
    : new Set();

  for (const e of entries) {
    const sig = dupSigForCard(e);
    if (!sig) continue;
    if (savedSigs.has(sig)) {
      uids.add(e.uid);
      if (!msg) msg = 'You already turned in ' + jobName(e) + ' for this day.';
    }
    if (seen.has(sig)) {
      uids.add(e.uid);
      uids.add(seen.get(sig));
      if (!msg) msg = jobName(e) + ' is on this form twice.';
    } else {
      seen.set(sig, e.uid);
    }
  }
  return { uids, msg };
}

function dupBannerHtml(entry, kind) {
  const hrs = hoursTracked(entry.jobId) ? Number(entry.hours) + ' hrs' : '';
  if (kind === 'form') {
    return '<b>&#9888; You put this job on here twice</b>'
      + '<span>' + esc(jobName(entry)) + (hrs ? ' &mdash; ' + hrs : '')
      + ' is already on this form. Hit &times; Remove on one of them.</span>';
  }
  return '<b>&#9888; You already turned this in</b>'
    + '<span>' + esc(jobName(entry)) + (hrs ? ' for ' + hrs : '') + ' is already turned in for '
    + selectedDateLabel() + '. You do not need to send it again.</span>'
    + '<span>If the hours were wrong, open <b>This week</b> below and hit <b>Edit</b> on it.</span>';
}
function newHelperRow() {
  return { uid: uid(), helperId: '', hours: 10, perDiem: true };
}
function newPart() {
  return { uid: uid(), name: '', qty: 1, rate: '' };
}
function partTotal(p) { return Number(p.qty || 0) * Number(p.rate || 0); }
function partsTotal(parts) { return parts.reduce((s, p) => s + partTotal(p), 0); }
// Yard work booked against another job should offer THAT job's bid items.
function bidJobIdFor(entry) {
  return isYard(entry.jobId) ? entry.forJobId : entry.jobId;
}
function bidItemsFor(entry) {
  const jid = bidJobIdFor(entry);
  return (jid && bidItemsByJob[jid]) || [];
}
function bidItemName(id) {
  for (const list of Object.values(bidItemsByJob)) {
    const hit = list.find(b => b.id === id);
    if (hit) return hit.description;
  }
  return 'Bid item';
}
function bidPickerHtml(entry) {
  const items = bidItemsFor(entry);
  if (!items.length) return '';
  const job = jobs.find(j => j.id === bidJobIdFor(entry));
  return `
    <div class="oneoff bid">
      <label class="field-label">Which bid item were you on?</label>
      <select class="input bid-item-select">
        <option value="">Not one of these &mdash; general work</option>
        ${items.map(b => `<option value="${b.id}" ${entry.bidItemId === b.id ? 'selected' : ''}>${esc(b.description)}</option>`).join('')}
      </select>
      <span class="oneoff-note">${esc((job && job.name) || 'This customer')} has more than one job bid.
      Picking the right one keeps the hours on the right bid.</span>
    </div>`;
}

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
function stainlessToggleHtml(on) {
  return `<button type="button" class="stainless-toggle${on ? ' stainless-on' : ''}" data-action="toggle-stainless"><span class="pd-knob"></span><span class="pd-text">Stainless<br><b>${on ? 'ON' : 'OFF'}</b></span></button>`;
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
      ${bidPickerHtml(entry)}
      <label class="field-label">What did you work on?</label>
      <textarea class="input descr-input" rows="2">${esc(entry.description)}</textarea>
      ${flat && !entry.helpersOnly ? `
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
        ${entry.helpersOnly ? '' : `
          ${hrsOn ? stepperHtml('Your hours', entry.hours) : ''}
          ${pdToggleHtml(entry.perDiem)}
          ${stainlessToggleHtml(entry.stainless)}`}
        ${helpersOnlyToggleHtml(entry.helpersOnly)}
      </div>
      ${entry.helpersOnly ? '<span class="oneoff-note ho-note">You are not on this ticket — it is the helpers\' day only. The office will see you turned it in.</span>' : ''}
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
      <div class="dup-warn" data-dup-for="${entry.uid}"></div>
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
      ${bidPickerHtml(entry)}
      <label class="field-label">What did you work on?</label>
      <textarea class="input descr-input" rows="2" placeholder="e.g. Cont. fab on compressor piping">${esc(entry.description)}</textarea>
      ${flat && !entry.helpersOnly ? `
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
        ${entry.helpersOnly ? '' : `
          ${hrsOn ? stepperHtml('Your hours', entry.hours) : ''}
          ${pdToggleHtml(entry.perDiem)}
          ${stainlessToggleHtml(entry.stainless)}`}
        ${helpersOnlyToggleHtml(entry.helpersOnly)}
      </div>
      ${entry.helpersOnly ? '<span class="oneoff-note ho-note">You are not on this ticket — it is the helpers\' day only. The office will see you turned it in.</span>' : ''}
      ${entry.helpers.map(h => helperBlockHtml(h)).join('')}
      <button type="button" class="add-helper" data-action="add-helper">+ Add helper</button>
    </div>`;
}

function render() {
  entriesContainer.innerHTML = entries.map((entry, idx) => entryCardHtml(entry, idx)).join('');
  updateSubmitState();
}

function updateSubmitState() {
  // His own hours are zero on a helpers-only card whatever the stepper last held,
  // so the day's total counts the helpers on it and nothing of his.
  const total = entries.reduce((sum, e) =>
    sum + (e.helpersOnly ? 0 : Number(e.hours))
        + e.helpers.reduce((s, h) => s + (h.helperId ? Number(h.hours) : 0), 0), 0);
  totalHoursEl.textContent = total;

  let missing = '';
  if (!dateInput.value) missing = 'Pick a date.';
  else if (dateInput.value < dateInput.min || dateInput.value > dateInput.max) missing = 'Pick a date within this work week.';
  else {
    for (const e of entries) {
      if (!e.jobId) { missing = 'Pick a jobsite for every entry.'; break; }
      if (e.jobId === 'other' && !e.oneOffName.trim()) { missing = 'Name the one-off job.'; break; }
      if (isYard(e.jobId) && !e.forJobId) { missing = 'Pick which job the yard work is for.'; break; }
      if (!e.description.trim()) { missing = 'Add a description of the work for every entry.'; break; }
      if (e.helpersOnly && !e.helpers.some(h => h.helperId)) { missing = 'Pick the helper on the helpers-only ticket.'; break; }
    }
    if (!missing && needGloves && !gloveSize) missing = 'Pick a glove size.';
  }

  // Duplicate tickets: flag the offending cards and block Submit outright.
  const dup = findDuplicates();
  const savedSigs = (loggedForDateKey === dateInput.value)
    ? new Set(loggedForDate.map(dupSigForRow))
    : new Set();
  entries.forEach(e => {
    const el = entriesContainer.querySelector(`[data-dup-for="${e.uid}"]`);
    if (!el) return;
    if (!dup.uids.has(e.uid)) { el.innerHTML = ''; el.classList.remove('on'); return; }
    el.innerHTML = dupBannerHtml(e, savedSigs.has(dupSigForCard(e)) ? 'saved' : 'form');
    el.classList.add('on');
  });
  if (dup.msg) missing = dup.msg;

  submitBtn.disabled = !!missing;
  const hintEl = document.getElementById('submitHint');
  if (hintEl) hintEl.textContent = missing;
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

  if (e.target.closest('[data-action="toggle-helpers-only"]')) {
    entry.helpersOnly = !entry.helpersOnly;
    // Turning it on with nobody on the ticket leaves a card that cannot be
    // submitted and no obvious reason why, so put a helper row there to fill in.
    if (entry.helpersOnly && !entry.helpers.length) entry.helpers.push(newHelperRow());
    render();
    return;
  }
  const stainlessToggle = e.target.closest('.stainless-toggle');
  if (stainlessToggle) {
    entry.stainless = !entry.stainless;
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
    entry.stainless = false;
    entry.bidItemId = '';        // a different job means a different bid list
    render();
    return;
  }
  if (e.target.classList.contains('for-job-select')) {
    entry.forJobId = e.target.value;
    entry.bidItemId = '';
    render();
    return;
  }
  if (e.target.classList.contains('bid-item-select')) {
    entry.bidItemId = e.target.value;
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
  loadLoggedForDate();
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
  document.getElementById('gloveSizeRow').style.display = needGloves ? 'flex' : 'none';
  if (!needGloves) {
    gloveSize = '';
    document.querySelectorAll('.glove-size-btn').forEach(b => b.classList.remove('sel'));
  }
  updateSubmitState();
});
document.querySelectorAll('.glove-size-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    gloveSize = btn.dataset.size;
    document.querySelectorAll('.glove-size-btn').forEach(b => b.classList.toggle('sel', b === btn));
    updateSubmitState();
  });
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
    // Last line of defence: re-check the server right before inserting, in case
    // this day was already turned in from another device or on a double-tap.
    const { data: freshRows, error: freshErr } = await sb.from('daily_entries')
      .select('id,welder_id,job_id,one_off_name,hours,description')
      .or(`welder_id.eq.${currentUser.id},supervisor_id.eq.${currentUser.id}`)
      .eq('entry_date', entryDate);
    if (freshErr) throw freshErr;
    loggedForDate = freshRows || [];
    loggedForDateKey = entryDate;
    const freshSigs = new Set(loggedForDate.map(dupSigForRow));
    const clash = entries.find(e => {
      const s = dupSigForCard(e);
      return s && freshSigs.has(s);
    });
    if (clash) {
      alert('This is already turned in.\n\n' + jobName(clash)
        + (hoursTracked(clash.jobId) ? ' for ' + Number(clash.hours) + ' hrs' : '')
        + ' is already on ' + selectedDateLabel() + '.\n\n'
        + 'You do not need to send it again. If the hours were wrong, open "This week" and hit Edit.');
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit work";
      render();
      return;
    }

    for (const entry of entries) {
      const other = entry.jobId === 'other';
      const yard = isYard(entry.jobId);
      const flat = isFlat(entry.jobId);

      // On a helpers-only ticket he is the supervisor, not the welder: no hours,
      // no per diem, nothing stainless, because none of that is his. supervisor_id
      // is only so the ticket stays visible to the man who turned it in.
      const helpersOnly = !!entry.helpersOnly;
      const { data: deData, error: deError } = await sb.from('daily_entries').insert({
        welder_id: helpersOnly ? null : currentUser.id,
        supervisor_id: helpersOnly ? currentUser.id : null,
        entry_date: entryDate,
        job_id: other ? null : entry.jobId,
        one_off_name: other ? entry.oneOffName.trim() : null,
        for_job_id: yard ? entry.forJobId : null,
        bid_item_id: entry.bidItemId || null,
        description: entry.description.trim(),
        hours: helpersOnly ? 0 : entry.hours,
        per_diem: helpersOnly ? false : entry.perDiem,
        is_stainless: helpersOnly ? false : entry.stainless
      }).select().single();

      if (deError) throw deError;

      const helperRows = entry.helpers
        .filter(h => h.helperId)
        .map(h => ({ daily_entry_id: deData.id, helper_id: h.helperId, hours: h.hours, per_diem: h.perDiem }));

      if (helperRows.length) {
        const { error: heError } = await sb.from('daily_entry_helpers').insert(helperRows);
        if (heError) throw heError;
      }

      if (flat && !helpersOnly) {
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
        gloves_size: needGloves ? gloveSize : null,
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
          <span class="rj-hrs2">${hoursTracked(e.jobId) ? e.hours + ' hrs' : ''}${e.perDiem ? ' · PD' : ''}${e.stainless ? ' · Stainless' : ''}</span>
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
        ${(needGloves || needShields) ? `<div class="alert-line2">Helper PPE needed — ${[needGloves && `gloves (size ${gloveSize})`, needShields && 'face shields'].filter(Boolean).join(' & ')}</div>` : ''}
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
  gloveSize = '';
  needShields = false;
  document.querySelectorAll('#gasOpts .gear-btn, #extOpts .gear-btn').forEach(b => b.classList.remove('sel'));
  document.querySelector('#gasOpts .gear-btn[data-val=""]').classList.add('sel');
  document.querySelector('#extOpts .gear-btn[data-val=""]').classList.add('sel');
  document.getElementById('glovesBtn').classList.remove('sel');
  document.getElementById('shieldsBtn').classList.remove('sel');
  document.getElementById('gloveSizeRow').style.display = 'none';
  document.querySelectorAll('.glove-size-btn').forEach(b => b.classList.remove('sel'));
  submitBtn.textContent = "Submit work";
  dateInput.value = todayIso();
  dateInput.max = todayIso();
  dateInput.min = ymd(getMonday(new Date()));
  document.getElementById('successScreen').style.display = 'none';
  document.getElementById('entryScreen').style.display = 'block';
  render();
  loadLoggedForDate();  // what they just submitted now counts as already turned in
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
  dateInput.min = ymd(getMonday(new Date()));

  const [{ data: jobsData }, { data: helpersData }, { data: bidData }] = await Promise.all([
    sb.from('jobs').select('*').eq('active', true).order('name'),
    sb.from('helpers_public').select('*').eq('active', true).order('name'),
    sb.from('bid_items_public').select('*').order('sort_order')
  ]);
  jobs = jobsData || [];
  helpers = helpersData || [];
  bidItemsByJob = {};
  (bidData || []).forEach(b => { (bidItemsByJob[b.job_id] ||= []).push(b); });

  entries = [newEntry()];
  render();
  loadLoggedForDate();

  // Only the saved-work views, never `render()` — that would clear the entries
  // the welder is part way through typing.
  await liveData({
    reload: async () => {
      await loadWeekPanel();
      await loadLoggedForDate();
    },
    isBusy: () => editingEntryUid !== null,
    tables: ['daily_entries', 'job_weeks'],
    channel: 'daily-entry'
  });
})();
