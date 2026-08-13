let currentUser = null;
let jobsById = {};
let helpersList = [];
let weldersList = [];
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

function personLine(role, name, hours, payRate, billRate, perDiemAmt, perDiem, entryId, helperRowId, description, realJobId, realOneOffName, helperId, perDiemFlag, parts, welderId, entryDate, forJobId) {
  const pd = perDiem ? perDiemAmt : 0;
  const isFlat = Array.isArray(parts);
  const partsSum = isFlat ? parts.reduce((s, p) => s + Number(p.quantity) * Number(p.rate), 0) : 0;
  const revenue = (isFlat ? partsSum : hours * billRate) + pd;
  const cost = hours * payRate + pd;
  return {
    role, name, hours, billRate, pd: perDiem ? pd : null, revenue, cost, margin: revenue - cost,
    entryId, helperRowId, description: description || '',
    realJobId: realJobId || null, realOneOffName: realOneOffName || '',
    helperId: helperId || null, perDiemFlag: !!perDiemFlag,
    parts: isFlat ? parts : null,
    welderId: welderId || null, entryDate: entryDate || null, forJobId: forJobId || null
  };
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
    const isFlatJob = effectiveJob && effectiveJob.billing_type === 'flat';
    d.lines.push(personLine('welder', prof.full_name || '—', Number(e.hours), Number(prof.pay_rate || 0), Number(prof.bill_rate || 0), perDiemAmt, e.per_diem, e.id, null, e.description, e.job_id, e.one_off_name, null, e.per_diem, isFlatJob ? (e.daily_entry_parts || []) : undefined, e.welder_id, e.entry_date, e.for_job_id));
    if (e.description) d.descs.push(e.description);

    (e.daily_entry_helpers || []).forEach(dh => {
      const hp = dh.helpers || {};
      d.lines.push(personLine('helper', hp.name || '—', Number(dh.hours), Number(hp.pay_rate || 0), Number(hp.bill_rate || 0), perDiemAmt, dh.per_diem, e.id, dh.id, null, null, null, dh.helper_id, dh.per_diem));
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

  const [{ data: entries }, { data: jobs }, { data: jw }, { data: hlprs }, { data: welders }] = await Promise.all([
    sb.from('daily_entries')
      .select('*, profiles(full_name, pay_rate, bill_rate), daily_entry_helpers(*, helpers(name, pay_rate, bill_rate)), daily_entry_parts(*)')
      .gte('entry_date', start).lte('entry_date', end),
    sb.from('jobs').select('*'),
    sb.from('job_weeks').select('*').eq('week_start', start),
    sb.from('helpers').select('*').order('name'),
    sb.from('profiles').select('*').order('full_name')
  ]);

  jobsById = {};
  (jobs || []).forEach(j => jobsById[j.id] = j);
  helpersList = hlprs || [];
  weldersList = welders || [];

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
            <thead><tr><th class="l-name">Person</th><th>Hrs</th><th>Rate</th><th>PD</th><th>Bill</th><th>Margin</th><th></th></tr></thead>
            <tbody>
              ${d.lines.map((l, li) => `
                <tr data-entry-id="${esc(l.entryId)}" data-helper-row-id="${l.helperRowId ? esc(l.helperRowId) : ''}" data-line-key="${dateStr}-${li}">
                  <td class="l-name">${esc(l.name)}<span class="role-tag2">${l.role}</span>${l.role === 'welder' && l.description ? `<div class="line-desc">${esc(l.description)}</div>` : ''}${l.parts ? `<div class="line-desc flat-tag">Flat rate</div>${l.parts.map(p => `<div class="line-desc part-line-desc">${esc(p.description)} — ${p.quantity} &times; $${p.rate} = ${money(Number(p.quantity) * Number(p.rate))}</div>`).join('')}` : ''}</td>
                  <td class="l-num line-hours">${l.hours}</td>
                  <td class="l-num dim">${l.parts ? '—' : '$' + l.billRate}</td>
                  <td class="l-num dim">${l.pd ? money(l.pd) : '—'}</td>
                  <td class="l-num">${money(l.revenue)}</td>
                  <td class="l-num pos">${money(l.margin)}</td>
                  <td class="l-num line-actions">
                    <button type="button" class="row-edit" data-action="edit-line">Edit</button>
                    <button type="button" class="row-del" data-action="delete-line">Delete</button>
                  </td>
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

  document.querySelectorAll('.lines2 tbody tr').forEach(row => {
    const [dateStr, liStr] = row.dataset.lineKey.split(/-(\d+)$/);
    const line = g.days[dateStr].lines[Number(liStr)];

    row.querySelector('[data-action="edit-line"]').addEventListener('click', () => startEditLine(row, line, groupId));
    row.querySelector('[data-action="delete-line"]').addEventListener('click', () => deleteLine(line, groupId));
  });
}

function startEditLine(row, line, groupId) {
  const isHelper = !!line.helperRowId;

  if (isHelper) {
    row.innerHTML = `
      <td colspan="7">
        <div class="edit-row-form">
          <div class="edit-field">
            <label>Helper</label>
            <select class="input edit-helper-select">
              ${helpersList.map(h => `<option value="${esc(h.id)}" ${h.id === line.helperId ? 'selected' : ''}>${esc(h.name)}</option>`).join('')}
            </select>
          </div>
          <div class="edit-field edit-field-sm">
            <label>Hours</label>
            <input type="number" step="0.5" min="0" class="input edit-hours-input" value="${line.hours}">
          </div>
          <div class="edit-field edit-field-sm edit-field-pd">
            <label><input type="checkbox" class="edit-pd-input" ${line.perDiemFlag ? 'checked' : ''}> Per diem</label>
          </div>
          <div class="edit-field-actions">
            <button type="button" class="row-edit" data-action="save-line">Save</button>
            <button type="button" class="row-del" data-action="cancel-line">Cancel</button>
          </div>
        </div>
      </td>`;

    row.querySelector('[data-action="cancel-line"]').addEventListener('click', () => renderDetail(groupId));
    row.querySelector('[data-action="save-line"]').addEventListener('click', async () => {
      const patch = {
        helper_id: row.querySelector('.edit-helper-select').value,
        hours: Number(row.querySelector('.edit-hours-input').value),
        per_diem: row.querySelector('.edit-pd-input').checked
      };
      await sb.from('daily_entry_helpers').update(patch).eq('id', line.helperRowId);
      await loadWeek();
    });
    return;
  }

  const allJobs = Object.values(jobsById).sort((a, b) => a.name.localeCompare(b.name));
  const isOther = !line.realJobId;
  const isFlatJob = (jobId) => { const j = jobsById[jobId]; return !!(j && j.billing_type === 'flat'); };
  const startsFlat = isFlatJob(line.realJobId);
  let editParts = (line.parts || []).map(p => ({ id: p.id, description: p.description, quantity: p.quantity, rate: p.rate }));
  if (!editParts.length) editParts.push({ id: null, description: '', quantity: 1, rate: '' });

  function editPartsHtml() {
    return `
      <div class="edit-parts-list">
        ${editParts.map((p, pi) => `
          <div class="edit-part-row" data-part-idx="${pi}">
            <input type="text" class="input edit-part-desc" placeholder="Part" value="${escAttr(p.description)}">
            <input type="number" step="1" min="0" class="input edit-part-qty" placeholder="Qty" value="${escAttr(p.quantity)}">
            <span class="part-x">&times;</span>
            <input type="number" step="0.01" min="0" class="input edit-part-rate" placeholder="Rate $" value="${escAttr(p.rate)}">
            <button type="button" class="remove-part" data-action="remove-edit-part">&times;</button>
          </div>
        `).join('')}
      </div>
      <button type="button" class="add-part" data-action="add-edit-part">+ Add part</button>`;
  }

  const isYardJob = (jobId) => { const j = jobsById[jobId]; return !!(j && j.is_yard); };
  const startsYard = isYardJob(line.realJobId);

  row.innerHTML = `
    <td colspan="7">
      <div class="edit-row-form">
        <div class="edit-field">
          <label>Welder</label>
          <select class="input edit-welder-select">
            ${weldersList.map(w => `<option value="${esc(w.id)}" ${w.id === line.welderId ? 'selected' : ''}>${esc(w.full_name)}</option>`).join('')}
          </select>
        </div>
        <div class="edit-field edit-field-sm">
          <label>Date</label>
          <input type="date" class="input edit-date-input" value="${esc(line.entryDate)}">
        </div>
        <div class="edit-field">
          <label>Job</label>
          <select class="input edit-job-select">
            ${allJobs.map(j => `<option value="${esc(j.id)}" ${j.id === line.realJobId ? 'selected' : ''}>${esc(j.name)}${j.is_yard ? ' (yard)' : ''}</option>`).join('')}
            <option value="other" ${isOther ? 'selected' : ''}>Other / one-off…</option>
          </select>
        </div>
        <div class="edit-field edit-oneoff-wrap" style="display:${isOther ? 'block' : 'none'};">
          <label>One-off job name</label>
          <input type="text" class="input edit-oneoff-input" value="${esc(line.realOneOffName)}">
        </div>
        <div class="edit-field edit-forjob-wrap" style="display:${startsYard ? 'block' : 'none'};">
          <label>Which job is this yard work for?</label>
          <select class="input edit-forjob-select">
            <option value="">Pick the job it's for…</option>
            ${allJobs.filter(j => !j.is_yard).map(j => `<option value="${esc(j.id)}" ${j.id === line.forJobId ? 'selected' : ''}>${esc(j.name)}</option>`).join('')}
          </select>
        </div>
        <div class="edit-field">
          <label>Description</label>
          <textarea class="input edit-desc-input">${esc(line.description)}</textarea>
        </div>
        <div class="edit-field edit-field-sm">
          <label>Hours</label>
          <input type="number" step="0.5" min="0" class="input edit-hours-input" value="${line.hours}">
        </div>
        <div class="edit-field edit-field-sm edit-field-pd">
          <label><input type="checkbox" class="edit-pd-input" ${line.perDiemFlag ? 'checked' : ''}> Per diem</label>
        </div>
        <div class="edit-field edit-flat-wrap" style="display:${startsFlat ? 'block' : 'none'};">
          <label>Parts billed (qty &times; rate)</label>
          <div class="edit-parts-wrap">${editPartsHtml()}</div>
        </div>
        <div class="edit-field-actions">
          <button type="button" class="row-edit" data-action="save-line">Save</button>
          <button type="button" class="row-del" data-action="cancel-line">Cancel</button>
        </div>
      </div>
    </td>`;

  const jobSelect = row.querySelector('.edit-job-select');
  const oneOffWrap = row.querySelector('.edit-oneoff-wrap');
  const forJobWrap = row.querySelector('.edit-forjob-wrap');
  const flatWrap = row.querySelector('.edit-flat-wrap');
  const partsWrap = row.querySelector('.edit-parts-wrap');

  function readPartsFromDom() {
    row.querySelectorAll('.edit-part-row').forEach((el, pi) => {
      editParts[pi].description = el.querySelector('.edit-part-desc').value;
      editParts[pi].quantity = el.querySelector('.edit-part-qty').value;
      editParts[pi].rate = el.querySelector('.edit-part-rate').value;
    });
  }
  function rebindParts() {
    partsWrap.innerHTML = editPartsHtml();
    partsWrap.querySelector('[data-action="add-edit-part"]').addEventListener('click', () => {
      readPartsFromDom();
      editParts.push({ id: null, description: '', quantity: 1, rate: '' });
      rebindParts();
    });
    partsWrap.querySelectorAll('[data-action="remove-edit-part"]').forEach(btn => {
      btn.addEventListener('click', () => {
        readPartsFromDom();
        const idx = Number(btn.closest('[data-part-idx]').dataset.partIdx);
        editParts.splice(idx, 1);
        if (!editParts.length) editParts.push({ id: null, description: '', quantity: 1, rate: '' });
        rebindParts();
      });
    });
  }
  rebindParts();

  jobSelect.addEventListener('change', () => {
    oneOffWrap.style.display = jobSelect.value === 'other' ? 'block' : 'none';
    forJobWrap.style.display = isYardJob(jobSelect.value) ? 'block' : 'none';
    flatWrap.style.display = isFlatJob(jobSelect.value) ? 'block' : 'none';
  });

  row.querySelector('[data-action="cancel-line"]').addEventListener('click', () => renderDetail(groupId));
  row.querySelector('[data-action="save-line"]').addEventListener('click', async () => {
    readPartsFromDom();
    const jobVal = jobSelect.value;
    const other = jobVal === 'other';
    const yardNow = isYardJob(jobVal);
    const flatNow = isFlatJob(jobVal);
    const patch = {
      welder_id: row.querySelector('.edit-welder-select').value,
      entry_date: row.querySelector('.edit-date-input').value,
      job_id: other ? null : jobVal,
      one_off_name: other ? row.querySelector('.edit-oneoff-input').value.trim() : null,
      for_job_id: yardNow ? (row.querySelector('.edit-forjob-select').value || null) : null,
      description: row.querySelector('.edit-desc-input').value.trim(),
      hours: Number(row.querySelector('.edit-hours-input').value),
      per_diem: row.querySelector('.edit-pd-input').checked
    };
    await sb.from('daily_entries').update(patch).eq('id', line.entryId);

    if (flatNow) {
      await sb.from('daily_entry_parts').delete().eq('daily_entry_id', line.entryId);
      const validParts = editParts
        .filter(p => p.description.trim() && Number(p.quantity) > 0 && Number(p.rate) > 0)
        .map(p => ({ daily_entry_id: line.entryId, description: p.description.trim(), quantity: Number(p.quantity), rate: Number(p.rate) }));
      if (validParts.length) await sb.from('daily_entry_parts').insert(validParts);
    } else if (line.parts) {
      await sb.from('daily_entry_parts').delete().eq('daily_entry_id', line.entryId);
    }
    await loadWeek();
  });
}

async function deleteLine(line, groupId) {
  const label = line.helperRowId ? `${line.name}'s helper hours` : `${line.name}'s whole entry for this day (including any helpers on it)`;
  if (!confirm(`Delete ${label}? This can't be undone.`)) return;

  if (line.helperRowId) {
    await sb.from('daily_entry_helpers').delete().eq('id', line.helperRowId);
  } else {
    await sb.from('daily_entries').delete().eq('id', line.entryId);
  }
  await loadWeek();
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
