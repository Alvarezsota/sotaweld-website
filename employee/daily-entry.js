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

function uid() { return Math.random().toString(36).slice(2); }
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
function escAttr(str) { return esc(str).replace(/"/g, '&quot;'); }

function newEntry() {
  return { uid: uid(), jobId: '', oneOffName: '', forJobId: '', description: '', hours: 10, perDiem: true, helpers: [] };
}
function newHelperRow() {
  return { uid: uid(), helperId: '', hours: 10, perDiem: true };
}
function isYard(jobId) {
  const j = jobs.find(x => x.id === jobId);
  return !!(j && j.is_yard);
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
function entryCardHtml(entry, idx) {
  const other = entry.jobId === 'other';
  const yard = isYard(entry.jobId);
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
      <div class="you-row">
        ${stepperHtml('Your hours', entry.hours)}
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
});

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
          <span class="rj-hrs2">${e.hours} hrs${e.perDiem ? ' · PD' : ''}</span>
        </div>
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
