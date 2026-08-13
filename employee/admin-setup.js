let currentUser = null;
let jobsList = [];
let weldersList = [];
let helpersList = [];

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
function escAttr(str) { return esc(str).replace(/"/g, '&quot;'); }
function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

async function requireAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    window.location.href = 'login.html';
    return null;
  }
  return session.user;
}

// ---------- Jobs ----------
function renderJobs() {
  const table = document.getElementById('jobsTable');
  table.innerHTML = jobsList.map(j => `
    <div class="jt-row${j.active ? '' : ' off'}" data-job-id="${j.id}">
      <input class="cell-in strong job-name" value="${escAttr(j.name)}" placeholder="Job name">
      <input class="cell-in job-operator" value="${escAttr(j.operator || '')}" placeholder="Operator">
      <input class="cell-in job-bill" value="${escAttr(j.bill_to || '')}" placeholder="Set bill-to…">
      <div class="c pd-cell"><span class="pd-dollar">$</span><input class="cell-in num job-pd" value="${escAttr(j.per_diem)}"></div>
      <div class="c pd-cell billrate-cell"><span class="pd-dollar">$</span><input class="cell-in num job-billrate" value="${escAttr(j.bill_rate)}" placeholder="Default" title="Override the welder's normal bill rate for this job. Leave blank to use their default rate."></div>
      <div class="c pd-cell stainless-cell"><span class="pd-dollar">$</span><input class="cell-in num job-stainless" value="${escAttr(j.stainless_bill_rate)}" title="Bill rate per hour when a welder flags stainless work on this job"></div>
      <div class="c"><button type="button" class="toggle2${j.billing_type === 'flat' ? ' ton' : ''}" data-action="toggle-flat" title="Flat rate job (billed a flat dollar amount instead of by the hour)"><span class="tk2"></span></button></div>
      <div class="c"><button type="button" class="toggle2${j.track_hours ? ' ton' : ''}" data-action="toggle-hours" title="Track hours on this job's daily log"><span class="tk2"></span></button></div>
      <div class="c"><button type="button" class="toggle2${j.active ? ' ton' : ''}" data-action="toggle-active"><span class="tk2"></span></button></div>
      <button type="button" class="row-x" data-action="delete-job">&times;</button>
    </div>
  `).join('');
}

async function loadJobs() {
  const { data } = await sb.from('jobs').select('*').order('name');
  jobsList = data || [];
  renderJobs();
}

document.getElementById('jobsTable').addEventListener('blur', async (e) => {
  const row = e.target.closest('[data-job-id]');
  if (!row) return;
  const id = row.dataset.jobId;
  const job = jobsList.find(j => j.id === id);
  if (!job) return;

  let patch = null;
  if (e.target.classList.contains('job-name')) patch = { name: e.target.value.trim() };
  else if (e.target.classList.contains('job-operator')) patch = { operator: e.target.value.trim() };
  else if (e.target.classList.contains('job-bill')) patch = { bill_to: e.target.value.trim() };
  else if (e.target.classList.contains('job-pd')) patch = { per_diem: num(e.target.value) };
  else if (e.target.classList.contains('job-billrate')) patch = { bill_rate: e.target.value.trim() === '' ? null : num(e.target.value) };
  else if (e.target.classList.contains('job-stainless')) patch = { stainless_bill_rate: num(e.target.value) };
  if (!patch) return;

  Object.assign(job, patch);
  await sb.from('jobs').update(patch).eq('id', id);
}, true);

document.getElementById('jobsTable').addEventListener('click', async (e) => {
  const row = e.target.closest('[data-job-id]');
  if (!row) return;
  const id = row.dataset.jobId;
  const job = jobsList.find(j => j.id === id);
  if (!job) return;

  if (e.target.closest('[data-action="toggle-active"]')) {
    job.active = !job.active;
    renderJobs();
    await sb.from('jobs').update({ active: job.active }).eq('id', id);
    return;
  }
  if (e.target.closest('[data-action="toggle-flat"]')) {
    job.billing_type = job.billing_type === 'flat' ? 'hourly' : 'flat';
    renderJobs();
    await sb.from('jobs').update({ billing_type: job.billing_type }).eq('id', id);
    return;
  }
  if (e.target.closest('[data-action="toggle-hours"]')) {
    job.track_hours = !job.track_hours;
    renderJobs();
    await sb.from('jobs').update({ track_hours: job.track_hours }).eq('id', id);
    return;
  }
  if (e.target.closest('[data-action="delete-job"]')) {
    if (!confirm(`Delete "${job.name}"? This can't be undone.`)) return;
    await sb.from('jobs').delete().eq('id', id);
    jobsList = jobsList.filter(j => j.id !== id);
    renderJobs();
  }
});

document.getElementById('addJobBtn').addEventListener('click', async () => {
  const { data, error } = await sb.from('jobs').insert({ name: 'New Job', per_diem: 100, stainless_bill_rate: 125 }).select().single();
  if (error) { console.error(error); return; }
  jobsList.push(data);
  renderJobs();
});

// ---------- Welders (profiles) ----------
let passwordEditId = null;
const ADMIN_SET_PASSWORD_URL = 'https://woqzbterwialanccprhp.supabase.co/functions/v1/admin-set-password';

function renderWelders() {
  const table = document.getElementById('weldersTable');
  document.getElementById('welderCount').textContent = weldersList.length;
  table.innerHTML = weldersList.map(p => `
    <div class="p-row welders-row-grid" data-profile-id="${p.id}">
      <div>
        <input class="cell-in strong welder-name" value="${escAttr(p.full_name)}" placeholder="Name">
      </div>
      <div class="c rate"><span class="rd">$</span><input class="cell-in num welder-pay" value="${escAttr(p.pay_rate)}"></div>
      <div class="c rate"><span class="rd">$</span><input class="cell-in num welder-bill" value="${escAttr(p.bill_rate)}"></div>
      <span class="c margin-cell">$${(num(p.bill_rate) - num(p.pay_rate)).toFixed(0)}</span>
      <span class="c">${p.role === 'admin' ? '<span class="admin-tag">Admin</span>' : ''}</span>
      <span class="c"><button type="button" class="pw-btn" data-action="toggle-password">${passwordEditId === p.id ? 'Cancel' : 'Set password'}</button></span>
    </div>
    ${passwordEditId === p.id ? `
      <div class="pw-panel" data-profile-id="${p.id}">
        <label class="field-label">New password for ${esc(p.full_name)}</label>
        <div class="pw-panel-row">
          <input type="text" class="input pw-input" placeholder="At least 6 characters" autocomplete="off">
          <button type="button" class="btn2 btn2-solid small" data-action="save-password">Save</button>
        </div>
        <p class="pw-note">They can log in with this right away — no email or link needed. Tell them the new password directly.</p>
        <p class="pw-status"></p>
      </div>` : ''}
  `).join('');
}

document.getElementById('weldersTable').addEventListener('click', async (e) => {
  const toggleBtn = e.target.closest('[data-action="toggle-password"]');
  if (toggleBtn) {
    const row = e.target.closest('[data-profile-id]');
    passwordEditId = passwordEditId === row.dataset.profileId ? null : row.dataset.profileId;
    renderWelders();
    return;
  }
  const saveBtn = e.target.closest('[data-action="save-password"]');
  if (saveBtn) {
    const panel = e.target.closest('[data-profile-id]');
    const welderId = panel.dataset.profileId;
    const input = panel.querySelector('.pw-input');
    const statusEl = panel.querySelector('.pw-status');
    const newPassword = input.value;

    if (newPassword.length < 6) {
      statusEl.textContent = 'Password must be at least 6 characters.';
      statusEl.className = 'pw-status pw-err';
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    statusEl.textContent = '';

    try {
      const { data: { session } } = await sb.auth.getSession();
      const res = await fetch(ADMIN_SET_PASSWORD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ welderId, newPassword })
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to set password');

      statusEl.textContent = 'Password set. They can log in with it now.';
      statusEl.className = 'pw-status pw-ok';
      saveBtn.textContent = 'Save';
      saveBtn.disabled = false;
    } catch (err) {
      statusEl.textContent = 'Could not set password: ' + err.message;
      statusEl.className = 'pw-status pw-err';
      saveBtn.textContent = 'Save';
      saveBtn.disabled = false;
    }
  }
});

async function loadWelders() {
  const { data } = await sb.from('profiles').select('*').order('full_name');
  weldersList = data || [];
  renderWelders();
}

document.getElementById('weldersTable').addEventListener('blur', async (e) => {
  const row = e.target.closest('[data-profile-id]');
  if (!row) return;
  const id = row.dataset.profileId;
  const p = weldersList.find(x => x.id === id);
  if (!p) return;

  let patch = null;
  if (e.target.classList.contains('welder-name')) patch = { full_name: e.target.value.trim() };
  else if (e.target.classList.contains('welder-pay')) patch = { pay_rate: num(e.target.value) };
  else if (e.target.classList.contains('welder-bill')) patch = { bill_rate: num(e.target.value) };
  if (!patch) return;

  Object.assign(p, patch);
  renderWelders();
  await sb.from('profiles').update(patch).eq('id', id);
}, true);

// ---------- Helpers ----------
function renderHelpers() {
  const table = document.getElementById('helpersTable');
  document.getElementById('helperCount').textContent = helpersList.length;
  table.innerHTML = helpersList.map(h => `
    <div class="p-row helpers-row-grid${h.active ? '' : ' off'}" data-helper-id="${h.id}">
      <input class="cell-in strong helper-name" value="${escAttr(h.name)}" placeholder="Name">
      <div class="c rate"><span class="rd">$</span><input class="cell-in num helper-pay" value="${escAttr(h.pay_rate)}"></div>
      <div class="c rate"><span class="rd">$</span><input class="cell-in num helper-bill" value="${escAttr(h.bill_rate)}"></div>
      <span class="c margin-cell">$${(num(h.bill_rate) - num(h.pay_rate)).toFixed(0)}</span>
      <div class="c"><button type="button" class="toggle2${h.active ? ' ton' : ''}" data-action="toggle-active"><span class="tk2"></span></button></div>
      <button type="button" class="row-x" data-action="delete-helper">&times;</button>
    </div>
  `).join('');
}

async function loadHelpers() {
  const { data } = await sb.from('helpers').select('*').order('name');
  helpersList = data || [];
  renderHelpers();
}

document.getElementById('helpersTable').addEventListener('blur', async (e) => {
  const row = e.target.closest('[data-helper-id]');
  if (!row) return;
  const id = row.dataset.helperId;
  const h = helpersList.find(x => x.id === id);
  if (!h) return;

  let patch = null;
  if (e.target.classList.contains('helper-name')) patch = { name: e.target.value.trim() };
  else if (e.target.classList.contains('helper-pay')) patch = { pay_rate: num(e.target.value) };
  else if (e.target.classList.contains('helper-bill')) patch = { bill_rate: num(e.target.value) };
  if (!patch) return;

  Object.assign(h, patch);
  await sb.from('helpers').update(patch).eq('id', id);
}, true);

document.getElementById('helpersTable').addEventListener('click', async (e) => {
  const row = e.target.closest('[data-helper-id]');
  if (!row) return;
  const id = row.dataset.helperId;
  const h = helpersList.find(x => x.id === id);
  if (!h) return;

  if (e.target.closest('[data-action="toggle-active"]')) {
    h.active = !h.active;
    renderHelpers();
    await sb.from('helpers').update({ active: h.active }).eq('id', id);
    return;
  }
  if (e.target.closest('[data-action="delete-helper"]')) {
    if (!confirm(`Delete "${h.name}"? This can't be undone.`)) return;
    await sb.from('helpers').delete().eq('id', id);
    helpersList = helpersList.filter(x => x.id !== id);
    renderHelpers();
  }
});

document.getElementById('addHelperBtn').addEventListener('click', async () => {
  const { data, error } = await sb.from('helpers').insert({ name: 'New Helper', pay_rate: 18, bill_rate: 25 }).select().single();
  if (error) { console.error(error); return; }
  helpersList.push(data);
  renderHelpers();
});

// ---------- Tabs ----------
document.getElementById('tabJobsBtn').addEventListener('click', () => {
  document.getElementById('tabJobsBtn').classList.add('on');
  document.getElementById('tabPeopleBtn').classList.remove('on');
  document.getElementById('jobsPanel').style.display = 'block';
  document.getElementById('peoplePanel').style.display = 'none';
});
document.getElementById('tabPeopleBtn').addEventListener('click', () => {
  document.getElementById('tabPeopleBtn').classList.add('on');
  document.getElementById('tabJobsBtn').classList.remove('on');
  document.getElementById('peoplePanel').style.display = 'block';
  document.getElementById('jobsPanel').style.display = 'none';
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

  await Promise.all([loadJobs(), loadWelders(), loadHelpers()]);
})();
