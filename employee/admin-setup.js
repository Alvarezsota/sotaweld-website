let currentUser = null;
let jobsList = [];
let bidItemsByJob = {};   // job_id -> rows from job_bid_items
let openBidJobId = null; // which lump sum job has its bid panel open
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
      <input class="cell-in bid job-bidnum" value="${escAttr(j.bid_number || '')}" placeholder="Bid #" title="Your bid or quote number for this job. Optional, works on any job, and prints on the invoice.">
      <div class="c pd-cell"><span class="pd-dollar">$</span><input class="cell-in num job-pd" value="${escAttr(j.per_diem)}"></div>
      <div class="c pd-cell billrate-cell"><span class="pd-dollar">$</span><input class="cell-in num job-billrate" value="${escAttr(j.bill_rate)}" placeholder="Default" title="Override the welder's normal bill rate for this job. Leave blank to use their default rate."></div>
      <div class="c pd-cell stainless-cell"><span class="pd-dollar">$</span><input class="cell-in num job-stainless" value="${escAttr(j.stainless_bill_rate)}" title="Bill rate per hour when a welder flags stainless work on this job"></div>
      <div class="c"><button type="button" class="toggle2${j.billing_type === 'flat' ? ' ton' : ''}" data-action="toggle-flat" title="Lump sum job — bid as a price instead of billed by the hour. Bill it off bid line items on the Summary page."><span class="tk2"></span></button></div>
      <div class="c"><button type="button" class="toggle2${j.track_hours ? ' ton' : ''}" data-action="toggle-hours" title="Track hours on this job's daily log"><span class="tk2"></span></button></div>
      <div class="c"><button type="button" class="toggle2${j.active ? ' ton' : ''}" data-action="toggle-active"><span class="tk2"></span></button></div>
      <button type="button" class="row-x" data-action="delete-job">&times;</button>
    </div>
    ${bidPanelHtml(j)}
  `).join('');
}

// ---------- Bid items ----------
// What you bid, entered once per job. Works on ANY job, hourly or lump sum:
//   - lump sum: the Summary page bills it by marking how many of each line got
//     finished in a given week.
//   - hourly: the lines are how the crew says which of that customer's bids they
//     were on, so several bids under one customer stay separated.
function bidPanelHtml(job) {
  const open = openBidJobId === job.id;
  const items = bidItemsByJob[job.id];
  const contract = (items || []).reduce((a, i) => a + Number(i.qty_bid || 0) * Number(i.unit_price || 0), 0);

  if (!open) {
    return `<div class="bid-strip" data-job-id="${job.id}">
      <button type="button" class="bid-toggle" data-action="open-bid">Bid items${
        items ? ` (${items.length})` : ''}</button>
      ${items && items.length ? `<span class="bid-strip-total">Contract ${moneyFmt(contract)}</span>` : ''}
    </div>`;
  }

  const rows = (items || []).map(i => `
    <div class="bid-line" data-bid-id="${i.id}">
      <input class="cell-in bid-desc" value="${escAttr(i.description)}" placeholder="What you bid">
      <div class="c"><input class="cell-in num bid-qty" value="${escAttr(i.qty_bid)}" title="How many you bid"></div>
      <input class="cell-in bid-unit" value="${escAttr(i.unit)}" placeholder="ea">
      <div class="c pd-cell"><span class="pd-dollar">$</span><input class="cell-in num bid-price" value="${escAttr(i.unit_price)}" title="Price each"></div>
      <span class="c bid-line-total">${moneyFmt(Number(i.qty_bid || 0) * Number(i.unit_price || 0))}</span>
      <button type="button" class="row-x" data-action="delete-bid">&times;</button>
    </div>`).join('');

  return `<div class="bid-panel" data-job-id="${job.id}">
    <div class="bid-panel-head">
      <span>Bid items &mdash; ${esc(job.name)}</span>
      <button type="button" class="bid-toggle" data-action="close-bid">Close</button>
    </div>
    ${items === undefined ? '<p class="empty-state2">Loading&hellip;</p>' : `
      <div class="bid-line bid-line-head">
        <span>Description</span><span class="c">Qty</span><span>Unit</span><span class="c">Price each</span><span class="c">Line total</span><span></span>
      </div>
      ${rows || '<p class="empty-state2">Nothing bid yet. Add the first line below.</p>'}
      <div class="bid-panel-foot">
        <button type="button" class="btn2 btn2-solid small" data-action="add-bid">+ Add bid line</button>
        <span class="bid-contract">Contract total ${moneyFmt(contract)}</span>
      </div>
      <p class="bid-panel-note">${job.billing_type === 'flat'
        ? `Enter what you bid here once. Each week on the Summary page you mark how many of each
           line got finished, and that is what the customer is invoiced.`
        : `This job bills by the hour, so these lines are not invoiced off &mdash; they show up as a
           picker on Log Work so the crew can say which of this customer's bids they were on.`}</p>`}
  </div>`;
}

function moneyFmt(n) {
  return '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function loadBidItems(jobId) {
  const { data } = await sb.from('job_bid_items').select('*').eq('job_id', jobId).order('sort_order').order('created_at');
  bidItemsByJob[jobId] = data || [];
  renderJobs();
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
  else if (e.target.classList.contains('job-bidnum')) patch = { bid_number: e.target.value.trim() || null };
  if (!patch) return;

  Object.assign(job, patch);
  await sb.from('jobs').update(patch).eq('id', id);
}, true);

// Bid line edits save on blur, same feel as the job cells above.
document.getElementById('jobsTable').addEventListener('blur', async (e) => {
  const line = e.target.closest('[data-bid-id]');
  if (!line) return;
  const id = line.dataset.bidId;
  const jobId = line.closest('[data-job-id]').dataset.jobId;
  const row = (bidItemsByJob[jobId] || []).find(i => i.id === id);
  if (!row) return;

  let patch = null;
  if (e.target.classList.contains('bid-desc')) patch = { description: e.target.value.trim() };
  else if (e.target.classList.contains('bid-qty')) patch = { qty_bid: num(e.target.value) };
  else if (e.target.classList.contains('bid-unit')) patch = { unit: e.target.value.trim() || 'ea' };
  else if (e.target.classList.contains('bid-price')) patch = { unit_price: num(e.target.value) };
  if (!patch) return;

  Object.assign(row, patch);
  const { error } = await sb.from('job_bid_items').update(patch).eq('id', id);
  if (error) { alert('Could not save that bid line: ' + error.message); return; }
  renderJobs();
}, true);

document.getElementById('jobsTable').addEventListener('click', async (e) => {
  const openBid = e.target.closest('[data-action="open-bid"]');
  if (openBid) {
    openBidJobId = openBid.closest('[data-job-id]').dataset.jobId;
    renderJobs();
    if (bidItemsByJob[openBidJobId] === undefined) await loadBidItems(openBidJobId);
    return;
  }
  const closeBid = e.target.closest('[data-action="close-bid"]');
  if (closeBid) { openBidJobId = null; renderJobs(); return; }

  const addBid = e.target.closest('[data-action="add-bid"]');
  if (addBid) {
    const jobId = addBid.closest('[data-job-id]').dataset.jobId;
    const sort = (bidItemsByJob[jobId] || []).length;
    const { data, error } = await sb.from('job_bid_items')
      .insert({ job_id: jobId, description: 'New bid line', qty_bid: 1, unit_price: 0, unit: 'ea', sort_order: sort })
      .select().single();
    if (error) { alert('Could not add that line: ' + error.message); return; }
    (bidItemsByJob[jobId] = bidItemsByJob[jobId] || []).push(data);
    renderJobs();
    return;
  }

  const delBid = e.target.closest('[data-action="delete-bid"]');
  if (delBid) {
    const line = delBid.closest('[data-bid-id]');
    const jobId = line.closest('[data-job-id]').dataset.jobId;
    const id = line.dataset.bidId;
    const row = (bidItemsByJob[jobId] || []).find(i => i.id === id);
    if (!confirm(`Delete bid line "${row ? row.description : ''}"? Any weekly progress recorded against it goes too.`)) return;
    const { data: gone, error } = await sb.from('job_bid_items').delete().eq('id', id).select('id');
    if (error) { alert('Could not delete: ' + error.message); return; }
    if (!gone || gone.length === 0) {
      alert('That bid line could not be deleted.\n\n'
          + 'Nothing was removed, so it is still there.');
      return;
    }
    bidItemsByJob[jobId] = (bidItemsByJob[jobId] || []).filter(i => i.id !== id);
    renderJobs();
    return;
  }

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
    // A refused delete comes back with no error and no rows, so without asking
    // what went the job disappears from the screen and is still in the database.
    const { data: gone } = await sb.from('jobs').delete().eq('id', id).select('id');
    if (!gone || gone.length === 0) {
      alert('That job could not be deleted.\n\n'
          + 'Nothing was removed. It may have work booked against it.');
      return;
    }
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
const ADMIN_INVITE_WELDER_URL = 'https://woqzbterwialanccprhp.supabase.co/functions/v1/admin-invite-welder';

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
    const { data: gone } = await sb.from('helpers').delete().eq('id', id).select('id');
    if (!gone || gone.length === 0) {
      alert('That helper could not be deleted.\n\n'
          + 'Nothing was removed. They may have hours booked against them.');
      return;
    }
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

// ---------- Letterhead ----------
// Kept in app_settings so the pay statements and invoices can both read it and
// nobody has to touch code to change an address.
const CO_FIELDS = { coName: 'company_name', coAddress: 'company_address', coPhone: 'company_phone' };

async function loadCompanyInfo() {
  const { data } = await sb.from('app_settings').select('key, value').in('key', Object.values(CO_FIELDS));
  const byKey = Object.fromEntries((data || []).map(r => [r.key, r.value]));
  for (const [elId, key] of Object.entries(CO_FIELDS)) {
    const el = document.getElementById(elId);
    if (el) el.value = byKey[key] || '';
  }
}

function wireCompanyInfo() {
  const saved = document.getElementById('coSaved');
  for (const [elId, key] of Object.entries(CO_FIELDS)) {
    const el = document.getElementById(elId);
    if (!el) continue;
    el.addEventListener('change', async () => {
      const { error } = await sb.from('app_settings')
        .upsert({ key, value: el.value.trim(), updated_at: new Date().toISOString() }, { onConflict: 'key' });
      if (saved) {
        saved.textContent = error ? 'Not saved' : 'Saved';
        saved.style.color = error ? 'var(--bad, #e0554f)' : '';
        setTimeout(() => { saved.textContent = ''; }, 2500);
      }
    });
  }
}

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

  wireCompanyInfo();
  await Promise.all([loadJobs(), loadWelders(), loadHelpers(), loadCompanyInfo()]);
})();


// ---------- Add a welder ----------
//
// A welder is a login, not just a row, so this cannot be a plain insert the way
// helpers are. The work happens in the admin-invite-welder function, which holds
// the service role; the office never sees or sets their password - the welder
// picks it from the emailed link.
(function wireAddWelder() {
  const panel = document.getElementById('welderInvite');
  const openBtn = document.getElementById('addWelderBtn');
  if (!panel || !openBtn) return;

  const nameEl = document.getElementById('wiName');
  const emailEl = document.getElementById('wiEmail');
  const payEl = document.getElementById('wiPay');
  const billEl = document.getElementById('wiBill');
  const msgEl = document.getElementById('wiMsg');
  const sendBtn = document.getElementById('wiSend');

  function say(text, kind) {
    msgEl.className = 'wi-msg' + (kind ? ' ' + kind : '');
    msgEl.textContent = text;
  }
  function close() {
    panel.hidden = true;
    nameEl.value = emailEl.value = payEl.value = billEl.value = '';
    say('');
  }

  openBtn.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) { say(''); nameEl.focus(); }
  });
  document.getElementById('wiCancel').addEventListener('click', close);

  sendBtn.addEventListener('click', async () => {
    const fullName = nameEl.value.trim();
    const email = emailEl.value.trim();
    if (!fullName) { say('Enter the name of the welder.', 'err'); nameEl.focus(); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { say('Enter a valid email address.', 'err'); emailEl.focus(); return; }

    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending...';
    say('');

    try {
      const { data: { session } } = await sb.auth.getSession();
      const res = await fetch(ADMIN_INVITE_WELDER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ fullName, email, payRate: payEl.value.trim(), billRate: billEl.value.trim() })
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Could not add the welder.');

      await loadWelders();

      if (json.emailed) {
        say(fullName + ' was added. The invite is on its way to ' + email + '.', 'ok');
        setTimeout(close, 4000);
      } else {
        // The welder exists either way; only the email failed. Hand the link over
        // rather than claim it was sent, so the office can pass it on by hand.
        say(fullName + ' was added, but the invite email could not be sent. '
          + 'Send them this link yourself - it is the only way in until they set a password:', 'err');
        const a = document.createElement('code');
        a.className = 'wi-link';
        a.textContent = json.link || '(no link returned - use Set password on their row instead)';
        msgEl.appendChild(a);
      }
    } catch (err) {
      say(String(err.message || err), 'err');
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send invite';
    }
  });
})();
