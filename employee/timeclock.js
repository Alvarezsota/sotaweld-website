// The office clock.
//
// Everybody else in this portal files a ticket: how many hours, against which
// job, so the customer can be billed for them. Alexis is paid for being here,
// not for a job, so there is nothing to type -- she taps when she arrives, taps
// for lunch, taps when she leaves, and the week adds itself up.
//
// This file never writes a time. Every punch goes through office_punch(), which
// closes what is open and opens what is next in one transaction, stamped by the
// database's clock. A phone twenty minutes fast cannot write a day twenty
// minutes wrong, and a phone that drops signal halfway through going to lunch
// either did both writes or neither.

let currentUser = null;
let currentProfile = null;
let whoId = null;             // whose clock is on screen
let officeStaff = [];         // admins only: everybody who punches
let openPunch = null;         // the stretch running right now, or null
let todayRows = [];
let weekStart = null;
let weekDays = [];
let weekTotals = null;
/* The QuickBooks pay period the week on screen falls in, and what that run
   should be paid. Not the same seven days as the week above it, which is the
   whole reason it is here. */
let payPeriod = null;
let periodTotals = null;
let busy = false;
let editingId = null;

const $ = (id) => document.getElementById(id);

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const escAttr = (s) => esc(s).replace(/"/g, '&quot;');
const num = (v) => Number(v) || 0;

function getMonday(d) {
  const x = new Date(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));   // Mon = 0
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

const clockTime = (iso) => iso
  ? new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  : '';

/* Hours as a person says them. 8.45 is a number off a payroll form; "8h 27m" is
   what she worked. Both appear -- the first is what goes in QuickBooks, the
   second is what she checks it against. */
function hm(hours) {
  const mins = Math.max(0, Math.round(num(hours) * 60));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m}m`;
  if (!m) return `${h}h`;
  return `${h}h ${m}m`;
}
const hoursFmt = (h) => num(h).toFixed(2);

const dayLabel = (d) => d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
function weekLabelText(start) {
  const end = addDays(start, 6);
  const sameMonth = start.getMonth() === end.getMonth();
  const l = (d, withMonth) =>
    d.toLocaleDateString(undefined, withMonth ? { month: 'short', day: 'numeric' } : { day: 'numeric' });
  return `${l(start, true)} – ${l(end, !sameMonth)}, ${end.getFullYear()}`;
}

const isAdmin = () => !!(currentProfile && currentProfile.role === 'admin');
const isMine = () => whoId === (currentUser && currentUser.id);
function whoName() {
  if (isMine()) return 'you';
  const p = officeStaff.find((x) => x.id === whoId);
  return p ? p.full_name : 'this person';
}

function say(text, kind) {
  const el = $('clockMsg');
  el.textContent = text || '';
  el.className = 'tc-msg' + (kind ? ` tc-msg-${kind}` : '');
}

/* ------------------------------------------------------------------ loading */

async function loadWho() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return false; }
  currentUser = session.user;

  const { data: prof } = await sb.from('profiles')
    .select('id, full_name, role, pay_kind, pay_rate, qb_employee_id')
    .eq('id', currentUser.id).maybeSingle();
  currentProfile = prof || null;

  $('userName').textContent = (prof && prof.full_name) || currentUser.email || '';
  if (isAdmin()) {
    $('adminBadge').style.display = '';
    $('adminNavLinks').style.display = '';
  } else {
    // Office staff have no job to log and no welds to report. Leaving those
    // links up invites a ticket nobody will ever bill.
    const crew = $('crewNavLinks');
    if (crew && currentProfile && currentProfile.pay_kind === 'office') crew.remove();
  }

  whoId = currentUser.id;

  if (isAdmin()) {
    const { data } = await sb.from('profiles')
      .select('id, full_name, pay_kind, pay_rate, qb_employee_id, active')
      .eq('pay_kind', 'office').order('full_name');
    officeStaff = data || [];
    // An admin who is not himself office staff has no clock of his own worth
    // looking at, so the page opens on the first person who does.
    if (currentProfile && currentProfile.pay_kind !== 'office' && officeStaff.length) {
      whoId = officeStaff[0].id;
    }
    if (currentProfile && currentProfile.pay_kind === 'office'
        && !officeStaff.some((p) => p.id === currentProfile.id)) {
      officeStaff.unshift(currentProfile);
    }
    renderWhose();
  }
  return true;
}

function renderWhose() {
  if (!isAdmin() || officeStaff.length < 1) return;
  const bar = $('whoseBar');
  bar.hidden = false;
  $('whoPick').innerHTML = officeStaff.map((p) =>
    `<option value="${escAttr(p.id)}"${p.id === whoId ? ' selected' : ''}>${esc(p.full_name)}${
      p.active === false ? ' (archived)' : ''}</option>`).join('');
}

async function loadState() {
  const { data } = await sb.from('time_entries')
    .select('id, kind, clock_in')
    .eq('employee_id', whoId).is('clock_out', null).maybeSingle();
  openPunch = data || null;
}

async function loadToday() {
  const { data } = await sb.from('time_entries')
    .select('id, kind, clock_in, clock_out, note, edited_by, edited_at')
    .eq('employee_id', whoId).eq('work_date', ymd(new Date()))
    .order('clock_in');
  todayRows = data || [];
}

async function loadWeek() {
  const from = ymd(weekStart);
  const to = ymd(addDays(weekStart, 6));
  const [{ data: days }, { data: weeks }] = await Promise.all([
    sb.from('office_time_days')
      .select('work_date, hours, lunch_hours, first_in, last_out, on_the_clock')
      .eq('employee_id', whoId).gte('work_date', from).lte('work_date', to)
      .order('work_date'),
    sb.from('office_time_weeks')
      .select('*').eq('employee_id', whoId).eq('week_start', from).maybeSingle(),
  ]);
  weekDays = days || [];
  weekTotals = weeks || null;
  await loadPeriod();
}

/* The pay period only matters to whoever is typing the payroll run, so it is
   not fetched for the person clocking in and out. Asked for by the LAST day of
   the week on screen: a Monday-to-Sunday week reaches into two Thursday-to-
   Wednesday periods, and the later one is the run still to be paid. */
async function loadPeriod() {
  if (!isAdmin()) { payPeriod = null; periodTotals = null; return; }
  const { data: p } = await sb.rpc('office_pay_period', { p_for: ymd(addDays(weekStart, 6)) });
  payPeriod = (Array.isArray(p) ? p[0] : p) || null;
  if (!payPeriod) { periodTotals = null; return; }
  const { data: t } = await sb.rpc('office_period_totals', {
    p_employee: whoId,
    p_start: payPeriod.period_start,
    p_end: payPeriod.period_end,
  });
  periodTotals = (Array.isArray(t) ? t[0] : t) || null;
}

async function reload() {
  await Promise.all([loadState(), loadToday(), loadWeek()]);
  render();
}

/* ------------------------------------------------------------------ drawing */

function renderClock() {
  $('nowClock').textContent =
    new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  const state = openPunch ? openPunch.kind : 'out';
  const card = $('clockCard');
  card.className = 'tc-clock tc-' + state;

  const whose = isMine() ? '' : ` — ${esc(whoName())}`;
  if (state === 'work') {
    const since = new Date(openPunch.clock_in);
    const so_far = (Date.now() - since.getTime()) / 3600000;
    $('stateLine').innerHTML = `On the clock${whose}`;
    $('sinceLine').textContent = `Since ${clockTime(openPunch.clock_in)} · ${hm(so_far)} so far`;
  } else if (state === 'lunch') {
    const since = new Date(openPunch.clock_in);
    $('stateLine').innerHTML = `At lunch${whose}`;
    $('sinceLine').textContent =
      `Since ${clockTime(openPunch.clock_in)} · ${hm((Date.now() - since.getTime()) / 3600000)} · not paid`;
  } else {
    const worked = todayRows.length
      ? todayRows.filter((r) => r.kind === 'work' && r.clock_out)
          .reduce((a, r) => a + (new Date(r.clock_out) - new Date(r.clock_in)) / 3600000, 0)
      : 0;
    $('stateLine').innerHTML = `Clocked out${whose}`;
    $('sinceLine').textContent = todayRows.length
      ? `${hm(worked)} on the books today`
      : 'Nothing on the clock today yet';
  }

  const btn = (act, label, cls) =>
    `<button type="button" class="tc-btn ${cls}" data-punch="${act}">${label}</button>`;

  let buttons = '';
  if (state === 'out') buttons = btn('in', 'Clock in', 'tc-btn-go');
  else if (state === 'work') {
    buttons = btn('lunch', 'Start lunch', 'tc-btn-soft') + btn('out', 'Clock out', 'tc-btn-stop');
  } else {
    buttons = btn('back', 'Back from lunch', 'tc-btn-go') + btn('out', 'Clock out', 'tc-btn-stop');
  }
  $('clockButtons').innerHTML = buttons;
}

function punchRowHtml(r) {
  const open = !r.clock_out;
  const len = open
    ? (Date.now() - new Date(r.clock_in)) / 3600000
    : (new Date(r.clock_out) - new Date(r.clock_in)) / 3600000;
  const lunch = r.kind === 'lunch';
  return `
    <div class="tc-punch${lunch ? ' is-lunch' : ''}${open ? ' is-open' : ''}" data-punch-id="${escAttr(r.id)}">
      <span class="tc-punch-kind">${lunch ? 'Lunch' : 'Worked'}</span>
      <span class="tc-punch-times">${esc(clockTime(r.clock_in))} &ndash; ${
        open ? '<em>still going</em>' : esc(clockTime(r.clock_out))}</span>
      <span class="tc-punch-len">${lunch ? '&mdash;' : esc(hm(len))}</span>
      ${r.edited_at ? '<span class="tc-fixed" title="This time was corrected by the office">corrected</span>' : ''}
      ${isAdmin() ? `<button type="button" class="tc-fix" data-action="fix">${
        editingId === r.id ? 'Cancel' : 'Fix'}</button>` : '<span></span>'}
    </div>
    ${editingId === r.id ? fixPanelHtml(r) : ''}`;
}

/* Correcting a punch is an admin job and a rare one: she forgets to clock out
   and goes home, and Monday's ten o'clock is still running on Tuesday. The two
   boxes are the times as they should have been; the database refuses anything
   that overlaps another stretch or lands in the future. */
function fixPanelHtml(r) {
  const forInput = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  return `
    <div class="tc-fixbox" data-punch-id="${escAttr(r.id)}">
      <label class="tc-fix-field"><span>In</span>
        <input type="datetime-local" class="input tc-fix-in" value="${escAttr(forInput(r.clock_in))}"></label>
      <label class="tc-fix-field"><span>Out</span>
        <input type="datetime-local" class="input tc-fix-out" value="${escAttr(forInput(r.clock_out))}"
          placeholder="still going"></label>
      <button type="button" class="btn2 btn2-solid small" data-action="save-fix">Save</button>
      <button type="button" class="btn2 btn2-line small" data-action="drop-punch">Delete</button>
      <p class="tc-fix-msg"></p>
    </div>`;
}

function renderToday() {
  const worked = todayRows.filter((r) => r.kind === 'work')
    .reduce((a, r) => a + ((r.clock_out ? new Date(r.clock_out) : new Date()) - new Date(r.clock_in)) / 3600000, 0);
  $('todayTotal').textContent = todayRows.length ? `${hm(worked)} · ${hoursFmt(worked)} hrs` : '';
  $('todayList').innerHTML = todayRows.length
    ? todayRows.map(punchRowHtml).join('')
    : `<p class="tc-empty">No punches today.${
        isMine() ? ' Tap Clock in when you get here.' : ''}</p>`;
}

function renderWeek() {
  $('weekLabel').textContent = weekLabelText(weekStart);

  const byDate = {};
  weekDays.forEach((d) => { byDate[d.work_date] = d; });

  const today = ymd(new Date());
  let rows = '';
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i);
    const key = ymd(d);
    const row = byDate[key];
    const isToday = key === today;
    const hours = row ? num(row.hours) : 0;
    // An empty cell still takes a row on a phone, where the day stacks. A day
    // nobody worked has nothing to say, so it says nothing and stays one line.
    const span = row && row.first_in
      ? `${esc(clockTime(row.first_in))} &ndash; ${row.on_the_clock && !row.last_out
          ? '<em>on the clock</em>' : esc(clockTime(row.last_out))}` : '';
    const lunch = row && num(row.lunch_hours) ? `${esc(hm(row.lunch_hours))} lunch` : '';

    rows += `
      <div class="tc-day${isToday ? ' is-today' : ''}${hours ? '' : ' is-empty'}">
        <span class="tc-day-name">${esc(dayLabel(d))}${isToday ? ' <span class="tc-today-tag">today</span>' : ''}</span>
        ${span ? `<span class="tc-day-span">${span}</span>` : ''}
        ${lunch ? `<span class="tc-day-lunch">${lunch}</span>` : ''}
        <span class="tc-day-hours">${hours ? `${esc(hoursFmt(hours))}` : '&mdash;'}</span>
      </div>`;
  }
  $('weekDays').innerHTML = rows;

  const t = weekTotals;
  const hours = t ? num(t.hours) : 0;
  const ot = t ? num(t.overtime_hours) : 0;
  const reg = t ? num(t.regular_hours) : 0;

  // Rounding each line to two decimals can leave regular + overtime a cent or
  // two off the week's own total. Show the total the view computed rather than
  // a sum of the two rounded pieces disagreeing with it on screen.
  $('payrollBox').innerHTML = `
    <div class="tc-pay-head">Week total</div>
    <div class="tc-pay-grid">
      <div class="tc-pay-cell">
        <span class="tc-pay-label">Hours worked</span>
        <span class="tc-pay-val">${esc(hoursFmt(hours))}</span>
        <span class="tc-pay-sub">${esc(hm(hours))}</span>
      </div>
      <div class="tc-pay-cell">
        <span class="tc-pay-label">Regular</span>
        <span class="tc-pay-val">${esc(hoursFmt(reg))}</span>
        <span class="tc-pay-sub">first 40 hours</span>
      </div>
      <div class="tc-pay-cell${ot ? ' is-ot' : ''}">
        <span class="tc-pay-label">Overtime</span>
        <span class="tc-pay-val">${esc(hoursFmt(ot))}</span>
        <span class="tc-pay-sub">${ot ? 'over 40, at time and a half' : 'none this week'}</span>
      </div>
      ${isAdmin() && t ? `
      <div class="tc-pay-cell">
        <span class="tc-pay-label">Gross</span>
        <span class="tc-pay-val">$${esc(num(t.gross_pay).toFixed(2))}</span>
        <span class="tc-pay-sub">at $${esc(num(t.pay_rate).toFixed(2))}/hr</span>
      </div>` : ''}
    </div>
    ${isAdmin() ? periodHtml(t) : ''}`;

  $('footNote').textContent = isMine()
    ? 'Your week runs Monday to Sunday. Anything over 40 hours in it is paid at time and a half.'
    : 'The week runs Monday to Sunday. Anything over 40 hours in it is paid at time and a half.';
}

/* What the payroll run is actually owed.
 *
 * The week above this is a workweek: Monday to Sunday, and over forty hours in
 * it is overtime. That is the law's unit and the shop's unit, and it is not
 * the unit QuickBooks pays in -- the pay period runs Thursday to Wednesday, so
 * every run takes part of one workweek and part of the next.
 *
 * Typing the week's total into the run would therefore pay the wrong number,
 * which is what this page used to invite. These figures are the hours that
 * fall inside the period, with overtime still decided by the workweek and
 * counted on the days it was worked.
 */
function periodHtml(weekRow) {
  if (!payPeriod || !periodTotals) return '';
  const p = periodTotals;
  const span = (a, b) => {
    const s = new Date(`${a}T12:00:00`);
    const e = new Date(`${b}T12:00:00`);
    const f = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `${f(s)} \u2013 ${f(e)}`;
  };
  const paid = new Date(`${payPeriod.pay_date}T12:00:00`);
  const differs = Math.abs(num(p.hours) - num(weekRow && weekRow.hours)) > 0.005;

  return `
    <div class="tc-period">
      <div class="tc-period-head">
        QuickBooks pay period &middot; ${esc(span(payPeriod.period_start, payPeriod.period_end))}
        <span class="tc-period-paid">paid ${esc(paid.toLocaleDateString(undefined,
          { weekday: 'short', month: 'short', day: 'numeric' }))}</span>
      </div>
      <div class="tc-period-nums">
        <span><b>${esc(hoursFmt(p.regular_hours))}</b> regular</span>
        <span><b>${esc(hoursFmt(p.overtime_hours))}</b> overtime</span>
        <span class="tc-period-gross">$${esc(num(p.gross_pay).toFixed(2))}</span>
      </div>
      <p class="tc-period-note">These are the numbers this run asks for${
        weekRow && weekRow.qb_employee_id ? `, for employee ${esc(weekRow.qb_employee_id)}` : ''}.${
        differs ? ' They are not the week above: the pay period runs Thursday to Wednesday '
          + 'and the workweek runs Monday to Sunday, so each run takes part of two weeks. '
          + 'Overtime is still worked out on the Monday-to-Sunday week.' : ''}</p>
    </div>`;
}

function render() {
  renderClock();
  renderToday();
  renderWeek();
}

/* ------------------------------------------------------------------ punching */

async function punch(action) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('[data-punch]').forEach((b) => { b.disabled = true; });
  say('');
  try {
    const { data, error } = await sb.rpc('office_punch', {
      p_action: action,
      p_employee: isMine() ? null : whoId,
    });
    if (error) throw error;
    const now = Array.isArray(data) ? data[0] : data;
    openPunch = now && now.state !== 'out'
      ? { id: now.entry_id, kind: now.state, clock_in: now.since }
      : null;
    await Promise.all([loadToday(), loadWeek()]);
    render();
    const said = {
      in: 'Clocked in.', lunch: 'Gone to lunch. The clock is stopped.',
      back: 'Back on the clock.', out: 'Clocked out. Have a good one.',
    };
    say(said[action] || '', 'ok');
  } catch (err) {
    // The database is the one that knows the real state, so redraw from it
    // rather than leaving a button that says something no longer true.
    say(cleanError(err), 'err');
    await reload();
  } finally {
    busy = false;
  }
}

// Postgres puts its own scaffolding round a raised message. She should read the
// sentence, not the stack.
function cleanError(err) {
  const raw = String((err && (err.message || err.hint || err.details)) || 'That did not go through.');
  return raw.replace(/^.*?(?:ERROR|error):\s*/i, '').trim() || 'That did not go through.';
}

/* -------------------------------------------------------------------- wiring */

$('clockButtons').addEventListener('click', (e) => {
  const b = e.target.closest('[data-punch]');
  if (b) punch(b.dataset.punch);
});

$('todayList').addEventListener('click', async (e) => {
  const fix = e.target.closest('[data-action="fix"]');
  if (fix) {
    const row = e.target.closest('[data-punch-id]');
    editingId = editingId === row.dataset.punchId ? null : row.dataset.punchId;
    renderToday();
    return;
  }

  const save = e.target.closest('[data-action="save-fix"]');
  const drop = e.target.closest('[data-action="drop-punch"]');
  if (!save && !drop) return;

  const box = e.target.closest('.tc-fixbox');
  const id = box.dataset.punchId;
  const msg = box.querySelector('.tc-fix-msg');
  msg.textContent = '';

  if (drop) {
    if (!confirm('Delete this punch? The hours on it come off the week.')) return;
    const { error } = await sb.from('time_entries').delete().eq('id', id);
    if (error) { msg.textContent = cleanError(error); return; }
    editingId = null;
    await reload();
    return;
  }

  const inVal = box.querySelector('.tc-fix-in').value;
  const outVal = box.querySelector('.tc-fix-out').value;
  if (!inVal) { msg.textContent = 'A punch needs a start.'; return; }

  const patch = {
    clock_in: new Date(inVal).toISOString(),
    clock_out: outVal ? new Date(outVal).toISOString() : null,
    edited_by: currentUser.id,
    edited_at: new Date().toISOString(),
  };
  const { error } = await sb.from('time_entries').update(patch).eq('id', id);
  if (error) { msg.textContent = cleanError(error); return; }
  editingId = null;
  await reload();
});

/* ----------------------------------------------------- a day already worked */

/* The earliest day that can be posted: Monday of last week. The same line the
   database draws, drawn again here so the date box will not even offer a day
   that is going to come back refused. */
function earliestPostable() {
  return addDays(getMonday(new Date()), -7);
}

function applyAddDayLimits() {
  const el = $('adDate');
  el.min = ymd(earliestPostable());
  el.max = ymd(new Date());
  if (!el.value) {
    // Yesterday, since a day you are posting after the fact is usually the one
    // just gone -- but never before the floor, on a Monday.
    const y = addDays(new Date(), -1);
    el.value = ymd(y < earliestPostable() ? new Date() : y);
  }
}

function addDaySay(text, kind) {
  const el = $('adMsg');
  el.textContent = text || '';
  el.className = 'tc-msg' + (kind ? ` tc-msg-${kind}` : '');
}

$('addDayToggle').addEventListener('click', () => {
  const box = $('addDayBox');
  box.hidden = !box.hidden;
  $('addDayToggle').textContent = box.hidden ? 'Post a day' : 'Close';
  if (!box.hidden) { applyAddDayLimits(); addDaySay(''); $('adDate').focus(); }
});

$('adCancel').addEventListener('click', () => {
  $('addDayBox').hidden = true;
  $('addDayToggle').textContent = 'Post a day';
  addDaySay('');
});

$('adSave').addEventListener('click', async () => {
  const btn = $('adSave');
  const date = $('adDate').value;
  const tIn = $('adIn').value;
  const tOut = $('adOut').value;
  const lOut = $('adLunchOut').value;
  const lIn = $('adLunchIn').value;

  if (!date) { addDaySay('Pick the day.', 'err'); return; }
  if (!tIn || !tOut) { addDaySay('A day needs a time in and a time out.', 'err'); return; }

  btn.disabled = true;
  btn.textContent = 'Posting...';
  addDaySay('');
  try {
    const { data, error } = await sb.rpc('office_add_day', {
      p_date: date,
      p_in: tIn,
      p_out: tOut,
      p_lunch_out: lOut || null,
      p_lunch_in: lIn || null,
      p_employee: isMine() ? null : whoId,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    const when = new Date(`${date}T12:00:00`);

    // Posting a day in the week on screen should show it landing. Posting one
    // in the week before means going and looking at a week nobody asked for,
    // so say what it came to instead.
    await reload();
    addDaySay(`${dayLabel(when)}: ${hoursFmt(row ? row.hours : 0)} hours posted.`, 'ok');
    $('adLunchOut').value = $('adLunchIn').value = '';
  } catch (err) {
    addDaySay(cleanError(err), 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Post this day';
  }
});

$('prevWeek').addEventListener('click', async () => {
  weekStart = addDays(weekStart, -7);
  await loadWeek();
  renderWeek();
});
$('nextWeek').addEventListener('click', async () => {
  const next = addDays(weekStart, 7);
  if (next > new Date()) return;            // nobody has worked next week
  weekStart = next;
  await loadWeek();
  renderWeek();
});

document.addEventListener('change', async (e) => {
  if (!e.target || e.target.id !== 'whoPick') return;
  whoId = e.target.value;
  editingId = null;
  await reload();
});

$('logoutBtn').addEventListener('click', async () => {
  await sb.auth.signOut();
  window.location.href = 'login.html';
});

/* The face of the clock and the "so far" counter are the only things on this
   page that change without anybody doing anything, so they tick on their own.
   Nothing is fetched -- the numbers are worked out from the punch already in
   hand, so a phone left open all day costs one request an hour, not one a
   minute. */
setInterval(() => {
  if (!document.hidden) renderClock();
}, 15000);

(async function start() {
  if (!(await loadWho())) return;
  weekStart = getMonday(new Date());
  applyAddDayLimits();
  await reload();

  // A punch made on the shop phone should show up on the office screen without
  // anybody refreshing. Held while a punch is going through or a time is being
  // corrected, so a redraw cannot land on top of somebody mid-edit.
  liveData({
    reload,
    isBusy: () => busy || !!editingId,
    tables: ['time_entries'],
    channel: 'timeclock',
  });
})();
