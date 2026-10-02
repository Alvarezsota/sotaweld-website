// A JSA every morning.
//
// Electric Hydrogen's Site Specific Safety Plan for Project Roadrunner does not
// leave this open: "All work performed onsite must be documented daily with a
// Job Safety Analysis (JSA). All contractors participating in the work scope
// described by the JSA will sign the JSA." It goes in before work starts and is
// reviewed no later than the Daily Work Coordination Meeting.
//
// The same plan says what we are allowed to do about the typing: a pre-generated
// JSA with job steps, hazards and controls is a permitted starting point, but it
// "must still be considered and made job specific for that day." So this page
// opens carrying yesterday's sheet for that job and says so in gold at the top.
// Nothing is submitted until somebody has read it and signed it.
//
// One sheet per job per day. A second crew on the same job adds its steps and
// its signatures to the same sheet, because one sheet per job per day is what
// the client is handed.

const PPE_MIN = [
  ['Type II hard hat', 'Worn to the manufacturer’s instructions'],
  ['Safety glasses, ANSI Z87.1', 'All work activities'],
  ['Safety-toed boots', 'Steel toe around heavy loads'],
  ['Gloves to suit the hazard', 'Electrical, chemical, cut, impact'],
  ['Full-length pants', 'Nothing dangling or loose near machinery'],
  ['Shirt covering the shoulders', 'Sleeves down for hot work'],
  ['High-visibility vest or shirt', 'Anywhere equipment is moving'],
];

const PPE_EXTRA = [
  'FR clothing',
  'Welding hood and leathers',
  'Face shield',
  'Goggles',
  'Hearing protection',
  'Respirator (fit tested)',
  'Arc flash PPE',
  'Chemical-resistant PPE',
  'Fall harness and lanyard',
  'Metatarsal guards',
  'Insulating boots or gloves',
  'Personal gas monitor',
];

// Section 10.0 of the plan, word for word, with what trips each one.
const PERMITS = [
  ['Hot Work', 'Welding, burning, grinding — or any ignition source in a classified area'],
  ['Working at Heights', 'Anything needing active fall protection; lifts inspected daily'],
  ['Energized Electrical Work', 'Work on energized equipment above 50V'],
  ['Excavation and Trenching', 'Trench over 5 ft, or known or suspected hazards'],
  ['Critical Lift', 'Over 100,000 lb, or 75% of the crane’s rated capacity, or two cranes'],
  ['Confined Space', 'Permit required confined space entry'],
  ['Silica Exposure Control Plan', 'Work that can put respirable silica in the air'],
];

/* What a site needs in the emergency box before anybody has filled one in
   there. After the first JSA on a job the sheet carries itself forward, so this
   only ever gets used once per job -- it is a starting point, not a record.
   Matched on the job name because that is what the office types. */
const SITE_DEFAULTS = [
  {
    match: /roadrunner|electric hydrogen|\beh2\b/i,
    site: 'Project Roadrunner — Pecos, TX',
    emergency: {
      muster: 'Site muster point as briefed at the morning toolbox talk',
      hospital: 'Reeves County Hospital, 2323 Texas St, Pecos TX — (432) 447-3551',
      rep: 'Rafael Gonzalez (EH2 EHS on site)',
      rep_phone: '956-429-7019',
      caller: 'Crew lead calls 911, then the EH2 EHS rep. Report every incident immediately, however minor.',
    },
  },
];

let currentUser = null;
let currentProfile = null;
let jobs = [];
let hazards = [];
let people = [];          // names typed in by hand, kept
let crew = [];            // ours
let sheet = null;         // the jsa_reports row, or null until it is saved
let steps = [];           // {id?, task, hazards, controls, permit}
let sigs = [];
let ppeOn = new Set();
let permitsOn = new Set();
let recent = [];
let carriedFrom = null;    // the date we copied this sheet off, if we did
let busy = false;
let loading = false;
/* Anything typed and not yet saved. A live refresh is held while this is set:
   a redraw that quietly throws away three written steps is the worst thing
   this page could do. */
let dirty = false;

const $ = (id) => document.getElementById(id);
const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const escAttr = (s) => esc(s).replace(/"/g, '&quot;');
const trim = (s) => String(s ?? '').trim();

const isAdmin = () => !!(currentProfile && currentProfile.role === 'admin');
/* Row-level security lets a man edit only his own draft. An admin edits any of
   them, including after it has gone in, because the plan requires a JSA to be
   revised the moment the scope changes. Everybody else can still sign. */
const canEdit = () => !sheet
  || isAdmin()
  || (sheet.created_by === currentUser.id && sheet.status === 'draft');

function dayLabel(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined,
    { weekday: 'long', month: 'short', day: 'numeric' });
}
function shortDay(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined,
    { weekday: 'short', month: 'numeric', day: 'numeric' });
}

function say(id, text, kind) {
  const el = $(id);
  if (!el) return;
  el.textContent = text || '';
  el.className = 'jsa-msg' + (kind ? ` jsa-msg-${kind}` : '');
}

function cleanError(err) {
  const m = String((err && (err.message || err.error_description)) || err || '');
  if (/row-level security/i.test(m)) {
    return 'This JSA belongs to somebody else. You can still sign it — ask the office to change it.';
  }
  if (/duplicate key|jsa_reports_one_per_job_day/i.test(m)) {
    return 'There is already a JSA for that job on that day. Reloading it.';
  }
  if (/jsa_people_one_per_name/i.test(m)) return 'That name is already saved.';
  return m || 'Something went wrong. Try again.';
}

/* ------------------------------------------------------------------ loading */

async function loadWho() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return false; }
  currentUser = session.user;

  const { data: prof } = await sb.from('profiles')
    .select('id, full_name, role, pay_kind').eq('id', currentUser.id).maybeSingle();
  currentProfile = prof || null;

  $('userName').textContent = (prof && prof.full_name) || currentUser.email || '';
  if (isAdmin()) {
    $('adminBadge').style.display = '';
    $('adminNavLinks').style.display = '';
  }
  return true;
}

async function loadLibrary() {
  const [hz, pp, jb, cw] = await Promise.all([
    sb.from('jsa_hazards').select('*').eq('active', true).order('sort_order'),
    sb.from('jsa_people').select('*').eq('active', true).order('person_name'),
    sb.from('jobs').select('id, name, operator, bill_to, active').order('name'),
    sb.from('profiles').select('id, full_name, pay_kind, active')
      .eq('active', true).order('full_name'),
  ]);
  hazards = hz.data || [];
  people = pp.data || [];
  jobs = (jb.data || []).filter((j) => j.active);
  crew = (cw.data || []).filter((p) => p.pay_kind !== 'office');

  fillHazardPicker();
  fillJobPicker();
  fillLeadPicker();
  fillSigPicker();
}

function fillHazardPicker() {
  const sel = $('hazPick');
  const groups = [];
  hazards.forEach((h) => {
    let g = groups.find((x) => x.name === h.category);
    if (!g) { g = { name: h.category, rows: [] }; groups.push(g); }
    g.rows.push(h);
  });
  sel.innerHTML = '<option value="">Add a hazard from the list&hellip;</option>' +
    groups.map((g) => `<optgroup label="${escAttr(g.name)}">` +
      g.rows.map((h) => `<option value="${h.id}">${esc(h.hazard)}` +
        `${h.permit ? ' — needs a permit' : ''}</option>`).join('') +
      '</optgroup>').join('');
}

function fillJobPicker() {
  $('jsaJob').innerHTML = '<option value="">Pick the job&hellip;</option>' +
    jobs.map((j) => `<option value="${j.id}">${esc(j.name)}</option>`).join('');
}

function fillLeadPicker() {
  $('jsaLead').innerHTML = '<option value="">Nobody picked</option>' +
    crew.map((p) => `<option value="${p.id}">${esc(p.full_name)}</option>`).join('');
}

/* Our men, then every name anybody has ever typed in, then the way to type a
   new one. The typing is the point: the EH2 safety rep has no login here and
   never will, and his name should only be spelled out once. */
function fillSigPicker() {
  const mine = crew.map((p) =>
    `<option value="p:${p.id}">${esc(p.full_name)}</option>`).join('');
  const saved = people.map((p) =>
    `<option value="s:${p.id}">${esc(p.person_name)}` +
    `${p.company ? ` — ${esc(p.company)}` : ''}</option>`).join('');
  $('sigWho').innerHTML =
    '<option value="">Pick who is signing&hellip;</option>' +
    (mine ? `<optgroup label="Our crew">${mine}</optgroup>` : '') +
    (saved ? `<optgroup label="Saved names">${saved}</optgroup>` : '') +
    '<optgroup label="Not on the list"><option value="new">Type a new name&hellip;</option></optgroup>';
}

/* --------------------------------------------------------- opening a sheet */

// The day and job on screen decide which sheet this is. Change either and the
// sheet for that pair loads -- the one already going, or a fresh one carried
// over off the last JSA for that job.
async function openSheet() {
  const date = $('jsaDate').value;
  const jobId = $('jsaJob').value;
  if (!date || !jobId) {
    sheet = null; steps = []; sigs = []; carriedFrom = null;
    ppeOn = new Set(PPE_MIN.map((r) => r[0]));
    permitsOn = new Set();
    renderAll();
    $('statusLine').textContent = 'Pick the day and the job.';
    return;
  }

  loading = true;
  try {
    const { data: found, error } = await sb.from('jsa_reports')
      .select('*').eq('jsa_date', date).eq('job_id', jobId).maybeSingle();
    if (error) throw error;

    if (found) {
      sheet = found;
      carriedFrom = null;
      const [{ data: st }, { data: sg }] = await Promise.all([
        sb.from('jsa_steps').select('*').eq('jsa_id', found.id).order('step_no'),
        sb.from('jsa_signatures').select('*').eq('jsa_id', found.id).order('signed_at'),
      ]);
      steps = (st || []).map((r) => ({
        id: r.id, task: r.task, hazards: r.hazards, controls: r.controls,
        permit: permitForHazard(r.hazards),
      }));
      sigs = sg || [];
      ppeOn = new Set(Array.isArray(found.ppe) ? found.ppe : []);
      PPE_MIN.forEach((r) => ppeOn.add(r[0]));
      permitsOn = new Set(Array.isArray(found.permits) ? found.permits : []);
      writeHeadFields(found);
    } else {
      await startFresh(date, jobId);
    }
  } catch (err) {
    say('formMsg', cleanError(err), 'err');
  } finally {
    loading = false;
    dirty = false;
  }
  renderAll();
}

// The last JSA on this job, copied forward. The gold bar says where it came
// from, because a sheet that pretends to be new when it is a copy of Tuesday
// is exactly what the plan is warning about.
async function startFresh(date, jobId) {
  const { data: prev } = await sb.from('jsa_reports')
    .select('*').eq('job_id', jobId).lt('jsa_date', date)
    .order('jsa_date', { ascending: false }).limit(1).maybeSingle();

  sheet = null;
  sigs = [];
  const job = jobs.find((j) => j.id === jobId);
  const preset = SITE_DEFAULTS.find((d) => job && d.match.test(job.name)) || null;

  if (prev) {
    carriedFrom = prev.jsa_date;
    const { data: st } = await sb.from('jsa_steps')
      .select('*').eq('jsa_id', prev.id).order('step_no');
    steps = (st || []).map((r) => ({
      task: r.task, hazards: r.hazards, controls: r.controls,
      permit: permitForHazard(r.hazards),
    }));
    ppeOn = new Set(Array.isArray(prev.ppe) ? prev.ppe : []);
    permitsOn = new Set(Array.isArray(prev.permits) ? prev.permits : []);
    writeHeadFields({
      site_name: prev.site_name,
      work_scope: prev.work_scope,
      crew_lead_id: prev.crew_lead_id,
      start_time: prev.start_time,
      end_time: prev.end_time,
      weather: '',                       // never yesterday's weather
      emergency: prev.emergency,
    });
  } else {
    carriedFrom = null;
    steps = [];
    ppeOn = new Set();
    permitsOn = new Set();
    writeHeadFields({
      site_name: preset ? preset.site : (job ? (job.operator || '') : ''),
      work_scope: '',
      crew_lead_id: crew.some((p) => p.id === currentUser.id) ? currentUser.id : '',
      start_time: '07:00',
      end_time: '17:00',
      weather: '',
      emergency: preset ? preset.emergency : {},
    });
  }
  PPE_MIN.forEach((r) => ppeOn.add(r[0]));
}

function permitForHazard(hazardText) {
  const h = hazards.find((x) => x.hazard === hazardText);
  return h ? h.permit : null;
}

function writeHeadFields(r) {
  $('jsaSite').value = r.site_name || '';
  $('jsaScope').value = r.work_scope || '';
  $('jsaLead').value = r.crew_lead_id || '';
  $('jsaStart').value = r.start_time || '07:00';
  $('jsaEnd').value = r.end_time || '17:00';
  $('jsaWeather').value = r.weather || '';
  const em = r.emergency || {};
  $('emMuster').value = em.muster || '';
  $('emHospital').value = em.hospital || '';
  $('emRep').value = em.rep || '';
  $('emRepPhone').value = em.rep_phone || '';
  $('emCaller').value = em.caller || '';
  $('stopWork').checked = !!r.stop_work_ack;
}

function readHeadFields() {
  return {
    jsa_date: $('jsaDate').value,
    job_id: $('jsaJob').value || null,
    site_name: trim($('jsaSite').value) || null,
    work_scope: trim($('jsaScope').value) || null,
    crew_lead_id: $('jsaLead').value || null,
    start_time: $('jsaStart').value || null,
    end_time: $('jsaEnd').value || null,
    weather: trim($('jsaWeather').value) || null,
    ppe: [...ppeOn],
    permits: [...permitsOn],
    emergency: {
      muster: trim($('emMuster').value),
      hospital: trim($('emHospital').value),
      rep: trim($('emRep').value),
      rep_phone: trim($('emRepPhone').value),
      caller: trim($('emCaller').value),
    },
    stop_work_ack: $('stopWork').checked,
  };
}

/* ----------------------------------------------------------------- drawing */

function renderAll() {
  renderSteps();
  renderTicks();
  renderSigs();
  renderStatus();
  renderLock();
}

function renderStatus() {
  const note = $('carriedNote');
  if (carriedFrom) {
    note.hidden = false;
    note.innerHTML = `Carried over from the JSA of <b>${esc(dayLabel(carriedFrom))}</b>. ` +
      'Read every line and change what is different today — that is what EH2 asks for, ' +
      'and it is why this is not already signed.';
  } else {
    note.hidden = true;
  }

  const el = $('statusLine');
  if (!sheet) {
    el.className = 'jsa-status';
    el.textContent = $('jsaJob').value
      ? 'Not saved yet.'
      : 'Pick the day and the job.';
    return;
  }
  if (sheet.status === 'submitted') {
    el.className = 'jsa-status is-in';
    const when = sheet.submitted_at
      ? new Date(sheet.submitted_at).toLocaleString(undefined,
        { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : '';
    el.textContent = `Handed in${when ? ` ${when}` : ''}.`;
  } else {
    el.className = 'jsa-status';
    el.textContent = 'Saved as a draft. It is not handed in until you hand it in.';
  }
}

// Somebody else's sheet, or one already in, is read-only for everybody but an
// admin -- but signing it stays open, because that is the whole point of
// passing the phone down the line.
function renderLock() {
  const ro = !canEdit();
  ['jsaSite', 'jsaScope', 'jsaLead', 'jsaStart', 'jsaEnd', 'jsaWeather',
    'emMuster', 'emHospital', 'emRep', 'emRepPhone', 'emCaller'].forEach((id) => {
    const el = $(id);
    if (!el) return;
    if (el.tagName === 'SELECT') el.disabled = ro; else el.readOnly = ro;
  });
  $('stopWork').disabled = ro;
  $('hazPick').disabled = ro;
  $('addBlankStep').disabled = ro;
  $('saveBtn').disabled = ro;
  $('submitBtn').disabled = ro || (sheet && sheet.status === 'submitted');
  $('submitBtn').textContent = (sheet && sheet.status === 'submitted')
    ? 'Already in' : 'Hand it in';
}

function renderSteps() {
  const ro = !canEdit();
  $('stepCount').textContent = steps.length
    ? `${steps.length} ${steps.length === 1 ? 'step' : 'steps'}` : '';
  if (!steps.length) {
    $('stepList').innerHTML =
      '<p class="empty-state2">No steps yet. Pick a hazard off the list, or start a blank row.</p>';
    return;
  }
  $('stepList').innerHTML = steps.map((s, i) => `
    <div class="jsa-step" data-i="${i}">
      <div class="jsa-step-head">
        <span class="jsa-step-no">Step ${i + 1}</span>
        ${ro ? '' : '<button type="button" class="jsa-step-kill" data-kill="' + i + '">Remove</button>'}
      </div>
      <div class="jsa-step-rows">
        <label class="jsa-step-row"><span>The step</span>
          <input type="text" class="input" data-f="task" value="${escAttr(s.task)}"
            placeholder="What we actually do" ${ro ? 'readonly' : ''}></label>
        <label class="jsa-step-row"><span>Hazard</span>
          <textarea class="input" data-f="hazards" rows="2"
            placeholder="What can hurt somebody" ${ro ? 'readonly' : ''}>${esc(s.hazards)}</textarea></label>
        <label class="jsa-step-row"><span>How it is controlled</span>
          <textarea class="input" data-f="controls" rows="3"
            placeholder="What we do about it" ${ro ? 'readonly' : ''}>${esc(s.controls)}</textarea></label>
      </div>
      ${s.permit ? `<p class="jsa-step-permit">Needs the ${esc(s.permit)} permit — ticked below.</p>` : ''}
    </div>`).join('');
}

function renderTicks() {
  const ro = !canEdit();
  const row = (label, why, on, fixed, kind) => `
    <label class="jsa-tick${on ? ' is-on' : ''}${fixed ? ' is-fixed' : ''}">
      <input type="checkbox" data-tick="${kind}" value="${escAttr(label)}"
        ${on ? 'checked' : ''} ${(fixed || ro) ? 'disabled' : ''}>
      <span>${esc(label)}${why ? `<span class="jsa-tick-why">${esc(why)}</span>` : ''}</span>
    </label>`;

  $('ppeList').innerHTML =
    PPE_MIN.map(([l, why]) => row(l, why, true, true, 'ppe')).join('') +
    PPE_EXTRA.map((l) => row(l, '', ppeOn.has(l), false, 'ppe')).join('');

  $('permitList').innerHTML = PERMITS.map(([l, why]) =>
    row(l, why, permitsOn.has(l), false, 'permit')).join('');
}

function renderSigs() {
  $('sigCount').textContent = sigs.length
    ? `${sigs.length} signed` : 'nobody yet';
  if (!sigs.length) {
    $('sigList').innerHTML =
      '<p class="empty-state2">Nobody has signed this yet. Every man doing the work signs it, ' +
      'and so does the EH2 safety rep when he reviews it.</p>';
    return;
  }
  $('sigList').innerHTML = sigs.map((s) => {
    const when = new Date(s.signed_at).toLocaleString(undefined,
      { hour: 'numeric', minute: '2-digit' });
    const sub = [s.company, s.craft].filter(Boolean).join(' · ');
    const mine = isAdmin() || s.signed_by === currentUser.id;
    return `<div class="jsa-sig">
      <div class="jsa-sig-mark">${s.signature
        ? `<img src="${escAttr(s.signature)}" alt="signature">`
        : '<span style="color:#7a828d;font-size:11px">no mark</span>'}</div>
      <div class="jsa-sig-who">
        <div class="jsa-sig-name">${esc(s.person_name)}</div>
        <div class="jsa-sig-sub">${esc(sub)}${sub ? ' · ' : ''}signed ${esc(when)}</div>
      </div>
      ${mine ? `<button type="button" class="jsa-sig-kill" data-unsign="${s.id}">Remove</button>` : ''}
    </div>`;
  }).join('');
}

function renderRecent() {
  if (!recent.length) {
    $('recentList').innerHTML = '<p class="empty-state2">No JSAs filed yet.</p>';
    return;
  }
  $('recentList').innerHTML = recent.map((r) => {
    const job = jobs.find((j) => j.id === r.job_id);
    const n = r.sig_count || 0;
    return `<div class="jsa-row" data-open="${r.id}"
        data-date="${escAttr(r.jsa_date)}" data-job="${escAttr(r.job_id || '')}">
      <div class="jsa-row-day">${esc(shortDay(r.jsa_date))}</div>
      <div class="jsa-row-job">${esc(job ? job.name : (r.site_name || 'No job'))}
        <span>${r.step_count || 0} steps · ${n} signed</span></div>
      <div class="jsa-row-tag${r.status === 'submitted' ? ' is-in' : ''}">
        ${r.status === 'submitted' ? 'In' : 'Draft'}</div>
    </div>`;
  }).join('');
}

async function loadRecent() {
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const { data } = await sb.from('jsa_reports')
    .select('id, jsa_date, job_id, site_name, status, jsa_steps(id), jsa_signatures(id)')
    .gte('jsa_date', ymd(since))
    .order('jsa_date', { ascending: false });
  recent = (data || []).map((r) => ({
    ...r,
    step_count: (r.jsa_steps || []).length,
    sig_count: (r.jsa_signatures || []).length,
  }));
  renderRecent();
}

/* ------------------------------------------------------------------ saving */

// Steps are saved row by row rather than wiped and rewritten. A phone that
// drops signal between the delete and the insert would otherwise lose the whole
// sheet, which is the one thing that must not happen to a safety document.
async function saveSteps(jsaId) {
  const { data: have } = await sb.from('jsa_steps').select('id').eq('jsa_id', jsaId);
  const haveIds = new Set((have || []).map((r) => r.id));

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const row = {
      jsa_id: jsaId, step_no: i + 1,
      task: trim(s.task) || '(not written)',
      hazards: trim(s.hazards), controls: trim(s.controls),
    };
    if (s.id && haveIds.has(s.id)) {
      const { error } = await sb.from('jsa_steps').update(row).eq('id', s.id);
      if (error) throw error;
      haveIds.delete(s.id);
    } else {
      const { data, error } = await sb.from('jsa_steps').insert(row).select('id').single();
      if (error) throw error;
      s.id = data.id;
    }
  }
  // Only now, with every kept row written, do the removed ones go.
  for (const id of haveIds) {
    const { error } = await sb.from('jsa_steps').delete().eq('id', id);
    if (error) throw error;
  }
}

async function saveSheet({ submit = false } = {}) {
  const head = readHeadFields();
  if (!head.jsa_date || !head.job_id) {
    say('formMsg', 'Pick the day and the job first.', 'err');
    return null;
  }

  const patch = { ...head, updated_at: new Date().toISOString() };
  if (submit) { patch.status = 'submitted'; patch.submitted_at = new Date().toISOString(); }

  if (sheet) {
    const { data, error } = await sb.from('jsa_reports')
      .update(patch).eq('id', sheet.id).select('*').single();
    if (error) throw error;
    sheet = data;
  } else {
    const { data, error } = await sb.from('jsa_reports')
      .insert({ ...patch, created_by: currentUser.id }).select('*').single();
    if (error) {
      // Somebody on another phone started the same sheet in the meantime.
      if (/duplicate key|one_per_job_day/i.test(error.message || '')) {
        await openSheet();
        say('formMsg', 'Somebody had already started this one. It is on screen now — check it before you hand it in.', 'err');
        return null;
      }
      throw error;
    }
    sheet = data;
  }

  await saveSteps(sheet.id);
  dirty = false;
  return sheet;
}

// Signing needs a row to hang off, so a sheet nobody has saved gets saved first.
async function ensureSaved() {
  if (sheet) return sheet;
  return await saveSheet();
}

/* -------------------------------------------------------- the signature pad */

const pad = (() => {
  const cv = $('sigPad');
  const ctx = cv.getContext('2d');
  let drawing = false;
  let marked = false;

  function reset() {
    ctx.fillStyle = '#F4F6F9';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.strokeStyle = '#10141A';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    marked = false;
  }

  // The canvas is 1040x320 but drawn at whatever width the phone is, so every
  // touch has to be scaled into canvas space or the line lands somewhere else.
  function at(e) {
    const r = cv.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (cv.width / r.width),
      y: (e.clientY - r.top) * (cv.height / r.height),
    };
  }

  cv.addEventListener('pointerdown', (e) => {
    drawing = true;
    cv.setPointerCapture(e.pointerId);
    const p = at(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    // A dot counts: some men sign with an X and two taps.
    ctx.lineTo(p.x + 0.1, p.y);
    ctx.stroke();
    marked = true;
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = at(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  });
  const stop = () => { drawing = false; };
  cv.addEventListener('pointerup', stop);
  cv.addEventListener('pointercancel', stop);
  cv.addEventListener('pointerleave', stop);

  reset();
  return {
    clear: reset,
    isMarked: () => marked,
    // PNG, not JPEG: a signature is a thin black line on a flat ground and JPEG
    // turns that into a grey smear. These run a few kilobytes.
    data: () => cv.toDataURL('image/png'),
  };
})();

/* ----------------------------------------------------------- the print copy */

const SHEET_CSS = `
*{box-sizing:border-box}
body{margin:0;background:#fff;color:#111;font:13px/1.45 -apple-system,BlinkMacSystemFont,
 "Segoe UI",Helvetica,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.bar{padding:10px 14px;background:#111;color:#fff;display:flex;gap:10px;align-items:center}
.bar button{font:inherit;font-weight:700;padding:7px 14px;border:none;border-radius:6px;
 background:#E9A23B;color:#150F04;cursor:pointer}
.bar span{font-size:12px;opacity:.8}
.sheet{width:7.9in;margin:0 auto;padding:0.35in 0.4in}
h1{font-size:19px;margin:0;letter-spacing:.01em}
.co{font-size:11px;color:#555;margin:2px 0 0}
.hd{display:flex;justify-content:space-between;align-items:flex-start;
 border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:12px}
.hd .rt{text-align:right;font-size:11px;color:#555}
table{width:100%;border-collapse:collapse;margin-bottom:12px}
th,td{border:1px solid #999;padding:5px 7px;vertical-align:top;font-size:11.5px}
th{background:#eceff3;text-align:left;font-size:9.5px;letter-spacing:.09em;
 text-transform:uppercase;color:#333;font-weight:700}
.kv th{width:1.35in}
.steps th:nth-child(1){width:0.4in}
.steps th:nth-child(2){width:1.9in}
.steps th:nth-child(3){width:2.3in}
h2{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#333;
 margin:14px 0 6px;border-bottom:1px solid #bbb;padding-bottom:3px}
.cols{display:flex;gap:16px}
.cols>div{flex:1}
ul{margin:0;padding-left:16px}
li{font-size:11.5px;margin-bottom:2px}
.none{font-size:11.5px;color:#777;font-style:italic}
.sigs th:nth-child(1){width:1.6in}
.sigs th:nth-child(2){width:1.3in}
.sigs th:nth-child(3){width:1.1in}
.sigs th:nth-child(4){width:1.9in}
.sigs img{height:0.42in;display:block}
.sigline{height:0.42in;border-bottom:1px solid #111}
.note{font-size:10px;color:#555;line-height:1.5;margin-top:14px;
 border-top:1px solid #bbb;padding-top:8px}
.ack{font-size:11px;margin:10px 0 0;padding:7px 9px;border:1px solid #999;background:#f7f8fa}
@media print{.bar{display:none}.sheet{width:auto;padding:0}@page{margin:0.45in}}
`;

function openPrintWindow(html) {
  const win = window.open('', '_blank');
  if (!win) {
    alert('Your browser blocked the pop-up. Allow pop-ups for sotaweld.com and try again.');
    return null;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  return win;
}

function kvRow(label, value) {
  return `<tr><th>${esc(label)}</th><td>${esc(value || '')}</td></tr>`;
}

function sheetHtml({ blank = false } = {}) {
  const head = readHeadFields();
  const job = jobs.find((j) => j.id === head.job_id);
  const lead = crew.find((p) => p.id === head.crew_lead_id);
  const em = head.emergency;
  const blanks = (n) => Array.from({ length: n });

  const stepRows = blank
    ? blanks(8).map((_, i) =>
      `<tr><td>${i + 1}</td><td>&nbsp;<br>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>`).join('')
    : (steps.length
      ? steps.map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.task)}</td>` +
        `<td>${esc(s.hazards)}</td><td>${esc(s.controls)}</td></tr>`).join('')
      : '<tr><td colspan="4" class="none">No steps written.</td></tr>');

  const ppeList = blank
    ? PPE_MIN.map(([l]) => `<li>${esc(l)}</li>`).join('') +
      PPE_EXTRA.map((l) => `<li>&#9744; ${esc(l)}</li>`).join('')
    : [...ppeOn].map((l) => `<li>${esc(l)}</li>`).join('');

  const permitList = blank
    ? PERMITS.map(([l]) => `<li>&#9744; ${esc(l)}</li>`).join('')
    : (permitsOn.size
      ? [...permitsOn].map((l) => `<li>${esc(l)}</li>`).join('')
      : '<li class="none">None required for this work.</li>');

  const sigRows = blank
    ? blanks(10).map(() =>
      '<tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td><div class="sigline"></div></td></tr>').join('')
    : (sigs.length
      ? sigs.map((s) => `<tr><td>${esc(s.person_name)}</td><td>${esc(s.company || '')}</td>` +
        `<td>${esc(s.craft || '')}</td><td>${s.signature
          ? `<img src="${escAttr(s.signature)}" alt="">` : '<div class="sigline"></div>'}</td></tr>`).join('')
      : '<tr><td colspan="4" class="none">Not signed.</td></tr>') +
      blanks(3).map(() =>
        '<tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td><div class="sigline"></div></td></tr>').join('');

  const title = blank
    ? 'JSA — blank form'
    : `JSA — ${job ? job.name : 'no job'} — ${head.jsa_date}`;

  return `<!doctype html><html><head><meta charset="utf-8">
<title>${escAttr(title)}</title><style>${SHEET_CSS}</style></head><body>
<div class="bar"><button onclick="window.print()">Print / Save as PDF</button>
  <span>Save it as a PDF and email it, or print it and sign it by hand.</span></div>
<div class="sheet">
  <div class="hd">
    <div>
      <h1>Job Safety Analysis</h1>
      <p class="co">State of the Arc Welding &amp; Services LLC &middot; Odessa, TX &middot; (432) 248-1455</p>
    </div>
    <div class="rt">${blank ? 'Blank form' : esc(dayLabel(head.jsa_date))}<br>
      ${blank ? '' : ((sheet && sheet.status === 'submitted') ? 'Handed in' : 'Draft')}</div>
  </div>

  <table class="kv">
    ${kvRow('Date', blank ? '' : head.jsa_date)}
    ${kvRow('Job', blank ? '' : (job ? job.name : ''))}
    ${kvRow('Site / facility', blank ? '' : head.site_name)}
    ${kvRow('Client / operator', blank ? '' : (job ? (job.operator || job.bill_to || '') : ''))}
    ${kvRow('Crew lead', blank ? '' : (lead ? lead.full_name : ''))}
    ${kvRow('Hours', blank ? '' : [head.start_time, head.end_time].filter(Boolean).join(' to '))}
    ${kvRow('Weather / heat index', blank ? '' : head.weather)}
    ${kvRow('Scope of work', blank ? '' : head.work_scope)}
  </table>

  <h2>Steps, hazards and controls</h2>
  <table class="steps">
    <tr><th>#</th><th>Step</th><th>Hazard</th><th>How it is controlled</th></tr>
    ${stepRows}
  </table>

  <div class="cols">
    <div><h2>PPE</h2><ul>${ppeList}</ul></div>
    <div><h2>High risk work permits</h2><ul>${permitList}</ul></div>
  </div>

  <h2>If something goes wrong</h2>
  <table class="kv">
    ${kvRow('Muster point', blank ? '' : em.muster)}
    ${kvRow('Nearest hospital', blank ? '' : em.hospital)}
    ${kvRow('Site safety rep', blank ? '' : [em.rep, em.rep_phone].filter(Boolean).join(' — '))}
    ${kvRow('Who calls 911', blank ? '' : em.caller)}
  </table>

  <p class="ack">${(blank || head.stop_work_ack) ? '&#9745;' : '&#9744;'}
    Every man on this crew has been told he has <b>stop work authority</b>. If the scope
    changes or a new hazard shows up, work stops, this JSA is changed, and it is re-signed
    and re-approved by the crew and the site safety rep before anybody carries on.</p>

  <h2>Signatures &mdash; everybody doing this work</h2>
  <table class="sigs">
    <tr><th>Printed name</th><th>Company</th><th>Title / craft</th><th>Signature</th></tr>
    ${sigRows}
  </table>

  <h2>Reviewed and approved</h2>
  <table class="sigs">
    <tr><th>Site safety rep</th><th>Company</th><th>Date</th><th>Signature</th></tr>
    <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td><div class="sigline"></div></td></tr>
  </table>

  <p class="note">Filling out a JSA: understand the job scope, break the job into clear
    manageable steps, identify the hazards of each step, and specify how those hazards
    will be mitigated. Hand this in before work begins in the morning. If the scope changes
    or a new hazard is found, stop work and revise it. Keep a copy on you while you work.</p>
</div></body></html>`;
}

/* ------------------------------------------------------------------ wiring */

// Everything typed anywhere on the sheet marks it unsaved. Cheap, and it is
// what holds a live refresh off until the work is written down.
document.querySelector('.jsa-wrap').addEventListener('input', (e) => {
  if (['jsaDate', 'jsaJob', 'hazPick', 'sigWho'].includes(e.target.id)) return;
  dirty = true;
});

$('jsaDate').addEventListener('change', openSheet);
$('jsaJob').addEventListener('change', openSheet);

$('hazPick').addEventListener('change', (e) => {
  const h = hazards.find((x) => x.id === e.target.value);
  e.target.value = '';
  if (!h) return;
  steps.push({ task: '', hazards: h.hazard, controls: h.controls, permit: h.permit });
  if (h.permit) permitsOn.add(h.permit);
  renderSteps();
  renderTicks();
  // Straight to the step he now has to write, so the new row is not somewhere
  // off the bottom of a phone screen.
  const last = $('stepList').lastElementChild;
  if (last) {
    last.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const f = last.querySelector('[data-f="task"]');
    if (f) f.focus();
  }
});

$('addBlankStep').addEventListener('click', () => {
  steps.push({ task: '', hazards: '', controls: '', permit: null });
  renderSteps();
  const last = $('stepList').lastElementChild;
  if (last) {
    last.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const f = last.querySelector('[data-f="task"]');
    if (f) f.focus();
  }
});

// Typing into a step writes straight into the list it was drawn from, so a
// redraw never throws away what somebody is in the middle of.
$('stepList').addEventListener('input', (e) => {
  const f = e.target.dataset.f;
  if (!f) return;
  const box = e.target.closest('.jsa-step');
  if (!box) return;
  steps[Number(box.dataset.i)][f] = e.target.value;
});

$('stepList').addEventListener('click', (e) => {
  const i = e.target.dataset.kill;
  if (i === undefined) return;
  steps.splice(Number(i), 1);
  renderSteps();
});

document.addEventListener('change', (e) => {
  const kind = e.target.dataset.tick;
  if (!kind) return;
  const set = kind === 'ppe' ? ppeOn : permitsOn;
  if (e.target.checked) set.add(e.target.value); else set.delete(e.target.value);
  e.target.closest('.jsa-tick').classList.toggle('is-on', e.target.checked);
});

// Three boxes appear only for a name nobody has typed before.
$('sigWho').addEventListener('change', (e) => {
  const isNew = e.target.value === 'new';
  document.querySelectorAll('.jsa-new-name').forEach((el) => { el.hidden = !isNew; });
  if (isNew) $('sigName').focus();
  say('sigMsg', '');
});

$('padClear').addEventListener('click', () => { pad.clear(); say('sigMsg', ''); });

$('sigAdd').addEventListener('click', async () => {
  if (busy) return;
  const pick = $('sigWho').value;
  if (!pick) { say('sigMsg', 'Pick who is signing.', 'err'); return; }
  if (!pad.isMarked()) { say('sigMsg', 'Sign in the box first.', 'err'); return; }

  let row = { person_id: null, person_name: '', company: null, craft: null };
  let savedName = null;

  if (pick === 'new') {
    const name = trim($('sigName').value);
    if (!name) { say('sigMsg', 'Type his name.', 'err'); return; }
    row.person_name = name;
    row.company = trim($('sigCompany').value) || null;
    row.craft = trim($('sigCraft').value) || null;
    savedName = { person_name: name, company: row.company, craft: row.craft };
  } else if (pick.startsWith('p:')) {
    const p = crew.find((x) => x.id === pick.slice(2));
    if (!p) { say('sigMsg', 'Could not find that man.', 'err'); return; }
    row.person_id = p.id;
    row.person_name = p.full_name;
    row.company = 'State of the Arc Welding';
  } else {
    const p = people.find((x) => x.id === pick.slice(2));
    if (!p) { say('sigMsg', 'Could not find that name.', 'err'); return; }
    row.person_name = p.person_name;
    row.company = p.company;
    row.craft = p.craft;
  }

  busy = true;
  const btn = $('sigAdd');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    const s = await ensureSaved();
    if (!s) return;

    const { data, error } = await sb.from('jsa_signatures')
      .insert({ ...row, jsa_id: s.id, signature: pad.data() })
      .select('*').single();
    if (error) throw error;
    sigs.push(data);

    /* A name typed in by hand is kept, so it is only ever typed once. An
       already-saved name comes back as a duplicate, which is not a failure --
       the signature is already written and that is what mattered. */
    if (savedName) {
      const { data: added, error: addErr } = await sb.from('jsa_people')
        .insert({ ...savedName, last_used: $('jsaDate').value })
        .select('*').single();
      if (!addErr && added) {
        people.push(added);
        people.sort((a, b) => a.person_name.localeCompare(b.person_name));
        fillSigPicker();
      }
      $('sigName').value = $('sigCompany').value = $('sigCraft').value = '';
    } else if (pick.startsWith('s:')) {
      sb.from('jsa_people').update({ last_used: $('jsaDate').value })
        .eq('id', pick.slice(2)).then(() => {}, () => {});
    }

    pad.clear();
    $('sigWho').value = '';
    document.querySelectorAll('.jsa-new-name').forEach((el) => { el.hidden = true; });
    renderSigs();
    renderStatus();
    renderLock();
    say('sigMsg', `${row.person_name} signed it. Pass the phone on.`, 'ok');
  } catch (err) {
    say('sigMsg', cleanError(err), 'err');
  } finally {
    busy = false;
    btn.disabled = false;
    btn.textContent = 'Add this signature';
  }
});

$('sigList').addEventListener('click', async (e) => {
  const id = e.target.dataset.unsign;
  if (!id) return;
  const s = sigs.find((x) => x.id === id);
  if (!s) return;
  if (!confirm(`Take ${s.person_name}'s signature off this JSA?`)) return;
  const { error } = await sb.from('jsa_signatures').delete().eq('id', id);
  if (error) { say('sigMsg', cleanError(error), 'err'); return; }
  sigs = sigs.filter((x) => x.id !== id);
  renderSigs();
});

$('saveBtn').addEventListener('click', async () => {
  if (busy) return;
  busy = true;
  const btn = $('saveBtn');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    const s = await saveSheet();
    if (s) {
      carriedFrom = null;
      say('formMsg', 'Saved. Not handed in yet.', 'ok');
      renderAll();
      await loadRecent();
    }
  } catch (err) {
    say('formMsg', cleanError(err), 'err');
  } finally {
    busy = false;
    btn.disabled = false;
    btn.textContent = 'Save';
    renderLock();
  }
});

$('submitBtn').addEventListener('click', async () => {
  if (busy) return;
  const head = readHeadFields();
  // Refused rather than queried: these are the things that make it a JSA
  // instead of a piece of paper.
  if (!head.job_id) { say('formMsg', 'Pick the job.', 'err'); return; }
  if (!head.work_scope) { say('formMsg', 'Write what the crew is doing today.', 'err'); return; }
  if (!steps.length) { say('formMsg', 'A JSA with no steps is not a JSA. Add at least one.', 'err'); return; }
  const thin = steps.find((s) => !trim(s.task) || !trim(s.hazards) || !trim(s.controls));
  if (thin) {
    say('formMsg', 'Every step needs the step, the hazard and the control filled in.', 'err');
    return;
  }
  if (!head.stop_work_ack) { say('formMsg', 'Tick the stop work line at the bottom.', 'err'); return; }
  if (!sigs.length) { say('formMsg', 'Nobody has signed it. Everybody doing the work signs before it goes in.', 'err'); return; }

  busy = true;
  const btn = $('submitBtn');
  btn.disabled = true;
  btn.textContent = 'Handing in…';
  try {
    const s = await saveSheet({ submit: true });
    if (s) {
      carriedFrom = null;
      say('formMsg', 'Handed in. Print it, give the EH2 safety rep his copy, and keep one on you.', 'ok');
      renderAll();
      await loadRecent();
    }
  } catch (err) {
    say('formMsg', cleanError(err), 'err');
  } finally {
    busy = false;
    btn.textContent = 'Hand it in';
    renderLock();
  }
});

$('printBtn').addEventListener('click', () => {
  if (!$('jsaJob').value) { say('formMsg', 'Pick the job first.', 'err'); return; }
  openPrintWindow(sheetHtml());
});

$('blankBtn').addEventListener('click', () => openPrintWindow(sheetHtml({ blank: true })));

$('recentList').addEventListener('click', async (e) => {
  const row = e.target.closest('[data-open]');
  if (!row) return;
  $('jsaDate').value = row.dataset.date;
  $('jsaJob').value = row.dataset.job;
  say('formMsg', '');
  await openSheet();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

$('logoutBtn').addEventListener('click', async () => {
  await sb.auth.signOut();
  window.location.href = 'login.html';
});

/* -------------------------------------------------------------------- start */

async function reload() {
  await openSheet();
  await loadRecent();
}

(async function start() {
  if (!(await loadWho())) return;
  $('jsaDate').value = ymd(new Date());
  await loadLibrary();

  // Most mornings there is one job the crew is on, and if it is the only one
  // with a JSA this month it is almost certainly today's. Pick it so the sheet
  // is already on screen rather than two taps away.
  await loadRecent();
  const lastJob = recent.length ? recent[0].job_id : null;
  if (lastJob && jobs.some((j) => j.id === lastJob)) $('jsaJob').value = lastJob;

  await openSheet();

  // A signature added on the crew lead's phone should show up on the office
  // screen without anybody refreshing. Held while something is being typed, so
  // a redraw cannot land on top of a half-written step.
  liveData({
    reload,
    isBusy: () => busy || loading || dirty || (!!document.activeElement
      && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)),
    tables: ['jsa_reports', 'jsa_steps', 'jsa_signatures'],
    channel: 'jsa',
  });
})();
