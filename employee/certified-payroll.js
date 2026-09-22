// Certified payroll — the WH-347 report for a prevailing wage project, one per
// work week, built from the same tickets the pay statements come from.
//
// Everything on this page comes from get_certified_payroll(), one round trip
// per job and week. The math lives in Postgres (see the 20260922 migration);
// this file lays it out, lets the office fill in the few things the tickets
// don't know (classification, last four, address, the project's wage rates),
// prints the two-page form, hands over a CSV for LCPtracker, and records what
// was submitted under which payroll number.
//
// Two rules worth knowing while reading the numbers:
//
//   Hours on the report are hours logged AT the project. Shop hours "for" the
//   job are not site work and stay off it, but they still count toward the
//   man's 40, so a day that crosses 40 is split into straight and overtime.
//
//   The crew is paid straight time as contract labor. The report shows what
//   was actually paid; the warnings box shows where that falls short of what
//   prevailing wage expects (overtime premium, wage determination), because a
//   report that hides the gap is worse than one that shows it.

let currentUser = null;
let jobs = [];
let jobId = null;
let weekStart = getMonday(new Date());
let weekList = [];
let data = null;
let editing = false;
let saveTimer = null;

const CLASSIFICATIONS = [
  'Pipefitter', 'Welder', 'Pipefitter / Welder', 'Laborer', 'Ironworker', 'Boilermaker',
  'Millwright', 'Equipment Operator', 'Foreman', 'Helper / Laborer'
];

// ---------- small helpers ----------

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
function escAttr(str) { return esc(str).replace(/"/g, '&quot;'); }
function money(n) {
  const v = Number(n || 0);
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function num(n) {
  const v = Number(n || 0);
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}
function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function fromYmd(s) { return new Date(s + 'T00:00:00'); }
function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date;
}
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function longDate(d) {
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}
function shortDate(d) {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function formatWeekLabel(start) {
  const end = addDays(start, 6);
  return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}
function dow(dateStr) {
  return fromYmd(dateStr).toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2);
}
function mmdd(dateStr) {
  const d = fromYmd(dateStr);
  return (d.getMonth() + 1) + '/' + d.getDate();
}
function val(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
function fmtDate(s) {
  if (!s) return '';
  return fromYmd(s).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: 'numeric' });
}

async function requireAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return null; }
  return session.user;
}

// ---------- jobs ----------

async function loadJobs() {
  const { data: rows, error } = await sb.from('jobs')
    .select('id, name, bill_to, operator, prevailing_wage, pw_project_name, pw_project_number, pw_contracting_agency, pw_site_address, pw_rates, archived_at, is_internal')
    .is('archived_at', null)
    .order('name');
  if (error) { console.error(error); return; }
  jobs = (rows || []).filter(j => !j.is_internal);
  // Prevailing wage jobs first: that is what this page is for. The rest stay
  // in the list so a job can be flagged from here the first time it needs it.
  jobs.sort((a, b) => (b.prevailing_wage - a.prevailing_wage) || a.name.localeCompare(b.name));
  const sel = document.getElementById('jobSelect');
  const pw = jobs.filter(j => j.prevailing_wage);
  const other = jobs.filter(j => !j.prevailing_wage);
  sel.innerHTML =
    (pw.length ? `<optgroup label="Prevailing wage projects">${pw.map(j => `<option value="${j.id}">${esc(j.name)}</option>`).join('')}</optgroup>` : '') +
    `<optgroup label="Other jobs (not flagged prevailing wage)">${other.map(j => `<option value="${j.id}">${esc(j.name)}</option>`).join('')}</optgroup>`;
  const remembered = localStorage.getItem('cp_job');
  if (remembered && jobs.some(j => j.id === remembered)) jobId = remembered;
  else if (pw.length) jobId = pw[0].id;
  else if (jobs.length) jobId = jobs[0].id;
  sel.value = jobId || '';
}

function currentJob() { return jobs.find(j => j.id === jobId) || null; }

// ---------- weeks ----------

async function loadWeeks() {
  const sel = document.getElementById('weekSelect');
  if (!jobId) { sel.innerHTML = '<option value="">Pick a week…</option>'; return; }
  const { data: rows, error } = await sb.rpc('list_certified_payroll_weeks', { p_job: jobId });
  if (error) { console.error(error); weekList = []; }
  else weekList = rows || [];
  sel.innerHTML = '<option value="">Pick a week…</option>' + weekList.map(w => {
    const tag = w.status === 'submitted' ? ` — submitted #${w.payroll_no}` : (w.status === 'draft' ? ' — draft' : '');
    return `<option value="${w.week_start}">${esc(formatWeekLabel(fromYmd(w.week_start)))} · ${w.people} on site, ${num(w.hours)} h${esc(tag)}</option>`;
  }).join('');
  sel.value = weekList.some(w => w.week_start === ymd(weekStart)) ? ymd(weekStart) : '';
}

// ---------- load ----------

async function loadReport() {
  document.getElementById('weekLabel').textContent = formatWeekLabel(weekStart);
  const body = document.getElementById('reportBody');
  if (!jobId) {
    body.innerHTML = '<div class="card cp-empty">No jobs yet. Add the project in Setup first.</div>';
    return;
  }
  const { data: d, error } = await sb.rpc('get_certified_payroll', { p_job: jobId, p_week: ymd(weekStart) });
  if (error) {
    body.innerHTML = `<div class="card">Could not load this week: ${esc(error.message)}</div>`;
    return;
  }
  data = d;
  // Keep the job list's copy current so the project panel never shows stale
  // fields after a save that came back through the RPC.
  const j = currentJob();
  if (j && d.job) Object.assign(j, d.job);
  renderProject();
  renderCrew();
  renderWarnings();
  renderReport();
}

// ---------- project setup ----------

function renderProject() {
  const j = currentJob();
  const sub = document.getElementById('projectPanelSub');
  const body = document.getElementById('projectPanelBody');
  if (!j) { sub.textContent = ''; body.innerHTML = ''; return; }

  const rates = j.pw_rates && typeof j.pw_rates === 'object' ? j.pw_rates : {};
  const rateKeys = Object.keys(rates);
  sub.textContent = j.prevailing_wage
    ? `${j.pw_project_name || j.name}${j.pw_site_address ? ' · ' + j.pw_site_address : ''}`
    : 'not flagged as prevailing wage yet';

  body.innerHTML = `
    <label class="cp-switch">
      <button type="button" class="toggle2${j.prevailing_wage ? ' ton' : ''}" id="pwToggle"><span class="tk2"></span></button>
      <span>This job is prevailing wage work and needs a certified payroll each week the crew is on site</span>
    </label>
    <div class="cp-grid">
      <div>
        <label class="field-label">Project name (as the owner calls it)</label>
        <input class="input" id="pwProjectName" value="${escAttr(j.pw_project_name || '')}" placeholder="Project Roadrunner">
      </div>
      <div>
        <label class="field-label">Project / contract number</label>
        <input class="input" id="pwProjectNumber" value="${escAttr(j.pw_project_number || '')}" placeholder="PO or contract no.">
      </div>
      <div>
        <label class="field-label">Owner / contracting agency</label>
        <input class="input" id="pwAgency" value="${escAttr(j.pw_contracting_agency || '')}" placeholder="Infinium Operations, LLC">
      </div>
      <div class="cp-grid-wide">
        <label class="field-label">Project location (site address)</label>
        <input class="input" id="pwSite" value="${escAttr(j.pw_site_address || '')}" placeholder="264 Shaw Rd, Pecos, TX">
      </div>
    </div>

    <div class="cp-rates">
      <div class="cp-rates-head">Wage determination — prevailing rate by classification</div>
      <div id="rateRows">
        ${rateKeys.map(k => rateRowHtml(k, rates[k])).join('')}
      </div>
      <button type="button" class="btn2 btn2-ghost small" id="addRateBtn">+ Add classification</button>
      <p class="cp-hint">Base rate and fringe come from the wage determination for this project (ask Infinium's payroll
        team for it if it is not in the contract). The crew is paid an all-in hourly rate with no separate benefits, so
        what each man is paid has to be at least base + fringe for his classification. The report flags anyone under it.</p>
    </div>`;

  document.getElementById('pwToggle').addEventListener('click', async () => {
    j.prevailing_wage = !j.prevailing_wage;
    await saveJob({ prevailing_wage: j.prevailing_wage });
    await loadJobs();
    document.getElementById('jobSelect').value = jobId;
    renderProject();
    renderWarnings();
  });

  ['pwProjectName', 'pwProjectNumber', 'pwAgency', 'pwSite'].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener('focus', () => { editing = true; });
    el.addEventListener('blur', async () => {
      editing = false;
      const patch = {
        pw_project_name: val('pwProjectName') || null,
        pw_project_number: val('pwProjectNumber') || null,
        pw_contracting_agency: val('pwAgency') || null,
        pw_site_address: val('pwSite') || null,
      };
      Object.assign(j, patch);
      await saveJob(patch);
      document.getElementById('projectPanelSub').textContent =
        j.prevailing_wage ? `${j.pw_project_name || j.name}${j.pw_site_address ? ' · ' + j.pw_site_address : ''}` : 'not flagged as prevailing wage yet';
      if (data) { data.job = Object.assign(data.job || {}, patch); renderReport(); }
    });
  });

  document.getElementById('addRateBtn').addEventListener('click', () => {
    document.getElementById('rateRows').insertAdjacentHTML('beforeend', rateRowHtml('', { base: '', fringe: '' }));
    const rows = document.querySelectorAll('.cp-rate-row');
    rows[rows.length - 1].querySelector('.rate-class').focus();
  });

  const rateRows = document.getElementById('rateRows');
  rateRows.addEventListener('focusin', () => { editing = true; });
  rateRows.addEventListener('focusout', () => { editing = false; saveRates(); });
  rateRows.addEventListener('click', (e) => {
    const x = e.target.closest('[data-action="del-rate"]');
    if (!x) return;
    x.closest('.cp-rate-row').remove();
    saveRates();
  });
}

function rateRowHtml(cls, r) {
  return `
    <div class="cp-rate-row">
      <input class="input rate-class" list="cpClassList" value="${escAttr(cls)}" placeholder="Classification">
      <input class="input num rate-base" inputmode="decimal" value="${escAttr(r && r.base != null ? r.base : '')}" placeholder="Base $/hr">
      <input class="input num rate-fringe" inputmode="decimal" value="${escAttr(r && r.fringe != null ? r.fringe : '')}" placeholder="Fringe $/hr">
      <button type="button" class="row-x" data-action="del-rate" title="Remove">&times;</button>
    </div>`;
}

async function saveRates() {
  const j = currentJob();
  if (!j) return;
  const rates = {};
  document.querySelectorAll('.cp-rate-row').forEach(row => {
    const cls = row.querySelector('.rate-class').value.trim();
    if (!cls) return;
    rates[cls] = {
      base: Number(row.querySelector('.rate-base').value) || 0,
      fringe: Number(row.querySelector('.rate-fringe').value) || 0,
    };
  });
  if (JSON.stringify(rates) === JSON.stringify(j.pw_rates || {})) return;
  j.pw_rates = rates;
  if (data && data.job) data.job.pw_rates = rates;
  await saveJob({ pw_rates: rates });
  renderWarnings();
  renderReport();
}

async function saveJob(patch) {
  const { error } = await sb.from('jobs').update(patch).eq('id', jobId);
  if (error) { console.error(error); alert('Could not save the project: ' + error.message); }
}

// ---------- crew details ----------

function renderCrew() {
  const sub = document.getElementById('crewPanelSub');
  const body = document.getElementById('crewPanelBody');
  const workers = (data && data.workers) || [];
  if (!workers.length) {
    sub.textContent = 'nobody on site this week';
    body.innerHTML = '<p class="cp-hint">Once tickets are logged against this project, each man who was on site is listed here so his classification, the last four of his SSN and his address can be filled in. They are remembered on his record, so it is a one-time job per man.</p>';
    return;
  }
  const missing = workers.filter(w => !w.classification || !w.ssn_last4 || !w.home_address).length;
  sub.textContent = missing ? `${missing} of ${workers.length} still need details` : `${workers.length} on site, all filled in`;

  body.innerHTML = `
    <p class="cp-hint">Filled in once per man and remembered. LCPtracker holds the full Social Security number in its own
      employee record; this page keeps only the last four, which is what prints on the report.</p>
    <div class="cp-crew-row cp-crew-head"><div>Name</div><div>Classification</div><div>SSN last 4</div><div>Home address</div></div>
    ${workers.map(w => `
      <div class="cp-crew-row" data-kind="${w.kind}" data-id="${w.person_id}">
        <div class="cp-crew-name">${esc(w.name)}<span class="role-tag2">${w.kind}</span></div>
        <input class="input crew-class" list="cpClassList" value="${escAttr(w.classification || '')}" placeholder="Pipefitter, Laborer…">
        <input class="input crew-last4" inputmode="numeric" maxlength="4" value="${escAttr(w.ssn_last4 || '')}" placeholder="0000">
        <input class="input crew-addr" value="${escAttr(w.home_address || '')}" placeholder="Street, City, TX ZIP">
      </div>`).join('')}
    <datalist id="cpClassList">${CLASSIFICATIONS.map(c => `<option value="${escAttr(c)}">`).join('')}</datalist>`;

  body.addEventListener('focusin', () => { editing = true; });
  body.addEventListener('focusout', async (e) => {
    editing = false;
    const row = e.target.closest('.cp-crew-row[data-id]');
    if (!row) return;
    const w = workers.find(x => x.kind === row.dataset.kind && x.person_id === row.dataset.id);
    if (!w) return;
    const patch = {
      pw_classification: row.querySelector('.crew-class').value.trim() || null,
      ssn_last4: row.querySelector('.crew-last4').value.replace(/\D/g, '').slice(-4) || null,
      home_address: row.querySelector('.crew-addr').value.trim() || null,
    };
    if (patch.pw_classification === (w.classification || null) && patch.ssn_last4 === (w.ssn_last4 || null) && patch.home_address === (w.home_address || null)) return;
    w.classification = patch.pw_classification;
    w.ssn_last4 = patch.ssn_last4;
    w.home_address = patch.home_address;
    const table = w.kind === 'welder' ? 'profiles' : 'helpers';
    const { error } = await sb.from(table).update(patch).eq('id', w.person_id);
    if (error) { console.error(error); alert('Could not save: ' + error.message); return; }
    const miss = workers.filter(x => !x.classification || !x.ssn_last4 || !x.home_address).length;
    sub.textContent = miss ? `${miss} of ${workers.length} still need details` : `${workers.length} on site, all filled in`;
    renderWarnings();
    renderReport();
  });
}

// ---------- warnings ----------

function prevailingFor(cls) {
  const j = currentJob();
  const rates = (j && j.pw_rates) || {};
  if (!cls) return null;
  const key = Object.keys(rates).find(k => k.toLowerCase() === cls.toLowerCase());
  if (!key) return null;
  const r = rates[key];
  return { base: Number(r.base) || 0, fringe: Number(r.fringe) || 0, total: (Number(r.base) || 0) + (Number(r.fringe) || 0) };
}

function collectWarnings() {
  const out = [];
  const j = currentJob();
  const workers = (data && data.workers) || [];
  if (!j) return out;
  if (!j.prevailing_wage) out.push({ level: 'warn', text: 'This job is not flagged as prevailing wage. Flag it in Project setup above so it is listed first and the checks below apply.' });
  if (j.prevailing_wage && (!j.pw_project_name || !j.pw_site_address)) out.push({ level: 'warn', text: 'Project name and site address are blank. They print in the header of the form.' });
  if (!workers.length) return out;

  const noClass = workers.filter(w => !w.classification).map(w => w.name);
  const noLast4 = workers.filter(w => !w.ssn_last4).map(w => w.name);
  const noAddr = workers.filter(w => !w.home_address).map(w => w.name);
  if (noClass.length) out.push({ level: 'bad', text: `No job classification for ${noClass.join(', ')}. Every man on the report needs one — pipefitter, laborer, welder and so on — and it decides which prevailing rate applies.` });
  if (noLast4.length) out.push({ level: 'bad', text: `No SSN last four for ${noLast4.join(', ')}. The form wants an identifying number for each man.` });
  if (noAddr.length) out.push({ level: 'warn', text: `No home address for ${noAddr.join(', ')}. LCPtracker asks for it on the employee record.` });

  const ot = workers.filter(w => Number(w.ot_project) > 0);
  if (ot.length) {
    const premium = ot.reduce((s, w) => s + Number(w.ot_project) * Number(w.rate) * 0.5, 0);
    out.push({ level: 'bad', text: `Overtime paid at straight time: ${ot.map(w => `${w.name} ${num(w.ot_project)} h`).join(', ')}. Prevailing wage work requires time and a half past 40 hours in the week. The half-time premium owed on this project's hours comes to ${money(premium)}; pay it and note it on the report before submitting.` });
  }

  const under = [];
  const unrated = [];
  workers.forEach(w => {
    const pw = prevailingFor(w.classification);
    if (!w.classification) return;
    if (!pw) { unrated.push(w.classification); return; }
    if (Number(w.rate) < pw.total) under.push(`${w.name} (${w.classification}: paid ${money(w.rate)}, needs ${money(pw.total)})`);
  });
  if (under.length) out.push({ level: 'bad', text: `Paid under the prevailing rate: ${under.join('; ')}. Either raise the rate for hours on this project or pay the difference before certifying.` });
  const uniqUnrated = [...new Set(unrated.map(c => c.toLowerCase()))];
  if (uniqUnrated.length) out.push({ level: 'warn', text: `No wage determination entered for: ${[...new Set(unrated)].join(', ')}. Add the base and fringe in Project setup so the rate check can run.` });

  const mixed = workers.filter(w => Array.isArray(w.rates) && w.rates.length > 1);
  if (mixed.length) out.push({ level: 'warn', text: `More than one rate on this project this week for ${mixed.map(w => `${w.name} (${w.rates.map(r => money(r)).join(' / ')})`).join(', ')}. The report shows the higher one; check the tickets.` });

  if (data.report && data.report.status === 'submitted') {
    out.push({ level: 'info', text: `Submitted to LCPtracker as payroll #${data.report.payroll_no} on ${new Date(data.report.submitted_at).toLocaleDateString()}. If a ticket changed since, resubmit it as an amended payroll under the same number.` });
  }
  return out;
}

function renderWarnings() {
  const box = document.getElementById('warnBox');
  if (!data) { box.innerHTML = ''; return; }
  const w = collectWarnings();
  if (!w.length) {
    box.innerHTML = (data.workers || []).length
      ? '<div class="sum-ok">Checks &mdash; nothing to fix. This week is ready to certify.</div>' : '';
    return;
  }
  box.innerHTML = `<div class="sum-warn"><h3>Before this goes to LCPtracker</h3>${w.map(x =>
    `<div class="ck-row"><div class="ck-detail${x.level === 'bad' ? ' bad' : ''}">${x.level === 'bad' ? '&#9888; ' : ''}${esc(x.text)}</div></div>`).join('')}</div>`;
}

// ---------- the report ----------

function reportMeta() {
  const r = (data && data.report) || {};
  const j = currentJob() || {};
  const end = fromYmd(data.week_end);
  return {
    payrollNo: r.payroll_no || data.next_payroll_no,
    status: r.status || 'draft',
    payDate: r.pay_date || ymd(addDays(end, 4)),
    signerName: r.signer_name || 'Gilbert Alvarez',
    signerTitle: r.signer_title || 'Owner',
    notes: r.notes || '',
    projectName: j.pw_project_name || j.name || '',
    projectNumber: j.pw_project_number || j.po_number || '',
    agency: j.pw_contracting_agency || j.bill_to || '',
    site: j.pw_site_address || '',
  };
}

function renderReport() {
  const body = document.getElementById('reportBody');
  if (!data) return;
  const workers = data.workers || [];
  const m = reportMeta();
  const dates = workers.length ? workers[0].days.map(d => d.date) : [0, 1, 2, 3, 4, 5, 6].map(i => ymd(addDays(weekStart, i)));

  if (!workers.length) {
    body.innerHTML = `
      <div class="card cp-empty">
        <b>Nobody logged hours at ${esc(m.projectName)} in the week of ${esc(formatWeekLabel(weekStart))}.</b><br>
        A certified payroll is only due for weeks the crew was on site. Once the men log their tickets against this
        job, the report builds itself here. Use the week picker above to jump to a week that has site hours.
      </div>`;
    return;
  }

  const tot = workers.reduce((a, w) => {
    a.st += Number(w.st_project); a.ot += Number(w.ot_project); a.hours += Number(w.hours_project);
    a.gross += Number(w.gross_project); a.grossAll += Number(w.gross_week); return a;
  }, { st: 0, ot: 0, hours: 0, gross: 0, grossAll: 0 });

  body.innerHTML = `
    <div class="card cp-report">
      <div class="cp-report-head">
        <div>
          <div class="cp-report-title">Certified payroll #${m.payrollNo} &mdash; ${esc(m.projectName)}</div>
          <div class="cp-report-sub">Week ending ${esc(longDate(fromYmd(data.week_end)))} &middot; ${workers.length} on site &middot; ${num(tot.hours)} site hours
            ${m.site ? '&middot; ' + esc(m.site) : ''}</div>
        </div>
        <span class="cp-status ${m.status}">${m.status === 'submitted' ? 'Submitted' : 'Draft'}</span>
      </div>

      <div class="cp-table-scroll">
        <table class="sum-table cp-table">
          <thead>
            <tr>
              <th class="l">Name &amp; ID</th>
              <th class="l">Classification</th>
              ${dates.map(d => `<th class="day">${esc(dow(d))}<br>${esc(mmdd(d))}</th>`).join('')}
              <th>Total hrs</th>
              <th>Rate</th>
              <th>Gross this project</th>
              <th>Gross all work</th>
              <th>Deductions</th>
              <th>Net paid</th>
            </tr>
          </thead>
          <tbody>
            ${workers.map(w => {
              const pw = prevailingFor(w.classification);
              const underRate = pw && Number(w.rate) < pw.total;
              return `
              <tr>
                <td class="l"><b>${esc(w.name)}</b><span class="sub">${w.ssn_last4 ? 'XXX-XX-' + esc(w.ssn_last4) : '<span class="miss">no ID</span>'}${w.home_address ? ' &middot; ' + esc(w.home_address) : ''}</span></td>
                <td class="l${w.classification ? '' : ' miss'}">${esc(w.classification || 'not set')}<span class="sub">${w.kind}</span></td>
                ${w.days.map(d => `<td class="day">${Number(d.ot) > 0 ? `<span class="ot">O ${num(d.ot)}</span>` : ''}<span class="st">${Number(d.st) > 0 ? num(d.st) : (Number(d.hours) > 0 ? '' : '&mdash;')}</span></td>`).join('')}
                <td><b>${num(w.hours_project)}</b>${Number(w.ot_project) > 0 ? `<span class="sub">${num(w.st_project)} S + ${num(w.ot_project)} O</span>` : ''}</td>
                <td class="${underRate ? 'miss' : ''}">${money(w.rate)}<span class="sub">${pw ? 'PW ' + money(pw.total) : 'incl. fringe (cash)'}</span></td>
                <td>${money(w.gross_project)}${Number(w.per_diem_project) > 0 ? `<span class="sub">+ ${money(w.per_diem_project)} per diem</span>` : ''}</td>
                <td>${money(w.gross_week)}<span class="sub">${num(w.hours_week)} h all jobs</span></td>
                <td>${money(0)}<span class="sub">contract labor</span></td>
                <td><b>${money(w.gross_week)}</b></td>
              </tr>`;
            }).join('')}
            <tr class="tot">
              <td class="l" colspan="2">Totals &mdash; ${workers.length} workers</td>
              ${dates.map(d => {
                const h = workers.reduce((s, w) => s + Number((w.days.find(x => x.date === d) || {}).hours || 0), 0);
                return `<td class="day">${h ? num(h) : '&mdash;'}</td>`;
              }).join('')}
              <td>${num(tot.hours)}${tot.ot ? `<span class="sub">${num(tot.st)} S + ${num(tot.ot)} O</span>` : ''}</td>
              <td></td>
              <td>${money(tot.gross)}</td>
              <td>${money(tot.grossAll)}</td>
              <td>${money(0)}</td>
              <td>${money(tot.grossAll)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="sum-note">Hours are the tickets logged at this project. O is overtime: anything past 40 hours in the week,
        counting every job the man worked. "Gross all work" and "Net paid" cover the whole week including per diem, which is
        how the form asks for them. The crew is paid as contract labor with no withholding, so deductions are zero.</p>

      <div class="cp-compliance">
        <h3>Statement of compliance</h3>
        <p>Page two of the form. It certifies that the payroll is correct and complete, that each man was paid the full
          weekly wage with no rebates or unauthorized deductions, that the classifications match the work performed and the
          wage determination, and that fringe benefits are paid in cash as part of the hourly rate (box 4(b)).</p>
        <div class="cp-sign">
          <div>
            <label class="field-label">Date paid</label>
            <input class="input" type="date" id="cpPayDate" value="${escAttr(m.payDate)}">
          </div>
          <div>
            <label class="field-label">Signed by</label>
            <input class="input" id="cpSignerName" value="${escAttr(m.signerName)}">
          </div>
          <div>
            <label class="field-label">Title</label>
            <input class="input" id="cpSignerTitle" value="${escAttr(m.signerTitle)}">
          </div>
          <div class="cp-grid-wide">
            <label class="field-label">Exceptions / remarks (prints on page two)</label>
            <input class="input" id="cpNotes" value="${escAttr(m.notes)}" placeholder="e.g. Overtime premium for hours over 40 paid on the following check.">
          </div>
        </div>
      </div>

      <div class="cp-actions">
        <button class="btn2 btn2-line small" id="printBtn">Print WH-347 / Save as PDF</button>
        <button class="btn2 btn2-ghost small" id="csvBtn">Download CSV for LCPtracker</button>
        <span class="spacer"></span>
        <span class="cp-save-msg" id="saveMsg"></span>
        ${m.status === 'submitted'
          ? `<button class="btn2 btn2-ghost small" id="reopenBtn">Reopen for correction</button>`
          : `<button class="btn2 btn2-solid small" id="submitBtn">Mark submitted to LCPtracker as #${m.payrollNo}</button>`}
      </div>
    </div>`;

  ['cpPayDate', 'cpSignerName', 'cpSignerTitle', 'cpNotes'].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener('focus', () => { editing = true; });
    el.addEventListener('blur', () => { editing = false; saveDraft(); });
    el.addEventListener('change', () => { saveDraft(); });
  });
  document.getElementById('printBtn').addEventListener('click', printReport);
  document.getElementById('csvBtn').addEventListener('click', downloadCsv);
  const submitBtn = document.getElementById('submitBtn');
  if (submitBtn) submitBtn.addEventListener('click', () => setStatus('submitted'));
  const reopenBtn = document.getElementById('reopenBtn');
  if (reopenBtn) reopenBtn.addEventListener('click', () => setStatus('draft'));
}

function draftFields() {
  return {
    p_pay_date: val('cpPayDate') || null,
    p_signer_name: val('cpSignerName') || null,
    p_signer_title: val('cpSignerTitle') || null,
    p_notes: val('cpNotes') || null,
  };
}

function say(text, cls) {
  const el = document.getElementById('saveMsg');
  if (!el) return;
  el.className = 'cp-save-msg' + (cls ? ' ' + cls : '');
  el.textContent = text;
}

// The date, signer and remarks save themselves a moment after they change so
// nobody has to remember a Save button before printing.
function saveDraft() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (!data) return;
    const status = (data.report && data.report.status) || 'draft';
    const { data: row, error } = await sb.rpc('save_certified_payroll',
      Object.assign({ p_job: jobId, p_week: ymd(weekStart), p_status: status }, draftFields()));
    if (error) { say('Not saved: ' + error.message, 'bad'); return; }
    data.report = row;
    say('Saved', 'ok');
    setTimeout(() => say(''), 2000);
  }, 300);
}

async function setStatus(status) {
  if (!data) return;
  if (status === 'submitted') {
    const bad = collectWarnings().filter(w => w.level === 'bad');
    const msg = bad.length
      ? `There are ${bad.length} things flagged above that LCPtracker or the owner will bounce. Mark this week submitted anyway?`
      : `Mark the week of ${formatWeekLabel(weekStart)} as submitted to LCPtracker? It takes payroll number ${reportMeta().payrollNo} and freezes a copy of the figures.`;
    if (!confirm(msg)) return;
  }
  const snapshot = status === 'submitted' ? { generated_at: new Date().toISOString(), meta: reportMeta(), workers: data.workers, job: data.job } : null;
  const { data: row, error } = await sb.rpc('save_certified_payroll',
    Object.assign({ p_job: jobId, p_week: ymd(weekStart), p_status: status, p_snapshot: snapshot }, draftFields()));
  if (error) { say('Could not save: ' + error.message, 'bad'); return; }
  data.report = row;
  await loadWeeks();
  document.getElementById('weekSelect').value = ymd(weekStart);
  renderWarnings();
  renderReport();
}

// ---------- CSV for LCPtracker ----------
//
// One row per man per day he was on site, with the week's totals repeated on
// each so a row stands on its own. LCPtracker's own upload template can be
// downloaded from inside the account (Upload Payroll Records); these are the
// same figures, laid out so they paste straight into it or into manual entry.
function downloadCsv() {
  const m = reportMeta();
  const rows = [[
    'Payroll No', 'Project', 'Project No', 'Week Ending', 'Date Paid',
    'Last Name', 'First Name', 'SSN Last 4', 'Address', 'Classification',
    'Date', 'ST Hours', 'OT Hours', 'Base Rate', 'OT Rate', 'Fringe Paid In Cash',
    'Project Gross (week)', 'All Work Gross (week)', 'Deductions', 'Net Paid (week)'
  ]];
  (data.workers || []).forEach(w => {
    const parts = String(w.name).trim().split(/\s+/);
    const first = parts.slice(0, -1).join(' ') || parts[0];
    const last = parts.length > 1 ? parts[parts.length - 1] : '';
    const pw = prevailingFor(w.classification);
    w.days.filter(d => Number(d.hours) > 0).forEach(d => {
      rows.push([
        m.payrollNo, m.projectName, m.projectNumber, data.week_end, m.payDate,
        last, first, w.ssn_last4 || '', w.home_address || '', w.classification || '',
        d.date, num(d.st), num(d.ot), num(w.rate), num(Number(w.rate) * 1.5), pw ? num(pw.fringe) : '',
        num(w.gross_project), num(w.gross_week), '0', num(w.gross_week)
      ]);
    });
  });
  const csv = rows.map(r => r.map(c => {
    const s = c == null ? '' : String(c);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `certified-payroll-${(m.projectName || 'project').replace(/[^\w]+/g, '-').toLowerCase()}-we-${data.week_end}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ---------- printable WH-347 ----------

const WH347_CSS = `
  body{margin:0;background:#f4f3f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1c1917;font-size:11px;line-height:1.4;}
  .bar{max-width:1040px;margin:0 auto;padding:12px 24px;display:flex;gap:10px;justify-content:flex-end;}
  .bar button{font:inherit;font-weight:600;padding:8px 16px;border-radius:7px;border:1px solid #1c1917;background:#1c1917;color:#fff;cursor:pointer;}
  .sheet{max-width:1040px;margin:0 auto 18px;background:#fff;padding:26px 30px 30px;}
  .hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1c1917;padding-bottom:10px;gap:20px;}
  .hd h1{margin:0;font-size:15px;text-transform:uppercase;letter-spacing:.06em;}
  .hd .form{font-size:9.5px;color:#78716c;margin-top:2px;}
  .hd .no{text-align:right;font-size:12px;} .hd .no b{font-size:18px;display:block;}
  .meta{display:grid;grid-template-columns:repeat(4,1fr);gap:8px 16px;margin:12px 0 14px;}
  .meta div{border-bottom:1px solid #d6d3d1;padding-bottom:4px;}
  .meta label{display:block;font-size:8.5px;text-transform:uppercase;letter-spacing:.07em;color:#78716c;}
  .meta span{font-size:11.5px;font-weight:600;}
  .meta .w2{grid-column:span 2;}
  table{width:100%;border-collapse:collapse;}
  th{font-size:8px;text-transform:uppercase;letter-spacing:.05em;color:#57534e;text-align:center;padding:5px 4px;border:1px solid #a8a29e;background:#faf9f7;font-weight:600;vertical-align:bottom;}
  td{padding:5px 5px;border:1px solid #a8a29e;text-align:right;font-variant-numeric:tabular-nums;vertical-align:top;}
  td.l,th.l{text-align:left;} td.c{text-align:center;}
  td .sub{display:block;font-size:9px;color:#78716c;font-weight:400;}
  td.day{width:34px;padding:3px;text-align:center;} td.day .o{display:block;font-size:9px;color:#57534e;} td.day .s{display:block;}
  tr.tot td{font-weight:700;background:#faf9f7;}
  .foot{margin-top:10px;font-size:9.5px;color:#57534e;line-height:1.45;}
  h2{font-size:14px;text-transform:uppercase;letter-spacing:.06em;margin:0 0 12px;}
  .soc p{margin:0 0 9px;font-size:11px;line-height:1.5;}
  .soc .box{display:inline-block;width:11px;height:11px;border:1.5px solid #1c1917;vertical-align:-1px;margin-right:6px;text-align:center;font-size:9px;line-height:9px;}
  .soc .ind{margin-left:22px;}
  .fill{display:inline-block;min-width:160px;border-bottom:1px solid #1c1917;padding:0 4px;font-weight:600;}
  .sig{margin-top:34px;display:flex;gap:40px;}
  .sig div{flex:1;border-top:1px solid #1c1917;padding-top:5px;font-size:9.5px;color:#57534e;}
  .sig div b{display:block;font-size:11.5px;color:#1c1917;}
  .warn{margin-top:14px;font-size:9.5px;color:#7c2d12;border:1px solid #fdba74;background:#fff7ed;padding:8px 10px;border-radius:6px;}
  @media print{body{background:#fff}.bar{display:none}.sheet{max-width:none;margin:0;padding:0;page-break-after:always}.sheet:last-child{page-break-after:auto}@page{size:landscape;margin:12mm}}
`;

function printReport() {
  const m = reportMeta();
  const c = data.company || {};
  const workers = data.workers || [];
  const dates = workers[0].days.map(d => d.date);
  const tot = workers.reduce((a, w) => {
    a.hours += Number(w.hours_project); a.gross += Number(w.gross_project); a.grossAll += Number(w.gross_week); return a;
  }, { hours: 0, gross: 0, grossAll: 0 });
  const otMen = workers.filter(w => Number(w.ot_project) > 0);
  const remarks = [m.notes].filter(Boolean);

  const page1 = `
    <div class="sheet">
      <div class="hd">
        <div>
          <h1>Payroll — certified payroll report</h1>
          <div class="form">Laid out per U.S. Department of Labor Form WH-347 (optional form; the same content is required). Submitted through LCPtracker.</div>
        </div>
        <div class="no">Payroll No.<b>${m.payrollNo}</b>For week ending ${esc(longDate(fromYmd(data.week_end)))}</div>
      </div>
      <div class="meta">
        <div class="w2"><label>Name of contractor / subcontractor</label><span>${esc(c.company_name || 'State of the Arc Welding & Services LLC')} &nbsp;(subcontractor)</span></div>
        <div class="w2"><label>Address</label><span>${esc(c.company_address || '')}${c.company_phone ? ' &middot; ' + esc(c.company_phone) : ''}</span></div>
        <div class="w2"><label>Project and location</label><span>${esc(m.projectName)}${m.site ? ' &mdash; ' + esc(m.site) : ''}</span></div>
        <div><label>Project or contract no.</label><span>${esc(m.projectNumber || '—')}</span></div>
        <div><label>Owner / contracting agency</label><span>${esc(m.agency || '—')}</span></div>
      </div>
      <table>
        <thead>
          <tr>
            <th class="l" rowspan="2">(1) Name and individual identifying number of worker</th>
            <th rowspan="2">(2) No. of w/h exemptions</th>
            <th class="l" rowspan="2">(3) Work classification</th>
            <th rowspan="2">O / S</th>
            <th colspan="7">(4) Day and date — hours worked each day</th>
            <th rowspan="2">(5) Total hours</th>
            <th rowspan="2">(6) Rate of pay (incl. fringe)</th>
            <th rowspan="2">(7) Gross amount earned<br>this project / all work</th>
            <th colspan="4">(8) Deductions</th>
            <th rowspan="2">(9) Net wages paid for week</th>
          </tr>
          <tr>
            ${dates.map(d => `<th>${esc(dow(d))}<br>${esc(mmdd(d))}</th>`).join('')}
            <th>FICA</th><th>W/H tax</th><th>Other</th><th>Total ded.</th>
          </tr>
        </thead>
        <tbody>
          ${workers.map(w => `
            <tr>
              <td class="l"><b>${esc(w.name)}</b><span class="sub">${w.ssn_last4 ? 'XXX-XX-' + esc(w.ssn_last4) : 'ID not on file'}</span>${w.home_address ? `<span class="sub">${esc(w.home_address)}</span>` : ''}</td>
              <td class="c">—</td>
              <td class="l">${esc(w.classification || '')}</td>
              <td class="c"><span class="sub">O</span>S</td>
              ${w.days.map(d => `<td class="day"><span class="o">${Number(d.ot) > 0 ? num(d.ot) : ''}</span><span class="s">${Number(d.st) > 0 ? num(d.st) : ''}</span></td>`).join('')}
              <td>${num(w.hours_project)}${Number(w.ot_project) > 0 ? `<span class="sub">${num(w.st_project)} S / ${num(w.ot_project)} O</span>` : ''}</td>
              <td>${money(w.rate)}<span class="sub">fringe in cash</span></td>
              <td>${money(w.gross_project)}<span class="sub">/ ${money(w.gross_week)}</span></td>
              <td>0.00</td><td>0.00</td><td>0.00</td><td>0.00</td>
              <td><b>${money(w.gross_week)}</b></td>
            </tr>`).join('')}
          <tr class="tot">
            <td class="l" colspan="4">Totals — ${workers.length} workers</td>
            ${dates.map(d => `<td class="day">${num(workers.reduce((s, w) => s + Number((w.days.find(x => x.date === d) || {}).hours || 0), 0)) || ''}</td>`).join('')}
            <td>${num(tot.hours)}</td><td></td>
            <td>${money(tot.gross)}<span class="sub">/ ${money(tot.grossAll)}</span></td>
            <td>0.00</td><td>0.00</td><td>0.00</td><td>0.00</td>
            <td>${money(tot.grossAll)}</td>
          </tr>
        </tbody>
      </table>
      <div class="foot">Hours in column 4 are hours worked at the project site. "All work" in columns 7 and 9 is the worker's
        full week across every job including per diem, which is how the form asks for it. Workers are engaged as contract
        labor and no payroll deductions are taken; the amounts shown are the amounts paid. Overtime (O) is hours past 40 in
        the Monday–Sunday work week.</div>
    </div>`;

  const page2 = `
    <div class="sheet soc">
      <h2>Statement of compliance</h2>
      <p>Date: <span class="fill">${esc(longDate(new Date()))}</span></p>
      <p>I, <span class="fill">${esc(m.signerName)}</span>, <span class="fill">${esc(m.signerTitle)}</span> of
        <span class="fill">${esc(c.company_name || 'State of the Arc Welding & Services LLC')}</span>, do hereby state:</p>
      <p>(1) That I pay or supervise the payment of the persons employed by ${esc(c.company_name || 'State of the Arc Welding & Services LLC')}
        on the <span class="fill">${esc(m.projectName)}</span>; that during the payroll period commencing on the
        <span class="fill">${esc(longDate(fromYmd(data.week_start)))}</span> and ending the <span class="fill">${esc(longDate(fromYmd(data.week_end)))}</span>,
        all persons employed on said project have been paid the full weekly wages earned, that no rebates have been or will be
        made either directly or indirectly to or on behalf of said ${esc(c.company_name || 'State of the Arc Welding & Services LLC')}
        from the full weekly wages earned by any person, and that no deductions have been made either directly or indirectly
        from the full wages earned by any person, other than permissible deductions as defined in Regulations, Part 3
        (29 C.F.R. Subtitle A), issued by the Secretary of Labor under the Copeland Act, as amended (48 Stat. 948, 63 Stat. 108,
        72 Stat. 967; 76 Stat. 357; 40 U.S.C. § 3145), and described below:</p>
      <p class="ind">${remarks.length ? esc(remarks.join(' ')) : 'None.'}</p>
      <p>(2) That any payrolls otherwise under this contract required to be submitted for the above period are correct and
        complete; that the wage rates for laborers or mechanics contained therein are not less than the applicable wage rates
        contained in any wage determination incorporated into the contract; that the classifications set forth therein for
        each laborer or mechanic conform with the work he or she performed.</p>
      <p>(3) That any apprentices employed in the above period are duly registered in a bona fide apprenticeship program
        registered with a State apprenticeship agency recognized by the Bureau of Apprenticeship and Training, United States
        Department of Labor, or if no such recognized agency exists in a State, are registered with the Bureau of
        Apprenticeship and Training, United States Department of Labor.</p>
      <p>(4) That:</p>
      <p class="ind"><span class="box"></span>(a) WHERE FRINGE BENEFITS ARE PAID TO APPROVED PLANS, FUNDS, OR PROGRAMS — in addition to the basic
        hourly wage rates paid to each laborer or mechanic listed in the above referenced payroll, payments of fringe benefits
        as listed in the contract have been or will be made to appropriate programs for the benefit of such employees, except
        as noted in section 4(c) below.</p>
      <p class="ind"><span class="box">&#10003;</span>(b) WHERE FRINGE BENEFITS ARE PAID IN CASH — each laborer or mechanic listed in the above referenced
        payroll has been paid, as indicated on the payroll, an amount not less than the sum of the applicable basic hourly wage
        rate plus the amount of the required fringe benefits as listed in the contract, except as noted in section 4(c) below.</p>
      <p class="ind"><span class="box"></span>(c) EXCEPTIONS: <span class="fill">${esc(remarks.length ? remarks.join(' ') : '')}</span></p>
      <p>Date paid: <span class="fill">${esc(fmtDate(m.payDate))}</span></p>
      <div class="sig">
        <div><b>${esc(m.signerName)}</b>Name and signature</div>
        <div><b>${esc(m.signerTitle)}</b>Title</div>
        <div><b>${esc(longDate(new Date()))}</b>Date</div>
      </div>
      <p style="margin-top:22px;font-size:9.5px;color:#57534e;">The willful falsification of any of the above statements may subject the contractor or subcontractor to civil or
        criminal prosecution. See section 1001 of Title 18 and section 3729 of Title 31 of the United States Code.</p>
      ${otMen.length ? `<div class="warn">Note for the office (does not certify anything): ${otMen.map(w => `${esc(w.name)} ${num(w.ot_project)} h`).join(', ')} past 40 hours were paid at straight time. Prevailing wage work requires time and a half; pay the premium and list it in the exceptions before this is submitted.</div>` : ''}
    </div>`;

  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>Certified payroll ${esc(String(m.payrollNo))} — ${esc(m.projectName)} — week ending ${esc(data.week_end)}</title>
<style>${WH347_CSS}</style></head><body>
<div class="bar"><button onclick="window.print()">Print / Save as PDF</button></div>
${page1}${page2}
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) { alert('Your browser blocked the print window. Allow pop-ups for sotaweld.com and try again.'); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

// ---------- wiring ----------

document.getElementById('jobSelect').addEventListener('change', async (e) => {
  jobId = e.target.value || null;
  localStorage.setItem('cp_job', jobId || '');
  await loadWeeks();
  // Land on the latest week with site hours; there is nothing to look at on
  // a week the crew was not there.
  if (weekList.length && !weekList.some(w => w.week_start === ymd(weekStart))) weekStart = fromYmd(weekList[0].week_start);
  document.getElementById('weekSelect').value = weekList.some(w => w.week_start === ymd(weekStart)) ? ymd(weekStart) : '';
  await loadReport();
});
document.getElementById('weekSelect').addEventListener('change', async (e) => {
  if (!e.target.value) return;
  weekStart = fromYmd(e.target.value);
  await loadReport();
});
document.getElementById('prevWeekBtn').addEventListener('click', async () => {
  weekStart = addDays(weekStart, -7);
  document.getElementById('weekSelect').value = weekList.some(w => w.week_start === ymd(weekStart)) ? ymd(weekStart) : '';
  await loadReport();
});
document.getElementById('nextWeekBtn').addEventListener('click', async () => {
  weekStart = addDays(weekStart, 7);
  document.getElementById('weekSelect').value = weekList.some(w => w.week_start === ymd(weekStart)) ? ymd(weekStart) : '';
  await loadReport();
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

  await loadJobs();
  await loadWeeks();
  if (weekList.length && !weekList.some(w => w.week_start === ymd(weekStart))) weekStart = fromYmd(weekList[0].week_start);
  document.getElementById('weekSelect').value = weekList.some(w => w.week_start === ymd(weekStart)) ? ymd(weekStart) : '';
  await loadReport();

  await liveData({
    reload: async () => { await loadWeeks(); await loadReport(); },
    isBusy: () => editing,
    tables: ['daily_entries', 'daily_entry_helpers', 'jobs', 'profiles', 'helpers'],
    channel: 'certified-payroll'
  });
})();
