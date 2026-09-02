let currentUser = null;
let jobsById = {};
let helpersList = [];
let weldersList = [];
let weekStart = getMonday(new Date());
let openJobId = null;
let currentGroups = [];
let currentJobWeeks = {};
let weekAlreadyFiled = false;   // has this week's pay run gone to OneDrive yet
let nextInvoiceNumber = '';    // what an unnumbered week would be given, for the button

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
function escAttr(str) { return esc(str).replace(/"/g, '&quot;'); }
function money(n) { return '$' + Math.round(n).toLocaleString(); }
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
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

async function requireAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return null; }
  return session.user;
}

// Picks the first candidate that is an actual number. A blank override is not a
// zero - it means "nothing was set here, keep going" - which is what lets a rate
// be overridden to nothing on purpose without every empty box doing the same.
// This is coalesce(), and it is deliberately coalesce(), because the rate chains
// below have to come out the same as the ones in SQL.
function rateOr(...candidates) {
  for (const c of candidates) {
    if (c === null || c === undefined || c === '') continue;
    const n = Number(c);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

// One line on a ticket - a welder or a helper, his hours, and the money that
// falls out of them. Rates arrive already resolved; resolving them is the part
// that has to agree with SQL, and it happens in buildJobGroups.
//
// `overrides` and `fallbacks` are carried through untouched so the edit form can
// show what was typed and what the box would fall back to if it were cleared.
function personLine(o) {
  const pd = o.perDiem ? o.perDiemRate : 0;
  const isFlat = Array.isArray(o.parts);
  const partsSum = isFlat ? o.parts.reduce((s, p) => s + Number(p.quantity) * Number(p.rate), 0) : 0;
  const effectiveBillRate = (o.isStainless && !isFlat) ? o.stainlessRate : o.billRate;

  // Hours invoiced and hours paid are not always the same number: a class the
  // customer is charged eight hours for that the man got through quicker, a
  // day where he is paid a flat total across three jobs. Revenue comes off what
  // is billed, cost off what he is paid. Blank means they are the same, which
  // is the ordinary case. Matches pay_hours in v_work_lines -- change one,
  // change the other.
  const payHours = (o.payHours == null || o.payHours === '') ? o.hours : Number(o.payHours);
  const revenue = (isFlat ? partsSum : o.hours * effectiveBillRate) + pd;
  const cost = payHours * o.payRate + pd;
  return {
    role: o.role, name: o.name, hours: o.hours, payHours,
    payRate: o.payRate, billRate: effectiveBillRate,
    pd: o.perDiem ? pd : null, revenue, cost, margin: revenue - cost,
    entryId: o.entryId, helperRowId: o.helperRowId || null, description: o.description || '',
    realJobId: o.realJobId || null, realOneOffName: o.realOneOffName || '',
    helperId: o.helperId || null, perDiemFlag: !!o.perDiem,
    parts: isFlat ? o.parts : null,
    welderId: o.welderId || null, entryDate: o.entryDate || null, forJobId: o.forJobId || null,
    isStainless: !!o.isStainless,
    entryHasWelder: o.entryHasWelder !== false,
    overrides: o.overrides || {}, fallbacks: o.fallbacks || {}
  };
}

// A line carrying a set rate looks exactly like a line on the standing rate once
// it is drawn, so say so on its face. Otherwise the only way to find one is to
// open every line on the ticket.
function rateTag(l) {
  const o = l.overrides || {};
  const set = [];
  if (o.pay != null) set.push('pay');
  if (o.bill != null) set.push('bill');
  if (o.stainless != null) set.push('stainless');
  if (o.perDiem != null) set.push('per diem');
  return set.length ? `<div class="line-desc rate-tag">Rate set on this line: ${esc(set.join(', '))}</div>` : '';
}

/* Which job a job's work bills under.
 *
 * Itself, unless it is ticked to bill with the customer's other jobs and an
 * older ticked job shares that customer. This is bill_anchor_job() in
 * supabase/migrations/20260829_bill_jobs_together.sql, term for term, and for
 * the same reason the rate chains are written twice: the job log is drawn here
 * and the invoice is drawn in SQL. If the two disagree, the office signs off on
 * one grouping and bills another. Change one, change the other.
 */
function anchorJobId(job, jobs, week) {
  if (!job || !job.bill_with_customer || !job.qb_customer_id) return job ? job.id : null;
  // Merging never reaches backwards. A week billed before the jobs were put
  // together keeps the grouping it was billed under, or the portal would stop
  // matching invoices the customer is already holding.
  const live = (j) => j.bill_with_customer && j.qb_customer_id
    && j.bill_with_customer_from && week >= j.bill_with_customer_from;
  if (!live(job)) return job.id;

  const family = jobs.filter(j => j.qb_customer_id === job.qb_customer_id && live(j));
  if (!family.length) return job.id;
  // order by created_at nulls last, id -- same as the database.
  family.sort((a, b) =>
    (a.created_at || '9999').localeCompare(b.created_at || '9999') || String(a.id).localeCompare(String(b.id)));
  return family[0].id;
}

function buildJobGroups(entries, jobs) {
  const groups = {}; // effectiveJobId -> { job, days: { dateStr: { lines: [] } } }

  entries.forEach(e => {
    const job = jobs.find(j => j.id === e.job_id);
    const isYardEntry = job && job.is_yard;
    const billsUnder = e.job_id ? anchorJobId(job, jobs, ymd(weekStart)) : null;
    const effectiveJobId = isYardEntry && e.for_job_id ? e.for_job_id : (billsUnder || `oneoff:${e.one_off_name}`);
    const effectiveJob = e.job_id
      ? (isYardEntry && e.for_job_id ? jobs.find(j => j.id === e.for_job_id) : (jobs.find(j => j.id === effectiveJobId) || job))
      : null;

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

    // ---- Rates ----------------------------------------------------------
    //
    // These chains are the same ones v_work_lines uses, term for term. They are
    // written out twice because the job log is drawn here and the invoice is
    // drawn in SQL, and if the two ever disagree the office signs off on one
    // number and bills another. Change a chain here, change it there:
    // supabase/migrations/20260824_per_line_rate_overrides.sql and
    // supabase/migrations/20260827_internal_jobs.sql.
    //
    // A rate typed on the line wins. Blank falls back the way it always did.
    const prof = e.profiles || {};
    const isFlatJob = effectiveJob && effectiveJob.billing_type === 'flat';

    // A login that bills as a helper. He files his own tickets, so he arrives on
    // the welder leg of the ticket and would be called a welder by every line
    // below it -- which is what put 136.5 of Jayson Alvarez's hours on the
    // "Welder labor" line of an invoice at a helper's rate.
    //
    // He is a helper from here down: his own name off the helpers row, his own
    // rates, and none of the job's welding rates, which is the same rule that
    // keeps any other helper off them. Matches v_work_lines --
    // supabase/migrations/20260828_bills_as_helper.sql. Change one, change the
    // other.
    const asHelper = prof.bills_as_helper || null;

    // Overhead. Shop time is paid and never billed, and that has to hold for a
    // helper as well as a welder -- a helper ignores the job rate on purpose, so
    // zeroing the job rate alone would have looked right and corrected almost
    // nothing, most of what lands on Shop being helpers. Per diem goes with it:
    // there is no per diem on a day spent in the yard.
    const internal = !!(effectiveJob && effectiveJob.is_internal);
    const jobPerDiem = internal ? 0 : (effectiveJob ? effectiveJob.per_diem : null);
    const jobBillRate = internal ? 0 : (effectiveJob ? effectiveJob.bill_rate : null);
    const jobStainlessRate = internal ? 0 : (effectiveJob ? effectiveJob.stainless_bill_rate : null);
    // The one job rate that reaches a helper and never a welder. MasTec pay $35
    // for a helper; before this it had to be typed on every line, and the day it
    // was missed the invoice went out at his standing rate.
    const jobHelperRate = internal ? 0 : (effectiveJob ? effectiveJob.helper_bill_rate : null);

    // A helper-only ticket has no welder line at all. v_work_lines does the same
    // thing by inner-joining profiles, so the job log and the invoice agree on
    // what a ticket with no welder contains: just its helpers.
    if (e.welder_id) d.lines.push(personLine({
      role: asHelper ? 'helper' : 'welder',
      name: (asHelper ? asHelper.name : prof.full_name) || '—',
      hours: Number(e.hours),
      payHours: e.pay_hours_override,
      payRate: rateOr(e.pay_rate_override, asHelper && asHelper.pay_rate, prof.pay_rate),
      // internal first, so an override typed on a shop ticket cannot bill it.
      // The SQL has always read that way round; this read the override first and
      // would have billed overhead the day somebody set one.
      billRate: internal ? 0 : (asHelper
        ? rateOr(e.bill_rate_override, jobHelperRate, asHelper.bill_rate, prof.bill_rate)
        : rateOr(e.bill_rate_override, jobBillRate, prof.bill_rate)),
      // A bill rate typed on a stainless line still counts, so entering one
      // does something rather than being quietly ignored for the job rate.
      // For a man billing as a helper that is the only thing that can move him:
      // the job's stainless rate is a welding rate and never reaches him.
      stainlessRate: internal ? 0 : (asHelper
        ? rateOr(e.bill_rate_override, jobHelperRate, asHelper.bill_rate, prof.bill_rate)
        : rateOr(e.stainless_rate_override, e.bill_rate_override, jobStainlessRate, prof.bill_rate)),
      perDiemRate: rateOr(e.per_diem_override, jobPerDiem),
      perDiem: e.per_diem,
      isStainless: e.is_stainless,
      entryId: e.id,
      description: e.description,
      realJobId: e.job_id,
      realOneOffName: e.one_off_name,
      parts: isFlatJob ? (e.daily_entry_parts || []) : undefined,
      welderId: e.welder_id,
      entryDate: e.entry_date,
      forJobId: e.for_job_id,
      overrides: {
        pay: e.pay_rate_override, bill: e.bill_rate_override,
        stainless: e.stainless_rate_override, perDiem: e.per_diem_override
      },
      fallbacks: {
        pay: rateOr(asHelper && asHelper.pay_rate, prof.pay_rate),
        bill: internal ? 0 : (asHelper
          ? rateOr(jobHelperRate, asHelper.bill_rate, prof.bill_rate)
          : rateOr(jobBillRate, prof.bill_rate)),
        stainless: internal ? 0 : (asHelper
          ? rateOr(jobHelperRate, asHelper.bill_rate, prof.bill_rate)
          : rateOr(jobStainlessRate, prof.bill_rate)),
        perDiem: rateOr(jobPerDiem)
      }
    }));
    if (e.description) d.descs.push(e.description);

    (e.daily_entry_helpers || []).forEach(dh => {
      const hp = dh.helpers || {};
      // A helper bills at his own rate. The job bill rate and the stainless rate
      // are what the welding goes out at and neither one reaches him, so the only
      // thing that can move a helper line is an override typed on that line.
      d.lines.push(personLine({
        role: 'helper',
        name: hp.name || '—',
        hours: Number(dh.hours),
        payHours: dh.pay_hours_override,
        payRate: rateOr(dh.pay_rate_override, hp.pay_rate),
        // internal first: a helper otherwise falls straight through to his own
        // rate, which is exactly the case a zero job rate cannot reach.
        billRate: internal ? 0 : rateOr(dh.bill_rate_override, jobHelperRate, hp.bill_rate),
        perDiemRate: internal ? 0 : rateOr(dh.per_diem_override, jobPerDiem),
        perDiem: dh.per_diem,
        entryId: e.id,
        helperRowId: dh.id,
        helperId: dh.helper_id,
        entryHasWelder: !!e.welder_id,
        entryDate: e.entry_date,
        realJobId: e.job_id,
        realOneOffName: e.one_off_name,
        forJobId: e.for_job_id,
        description: e.description,
        overrides: {
          pay: dh.pay_rate_override, bill: dh.bill_rate_override, perDiem: dh.per_diem_override
        },
        fallbacks: {
          pay: rateOr(hp.pay_rate),
          bill: internal ? 0 : rateOr(jobHelperRate, hp.bill_rate),
          perDiem: internal ? 0 : rateOr(jobPerDiem)
        }
      }));
    });
  });

  return Object.values(groups).map(g => {
    let hours = 0, welderHours = 0, helperHours = 0, revenue = 0, cost = 0;
    Object.values(g.days).forEach(d => d.lines.forEach(l => {
      hours += l.hours; revenue += l.revenue; cost += l.cost;
      if (l.role === 'helper') helperHours += l.hours; else welderHours += l.hours;
    }));
    return { ...g, hours, welderHours, helperHours, revenue, cost, margin: revenue - cost, marginPct: revenue ? Math.round((revenue - cost) / revenue * 100) : 0 };
  }).sort((a, b) => b.revenue - a.revenue);
}

async function loadWeek(skipReconcile) {
  const start = ymd(weekStart);
  const end = ymd(addDays(weekStart, 6));

  document.getElementById('weekLabel').textContent = formatWeekLabel(weekStart);

  // The welder embed names its foreign key on purpose. Do not shorten it back to
  // plain "profiles(...)".
  //
  // supervisor_id was added for helper-only tickets and first pointed at profiles,
  // which gave daily_entries two relationships to that table and broke this whole
  // query. Repointing it at auth.users looked like the fix and was not: profiles.id
  // IS auth.users.id, so PostgREST can still walk
  // daily_entries.supervisor_id -> auth.users <- profiles.id and find a second
  // path. It simply took until its schema cache refreshed to notice, which is why
  // the page worked for an hour and then failed again with nothing having changed.
  //
  // Naming the constraint ends the argument. It costs one identifier and it does
  // not care how many other columns ever point at a person.
  const [entriesRes, jobsRes, jwRes, hlprsRes, weldersRes] = await Promise.all([
    sb.from('daily_entries')
      .select('*, profiles!daily_entries_welder_id_fkey(full_name, pay_rate, bill_rate, bills_as_helper_id, bills_as_helper:helpers!profiles_bills_as_helper_id_fkey(name, pay_rate, bill_rate)), daily_entry_helpers(*, helpers(name, pay_rate, bill_rate)), daily_entry_parts(*)')
      .gte('entry_date', start).lte('entry_date', end),
    sb.from('jobs').select('*'),
    sb.from('job_weeks').select('*').eq('week_start', start),
    sb.from('helpers').select('*').order('name'),
    sb.from('profiles').select('*').order('full_name')
  ]);

  // A query that fails and a week nobody worked used to look identical. The error
  // was destructured away, the missing rows became an empty list, and the page
  // announced "No work logged this week yet." over a full database.
  //
  // That is how both of this system's disappearing-week incidents presented: not
  // as an error, but as a calm and confident zero. The cause was sitting in an
  // error object the whole time with nobody reading it. So read it, and never let
  // a failure wear the same face as an empty week again.
  const failed = [
    ['the tickets', entriesRes], ['the jobs', jobsRes], ['the approvals', jwRes],
    ['the helpers', hlprsRes], ['the welders', weldersRes]
  ].filter(([, r]) => r.error);

  if (failed.length) {
    document.getElementById('jobDetail').style.display = 'none';
    document.getElementById('jobGrid').style.display = 'grid';
    document.getElementById('weekSummary').innerHTML = '';
    document.getElementById('jobGrid').innerHTML = `
      <div class="card load-error">
        <h3>This week could not be loaded</h3>
        <p>Your work is still there. The page could not read it, which is a
           different thing from there being none &mdash; nothing has been lost.</p>
        <ul>${failed.map(([what, r]) => `<li>Reading ${esc(what)} failed: ${esc(r.error.message)}${
          r.error.hint ? `<br><span class="le-hint">${esc(r.error.hint)}</span>` : ''}</li>`).join('')}</ul>
        <button type="button" class="btn2 btn2-solid small" id="retryWeekBtn">Try again</button>
      </div>`;
    document.getElementById('retryWeekBtn').addEventListener('click', () => loadWeek());
    return;
  }

  const entries = entriesRes.data || [];
  const jobs = jobsRes.data || [];

  // Only used to word the unlock warning honestly, so a failure here is not worth
  // stopping the week over.
  const { data: filedRow } = await sb.from('onedrive_file_log')
    .select('filed_count').eq('week_start', start).maybeSingle();
  weekAlreadyFiled = !!(filedRow && filedRow.filed_count > 0);

  jobsById = {};
  jobs.forEach(j => jobsById[j.id] = j);
  helpersList = hlprsRes.data || [];
  weldersList = weldersRes.data || [];

  currentJobWeeks = {};
  (jwRes.data || []).forEach(row => currentJobWeeks[row.job_id] = row);

  currentGroups = buildJobGroups(entries, jobs);
  renderGrid();
  if (openJobId) renderDetail(openJobId);

  // After the week is on screen, not before it. The page is useful whether or
  // not QuickBooks answers.
  if (!skipReconcile) pickUpDeletedInvoices();
}

/* ---------------------------------------------------------------------------
   KEEPING UP WITH QUICKBOOKS
   ---------------------------------------------------------------------------
   Two things drift after a week is pushed.

   The invoice gets deleted over there, and the portal goes on holding its id
   and refusing to unlock the week. Deleting it in QuickBooks is the office
   saying "start that one again", so the page asks on every load rather than
   waiting to be told. One query covers every synced week on the page.

   And the sheet attached to it can be out of date -- seven invoices went out
   with crew sheets carrying notes that have since come off. Swapping the
   attachment leaves the invoice alone: same number, same lines, same total.
   That one is a button, because it rewrites a document on their books and
   should be something somebody decided to do.
*/

async function reconcileWithQuickBooks({ refreshSheets = false } = {}) {
  const ids = Object.values(currentJobWeeks)
    .filter(r => r.status === 'synced' && r.qb_invoice_id)
    .map(r => r.id);
  if (!ids.length) return null;

  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;

  const res = await fetch(PUSH_FN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ action: 'reconcile', job_week_ids: ids, refresh_sheets: refreshSheets }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) throw new Error(json.error || `QuickBooks check failed (${res.status})`);
  return json;
}

/* Runs itself on every week load. A week whose invoice has been deleted comes
   back to approved without anybody asking for it.

   It never throws into the page: QuickBooks being unreachable is not a reason
   to break a week that reads perfectly well from our own database. */
async function pickUpDeletedInvoices() {
  try {
    const out = await reconcileWithQuickBooks();
    if (out && out.unsynced > 0) {
      const which = out.results.filter(r => r.action === 'unsynced')
        .map(r => r.invoice_no || r.qb_invoice_id).join(', ');
      await loadWeek(true);
      const el = document.getElementById('qbNote');
      if (el) {
        el.textContent = out.unsynced === 1
          ? `Invoice ${which} is gone from QuickBooks, so that week is open again.`
          : `Invoices ${which} are gone from QuickBooks, so those weeks are open again.`;
        el.className = 'qb-note qb-note-ok';
      }
    }
  } catch { /* the week is drawn from our own database and stands on its own */ }
}

/* Swaps the attached sheet on every synced invoice on this week. Says what it
   did per invoice rather than "done", because a partial result is the one worth
   knowing about: an invoice whose old sheet came off and whose new one did not
   go on is the case somebody has to look at. */
async function refreshCrewSheets() {
  const btn = document.getElementById('refreshSheetsBtn');
  const el = document.getElementById('qbNote');
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Replacing\u2026'; }
  try {
    const out = await reconcileWithQuickBooks({ refreshSheets: true });
    if (!out) return;
    const bits = [];
    if (out.replaced) bits.push(`${out.replaced} crew sheet${out.replaced === 1 ? '' : 's'} replaced`);
    if (out.unsynced) bits.push(`${out.unsynced} invoice${out.unsynced === 1 ? ' was' : 's were'} gone from QuickBooks and ${out.unsynced === 1 ? 'that week is' : 'those weeks are'} open again`);
    if (out.failed) {
      const why = out.results.filter(r => r.action === 'sheet_failed')
        .map(r => `${r.invoice_no}: ${(r.detail && r.detail.error) || 'unknown'}`).join('; ');
      bits.push(`${out.failed} could not be replaced \u2014 ${why}`);
    }
    if (el) {
      el.textContent = bits.length ? bits.join('. ') + '.' : 'Nothing needed replacing.';
      el.className = 'qb-note ' + (out.failed ? 'qb-note-err' : 'qb-note-ok');
    }
    if (out.unsynced) await loadWeek(true);
  } catch (err) {
    if (el) { el.textContent = 'QuickBooks could not be reached: ' + err.message; el.className = 'qb-note qb-note-err'; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = label || 'Replace their crew sheets'; }
  }
}

function statusFor(groupId) {
  const row = currentJobWeeks[groupId];
  return row ? row.status : 'open';
}

function renderGrid() {
  const totals = currentGroups.reduce((a, g) => { a.hours += g.hours; a.revenue += g.revenue; a.cost += g.cost; return a; }, { hours: 0, revenue: 0, cost: 0 });
  // Synced weeks on this page, and therefore sheets that could be out of date.
  const syncedCount = Object.values(currentJobWeeks)
    .filter(r => r.status === 'synced' && r.qb_invoice_id).length;
  const noteEl = document.getElementById('qbNote');
  if (noteEl) {
    noteEl.innerHTML = syncedCount
      ? `<span class="qb-note-txt">${syncedCount} invoice${syncedCount === 1 ? '' : 's'} from this week
           ${syncedCount === 1 ? 'is' : 'are'} on QuickBooks.</span>
         <button type="button" class="btn2 btn2-ghost small" id="refreshSheetsBtn"
           title="Takes the crew sheet off each of those invoices in QuickBooks and puts the current one on. The invoice itself is not touched.">Replace their crew sheets</button>`
      : '';
    noteEl.className = 'qb-note';
    const rb = document.getElementById('refreshSheetsBtn');
    if (rb) rb.addEventListener('click', refreshCrewSheets);
  }

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
  const nextInvoiceNo = nextInvoiceNumber;
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
          <div class="lines2-scroll">
            <table class="lines2">
              <thead><tr><th class="l-name">Person</th><th>Hrs</th><th>Rate</th><th>PD</th><th>Bill</th><th>Margin</th><th></th></tr></thead>
              <tbody>
                ${d.lines.map((l, li) => `
                  <tr data-entry-id="${esc(l.entryId)}" data-helper-row-id="${l.helperRowId ? esc(l.helperRowId) : ''}" data-line-key="${dateStr}-${li}">
                    <td class="l-name">${esc(l.name)}<span class="role-tag2">${l.role}</span>${l.role === 'welder' && l.description ? `<div class="line-desc">${esc(l.description)}</div>` : ''}${l.isStainless ? `<div class="line-desc stainless-tag">Stainless</div>` : ''}${rateTag(l)}${l.parts ? `<div class="line-desc flat-tag">Flat rate</div>${l.parts.map(p => `<div class="line-desc part-line-desc">${esc(p.description)} — ${p.quantity} &times; $${p.rate} = ${money(Number(p.quantity) * Number(p.rate))}</div>`).join('')}` : ''}</td>
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
          </div>
        </div>`;
      }).join('')}
    </div>

    <div class="totals2">
      <div class="tot-item2"><span class="tot-lbl2">Welder hrs</span><span class="tot-num2">${g.welderHours}</span></div>
      <div class="tot-item2"><span class="tot-lbl2">Helper hrs</span><span class="tot-num2">${g.helperHours}</span></div>
      <div class="tot-item2"><span class="tot-lbl2">Invoice (revenue)</span><span class="tot-num2">${money(g.revenue)}</span></div>
      <div class="tot-item2"><span class="tot-lbl2">Labor cost</span><span class="tot-num2 tot-cost2">${money(g.cost)}</span></div>
      <div class="tot-item2 tot-margin2"><span class="tot-lbl2">Job margin</span><span class="tot-num2">${money(g.margin)} (${g.marginPct}%)</span></div>
    </div>

    <div class="actions2">
      <div class="inv2">
        <label class="inv-lbl2">Invoice #</label>
        <input class="inv-input2" id="invoiceInput" value="${esc(invoiceNo)}" ${status === 'synced' ? 'disabled' : ''}>
        ${status === 'synced' ? '' : (invoiceNo
          ? ''
          : `<button class="btn2 btn2-ghost small" id="assignInvBtn">Use ${esc(nextInvoiceNo || 'next')}</button>`)}
      </div>
      <div class="act-btns2" id="actBtns"></div>
    </div>
    <div class="inv-note2">
      ${invoiceNo
        ? (jw && jw.qb_invoice_id
            ? `On QuickBooks invoice ${esc(jw.qb_invoice_id)}.`
            : 'Approving a week numbers it by itself. Type over it if this one needs a different number.')
        : `Approve this week and it takes ${esc(nextInvoiceNo || 'the next number')} on its own.`}
    </div>

    <!-- A customer getting a weekly invoice cannot tell whether another is
         coming. Marking the last one says so on the bill, so their accounts can
         close the job instead of holding it open. -->
    <label class="final-inv${jw && jw.is_final ? ' on' : ''}">
      <input type="checkbox" id="finalInvChk" ${jw && jw.is_final ? 'checked' : ''}
             ${status === 'synced' ? 'disabled' : ''}>
      <span class="final-inv-txt">
        <b>Final invoice for this job</b>
        <small>${status === 'synced'
          ? 'This week is already on QuickBooks, so what it says cannot be changed here.'
          : 'Prints FINAL INVOICE on the bill so they know nothing more is coming for it.'}</small>
      </span>
    </label>
  `;

  document.getElementById('backBtn').addEventListener('click', () => {
    openJobId = null;
    detailEl.style.display = 'none';
    document.getElementById('jobGrid').style.display = 'grid';
  });

  const actBtns = document.getElementById('actBtns');
  if (!locked) {
    actBtns.innerHTML = `
      <button class="btn2 btn2-line" id="previewInvBtn">Preview invoice</button>
      <button class="btn2 btn2-ghost" id="kickBtn">Kick back</button>
      <button class="btn2 btn2-solid" id="approveBtn">Approve week &amp; lock</button>
    `;
    document.getElementById('kickBtn').addEventListener('click', () => setJobWeekStatus(g.id, 'open'));
    document.getElementById('approveBtn').addEventListener('click', () => setJobWeekStatus(g.id, 'approved'));
  } else if (status === 'approved') {
    // Approved is not final. Nothing has gone to QuickBooks yet, so a mistake
    // found now is still just a mistake - it becomes expensive only once the
    // invoice is over there. Hence an unlock here and none on a synced week.
    actBtns.innerHTML = `
      <span class="locked-note2">Locked · ready for QuickBooks</span>
      <button class="btn2 btn2-ghost" id="unlockBtn">Unlock to edit</button>
      <button class="btn2 btn2-solid" id="previewInvBtn">Preview invoice &amp; send</button>
    `;
    document.getElementById('unlockBtn').addEventListener('click', () => unlockJobWeek(g.id));
  } else {
    actBtns.innerHTML = `
      <span class="locked-note2">Synced to QuickBooks</span>
      <button class="btn2 btn2-line" id="previewInvBtn">See the invoice</button>
      <span class="qbo-note">Reverse it in QuickBooks before changing anything here.</span>
    `;
  }

  const previewBtn = document.getElementById('previewInvBtn');
  if (previewBtn) previewBtn.addEventListener('click', () => {
    const week = currentJobWeeks[g.id];
    InvoicePreview.open({
      jobWeekId: week ? week.id : null,
      name: g.name,
      qbInvoiceId: week ? week.qb_invoice_id : null,
      onPushed: loadWeek,
    });
  });

  const assignBtn = document.getElementById('assignInvBtn');
  if (assignBtn) assignBtn.addEventListener('click', () => assignInvoiceNo(g.id));

  const finalChk = document.getElementById('finalInvChk');
  if (finalChk) finalChk.addEventListener('change', async (e) => {
    const want = e.target.checked;
    e.target.disabled = true;
    const { error } = await upsertJobWeek(g.id, { is_final: want });
    e.target.disabled = false;
    if (error) {
      e.target.checked = !want;                       // never look saved when it is not
      alert('Could not mark it: ' + error.message);
      return;
    }
    renderDetail(g.id);
  });

  document.getElementById('invoiceInput').addEventListener('blur', async (e) => {
    // A synced week is the only one whose number is settled -- it is on a real
    // invoice over there. An approved one is still ours to renumber.
    if (status === 'synced') return;
    const typed = e.target.value.trim() || null;
    if (typed === (invoiceNo || null)) return;
    const { error } = await upsertJobWeek(g.id, { invoice_no: typed });
    if (error) { alert('That invoice number did not save: ' + error.message); return; }
    await refreshNextInvoiceNumber();
    renderDetail(g.id);
  });

  document.querySelectorAll('.lines2 tbody tr').forEach(row => {
    const [dateStr, liStr] = row.dataset.lineKey.split(/-(\d+)$/);
    const line = g.days[dateStr].lines[Number(liStr)];

    row.querySelector('[data-action="edit-line"]').addEventListener('click', () => startEditLine(row, line, groupId));
    row.querySelector('[data-action="delete-line"]').addEventListener('click', () => deleteLine(line, groupId));
  });
}

// Approving a week freezes it into week_summaries, and a rate changed afterwards
// reaches that frozen copy only when the week is rebuilt. Doing it here rather
// than leaving the office to remember is the difference between an override
// working and a snapshot that quietly disagrees with its own tickets.
//
// Nothing to do on a week nobody has approved yet: those are read live.
async function rebuildIfFrozen() {
  const frozen = Object.values(currentJobWeeks)
    .some(r => r.status === 'approved' || r.status === 'synced');
  if (!frozen) return;
  const { error } = await sb.rpc('rebuild_week_summaries', { p_week: ymd(weekStart) });
  if (error) {
    alert('The ticket was saved, but this week could not be rebuilt: ' + error.message
        + '\n\nThe ticket itself is right. The approved summary for this week is now behind it '
        + 'until the week is rebuilt.');
  }
}

// ---------- Rate overrides on the edit form ----------
//
// A rate box holds whatever was typed on this line, and shows the rate that
// applies anyway as its placeholder. Clearing a box therefore says what it is
// falling back to instead of leaving the office guessing, which matters because
// clearing one is how a line is put back on the standing rates.
function rateFieldHtml(cls, label, override, fallback) {
  const typed = override === null || override === undefined ? '' : String(override);
  return `
          <div class="edit-field edit-field-sm edit-field-rate">
            <label>${label}</label>
            <input type="number" step="0.01" min="0" class="input ${cls}" value="${escAttr(typed)}" placeholder="${escAttr(fallback)}">
          </div>`;
}

const WELDER_RATE_FIELDS = [
  ['pay_rate_override', '.edit-pay-rate-input', 'Pay rate'],
  ['bill_rate_override', '.edit-bill-rate-input', 'Bill rate'],
  ['stainless_rate_override', '.edit-stainless-rate-input', 'Stainless rate'],
  ['per_diem_override', '.edit-per-diem-rate-input', 'Per diem']
];
const HELPER_RATE_FIELDS = [
  ['pay_rate_override', '.edit-pay-rate-input', 'Pay rate'],
  ['bill_rate_override', '.edit-bill-rate-input', 'Bill rate'],
  ['per_diem_override', '.edit-per-diem-rate-input', 'Per diem']
];

// An empty box has to reach the database as null, not as 0: null is "use the
// rates as they stand" and 0 is "this line is worth nothing", and a ticket
// silently zeroed because a box was left blank would be the worst outcome here.
function andList(items) {
  if (items.length < 2) return items[0] || '';
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
}

function readRateOverrides(row, fields) {
  const patch = {};
  const bad = [];
  fields.forEach(([column, cls, label]) => {
    const raw = row.querySelector(cls).value.trim();
    if (raw === '') { patch[column] = null; return; }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) { bad.push(label); return; }
    patch[column] = n;
  });
  return { patch, bad };
}

function startEditLine(row, line, groupId) {
  const isHelper = !!line.helperRowId;

  if (isHelper) {
    // On a normal ticket the welder's row is where the date, job and description
    // are edited. A helper-only ticket has no welder row, so those fields have to
    // appear here or a mistyped date on one could only be fixed by deleting it.
    const ownsTicket = !line.entryHasWelder;
    const ticketJobs = Object.values(jobsById).sort((a, b) => a.name.localeCompare(b.name));
    const ticketIsOther = !line.realJobId;
    const ticketIsYard = (jobId) => { const j = jobsById[jobId]; return !!(j && j.is_yard); };

    row.innerHTML = `
      <td colspan="7">
        <div class="edit-row-form">
          ${ownsTicket ? `
            <div class="edit-field edit-field-sm">
              <label>Date</label>
              <input type="date" class="input edit-date-input" value="${esc(line.entryDate)}">
            </div>
            <div class="edit-field">
              <label>Job</label>
              <select class="input edit-job-select">
                ${ticketJobs.map(j => `<option value="${esc(j.id)}" ${j.id === line.realJobId ? 'selected' : ''}>${esc(j.name)}${j.is_yard ? ' (yard)' : ''}</option>`).join('')}
                <option value="other" ${ticketIsOther ? 'selected' : ''}>Other / one-off…</option>
              </select>
            </div>
            <div class="edit-field edit-oneoff-wrap" style="display:${ticketIsOther ? 'block' : 'none'};">
              <label>One-off job name</label>
              <input type="text" class="input edit-oneoff-input" value="${esc(line.realOneOffName)}">
            </div>
            <div class="edit-field edit-forjob-wrap" style="display:${ticketIsYard(line.realJobId) ? 'block' : 'none'};">
              <label>Which job is this yard work for?</label>
              <select class="input edit-forjob-select">
                <option value="">Pick the job it's for…</option>
                ${ticketJobs.filter(j => !j.is_yard).map(j => `<option value="${esc(j.id)}" ${j.id === line.forJobId ? 'selected' : ''}>${esc(j.name)}</option>`).join('')}
              </select>
            </div>
            <div class="edit-field">
              <label>Description</label>
              <textarea class="input edit-desc-input">${esc(line.description)}</textarea>
            </div>` : ''}
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
          ${rateFieldHtml('edit-pay-rate-input', 'Pay rate', line.overrides.pay, line.fallbacks.pay)}
          ${rateFieldHtml('edit-bill-rate-input', 'Bill rate', line.overrides.bill, line.fallbacks.bill)}
          ${rateFieldHtml('edit-per-diem-rate-input', 'Per diem', line.overrides.perDiem, line.fallbacks.perDiem)}
          <div class="edit-rate-note">Leave a rate blank to keep his standing rate. Anything typed here changes this line only.</div>
          <div class="edit-field-actions">
            <button type="button" class="row-edit" data-action="save-line">Save</button>
            <button type="button" class="row-del" data-action="cancel-line">Cancel</button>
          </div>
        </div>
      </td>`;

    if (ownsTicket) {
      const jobSel = row.querySelector('.edit-job-select');
      jobSel.addEventListener('change', () => {
        row.querySelector('.edit-oneoff-wrap').style.display = jobSel.value === 'other' ? 'block' : 'none';
        row.querySelector('.edit-forjob-wrap').style.display = ticketIsYard(jobSel.value) ? 'block' : 'none';
      });
    }

    row.querySelector('[data-action="cancel-line"]').addEventListener('click', () => renderDetail(groupId));
    row.querySelector('[data-action="save-line"]').addEventListener('click', async () => {
      const { patch: rates, bad } = readRateOverrides(row, HELPER_RATE_FIELDS);
      if (bad.length) { alert(andList(bad) + ' must be a number, or left blank.'); return; }

      if (ownsTicket) {
        const jobVal = row.querySelector('.edit-job-select').value;
        const other = jobVal === 'other';
        const oneOff = other ? row.querySelector('.edit-oneoff-input').value.trim() : '';
        if (other && !oneOff) { alert('Name the one-off job.'); return; }
        const ticketPatch = {
          entry_date: row.querySelector('.edit-date-input').value,
          job_id: other ? null : jobVal,
          one_off_name: other ? oneOff : null,
          for_job_id: ticketIsYard(jobVal) ? (row.querySelector('.edit-forjob-select').value || null) : null,
          description: row.querySelector('.edit-desc-input').value.trim()
        };
        const { error: ticketErr } = await sb.from('daily_entries').update(ticketPatch).eq('id', line.entryId);
        if (ticketErr) { alert('Could not save: ' + ticketErr.message); return; }
      }

      const patch = {
        helper_id: row.querySelector('.edit-helper-select').value,
        hours: Number(row.querySelector('.edit-hours-input').value),
        per_diem: row.querySelector('.edit-pd-input').checked,
        ...rates
      };
      const { error } = await sb.from('daily_entry_helpers').update(patch).eq('id', line.helperRowId);
      if (error) { alert('Could not save: ' + error.message); return; }
      await loadWeek();
      await rebuildIfFrozen();
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
        <div class="edit-field edit-field-sm edit-field-pd">
          <label><input type="checkbox" class="edit-stainless-input" ${line.isStainless ? 'checked' : ''}> Stainless</label>
        </div>
        ${rateFieldHtml('edit-pay-rate-input', 'Pay rate', line.overrides.pay, line.fallbacks.pay)}
        ${rateFieldHtml('edit-bill-rate-input', 'Bill rate', line.overrides.bill, line.fallbacks.bill)}
        ${rateFieldHtml('edit-stainless-rate-input', 'Stainless rate', line.overrides.stainless, line.fallbacks.stainless)}
        ${rateFieldHtml('edit-per-diem-rate-input', 'Per diem', line.overrides.perDiem, line.fallbacks.perDiem)}
        <div class="edit-rate-note">Leave a rate blank to keep the job rate, then his standing rate. Anything typed here changes this ticket only. The stainless rate is used in place of the bill rate while Stainless is ticked.</div>
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
    const { patch: rates, bad } = readRateOverrides(row, WELDER_RATE_FIELDS);
    if (bad.length) { alert(andList(bad) + ' must be a number, or left blank.'); return; }
    const patch = {
      welder_id: row.querySelector('.edit-welder-select').value,
      entry_date: row.querySelector('.edit-date-input').value,
      job_id: other ? null : jobVal,
      one_off_name: other ? row.querySelector('.edit-oneoff-input').value.trim() : null,
      for_job_id: yardNow ? (row.querySelector('.edit-forjob-select').value || null) : null,
      description: row.querySelector('.edit-desc-input').value.trim(),
      hours: Number(row.querySelector('.edit-hours-input').value),
      per_diem: row.querySelector('.edit-pd-input').checked,
      is_stainless: row.querySelector('.edit-stainless-input').checked,
      ...rates
    };
    const { error: entryErr } = await sb.from('daily_entries').update(patch).eq('id', line.entryId);
    if (entryErr) { alert('Could not save: ' + entryErr.message); return; }

    if (flatNow) {
      // Clearing then re-inserting only works if the clear actually removed the
      // rows. A refused delete returns no error and no rows, so inserting after
      // it puts every parts line on the ticket twice - check before inserting.
      const { error: clearErr } = await sb.from('daily_entry_parts')
        .delete().eq('daily_entry_id', line.entryId).select('id');
      if (clearErr) { alert('Could not save: ' + clearErr.message); return; }
      const { count: leftOver } = await sb.from('daily_entry_parts')
        .select('id', { count: 'exact', head: true }).eq('daily_entry_id', line.entryId);
      if (leftOver) {
        alert('The hours were saved, but the old parts lines could not be cleared.\n\n'
            + 'Nothing was doubled up - we stopped before that could happen. '
            + 'The parts on this ticket need fixing by hand.');
        await loadWeek();
        return;
      }
      const validParts = editParts
        .filter(p => p.description.trim() && Number(p.quantity) > 0 && Number(p.rate) > 0)
        .map(p => ({ daily_entry_id: line.entryId, description: p.description.trim(), quantity: Number(p.quantity), rate: Number(p.rate) }));
      if (validParts.length) {
        const { error: partsErr } = await sb.from('daily_entry_parts').insert(validParts);
        if (partsErr) { alert('Entry saved, but parts could not be saved: ' + partsErr.message); return; }
      }
    } else if (line.parts) {
      const { error: dropErr } = await sb.from('daily_entry_parts')
        .delete().eq('daily_entry_id', line.entryId).select('id');
      if (dropErr) alert('The hours were saved, but the parts lines could not be removed: ' + dropErr.message);
    }
    await loadWeek();
    await rebuildIfFrozen();
  });
}

async function deleteLine(line, groupId) {
  const label = line.helperRowId ? `${line.name}'s helper hours` : `${line.name}'s whole entry for this day (including any helpers on it)`;
  if (!confirm(`Delete ${label}? This can't be undone.`)) return;

  // A delete the database refuses comes back with no error and no rows, so
  // without asking what was removed the row simply reappears on reload with no
  // explanation. Ask, and say so plainly when nothing was deleted.
  const { data: gone, error } = line.helperRowId
    ? await sb.from('daily_entry_helpers').delete().eq('id', line.helperRowId).select('id')
    : await sb.from('daily_entries').delete().eq('id', line.entryId).select('id');

  if (error) { alert('Could not delete: ' + error.message); return; }
  if (!gone || gone.length === 0) {
    alert('That could not be deleted.\n\n'
        + 'Nothing was removed. This is a permissions problem rather than something you did wrong.');
    return;
  }

  // Taking the last helper off a helper-only ticket leaves a row with no welder
  // and nobody on it: invisible on the job log, still sitting in the week. Clear
  // it out with the line that was the whole reason it existed.
  if (line.helperRowId && !line.entryHasWelder) {
    const { count } = await sb.from('daily_entry_helpers')
      .select('id', { count: 'exact', head: true }).eq('daily_entry_id', line.entryId);
    if (!count) await sb.from('daily_entries').delete().eq('id', line.entryId);
  }

  await loadWeek();
  await rebuildIfFrozen();
}

// Returns { error } so callers can tell a refusal from a success. It used to
// return nothing and drop whatever came back, which meant an approval the database
// declined - a synced week, a permissions problem - looked exactly like one that
// worked, right up until the page reloaded and the status was unchanged.
/* ---------------------------------------------------------------------------
   INVOICE NUMBERS
   ---------------------------------------------------------------------------
   The office typed 2974 on one week and asked for the rest to follow. They do:
   approving a week has the database hand it the next number, out of a counter
   that only ever moves forward, so two people approving at the same moment
   cannot land on the same number.

   These two only ever read or ask. The number itself is chosen in one place --
   the database -- because that is the only place that can promise it is not
   handing the same one out twice. */
async function refreshNextInvoiceNumber() {
  // Asks QuickBooks first, our own counter second. An invoice entered straight
  // into QuickBooks never moves our counter, so on its own our counter will
  // happily offer a number a customer already has. syncNextInvoiceNo (in
  // supabase-client.js) handles the falling back and never throws.
  const fresh = await syncNextInvoiceNo();
  if (fresh) nextInvoiceNumber = fresh;
}

/** Fills in an approved week that somehow has no number -- the ones approved
 *  before any of this existed. Never renumbers a week that has one. */
async function assignInvoiceNo(groupId) {
  const jw = currentJobWeeks[groupId];
  if (!jw) { alert('Approve this week first, and it will take a number by itself.'); return; }
  // Past anything QuickBooks has issued BEFORE the number is taken, not after.
  // assign_invoice_no reads the counter; once it has read it the number is
  // spent, collision or not.
  await refreshNextInvoiceNumber();
  const { data, error } = await sb.rpc('assign_invoice_no', { p_job_week_id: jw.id });
  if (error) { alert('Could not take the next invoice number: ' + error.message); return; }
  jw.invoice_no = data;
  await refreshNextInvoiceNumber();
  renderGrid();
  renderDetail(groupId);
}

/* The invoice preview and the QuickBooks push live in invoice-preview.js, which
   the parts-invoice page loads too. One copy on purpose: the day these two
   drifted, one screen would be showing a customer a different invoice from the
   one being sent. */

async function upsertJobWeek(groupId, patch) {
  const job = jobsById[groupId];
  if (!job) return { error: null }; // one-off jobs have no real job id to track yet
  const start = ymd(weekStart);
  const existing = currentJobWeeks[groupId];

  if (existing) {
    // select() on purpose: approving a week has the database put an invoice
    // number on it, and without reading the row back the screen would still be
    // showing the blank it sent.
    const { data, error } = await sb.from('job_weeks').update(patch).eq('id', existing.id).select().single();
    if (error) return { error };
    Object.assign(existing, data || patch);
    return { error: null };
  }
  const { data, error } = await sb.from('job_weeks')
    .insert({ job_id: groupId, week_start: start, ...patch }).select().single();
  if (error) return { error };
  if (data) currentJobWeeks[groupId] = data;
  return { error: null };
}

async function setJobWeekStatus(groupId, status) {
  const patch = { status };
  if (status === 'approved') patch.approved_at = new Date().toISOString();
  // Approving is a spend: a trigger puts the next number on the week as it
  // goes. Same rule as everywhere else -- get the counter past QuickBooks
  // before the number is taken, because afterwards is too late.
  if (status === 'approved') await refreshNextInvoiceNumber();
  // Reopening clears the approval time too. Leaving it behind would have the week
  // reading "approved 2am Tuesday" while sitting open, which is the sort of thing
  // that gets believed months later when nobody remembers.
  if (status === 'open') patch.approved_at = null;
  const { error } = await upsertJobWeek(groupId, patch);
  if (error) {
    alert('That did not save: ' + error.message);
    return;
  }
  renderGrid();
  renderDetail(groupId);
}

/** Puts an approved week back to open so its tickets can be corrected.
 *
 *  Only offered while the week is approved and not synced. Once it has gone to
 *  QuickBooks the money has left this system's control, and quietly reopening the
 *  week behind it would put the two out of step with nothing on either side
 *  saying so. The database refuses that case as well, so this is not the only
 *  thing standing between a synced week and an edit.
 */
async function unlockJobWeek(groupId) {
  const g = currentGroups.find(x => x.id === groupId);
  const name = g ? g.name : 'this job';
  const filed = weekAlreadyFiled;

  if (!confirm(
    `Unlock ${name} for ${formatWeekLabel(weekStart)}?\n\n`
    + `It goes back to open so the tickets can be changed, and it has not been `
    + `synced to QuickBooks, so nothing has been sent anywhere that matters.\n\n`
    + (filed
       ? `The pay statements already in OneDrive stay exactly as they are. They are `
         + `rewritten with the corrected numbers when you approve the week again.`
       : `Approve it again when you are done.`))) return;

  const btn = document.getElementById('unlockBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Unlocking…'; }

  const { error } = await upsertJobWeek(groupId, { status: 'open', approved_at: null });
  if (error) {
    alert('Could not unlock: ' + error.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Unlock to edit'; }
    return;
  }

  // Release this week's OneDrive filing claim. The log row is what stops two
  // approvals filing the same week twice, and left in place it would also stop the
  // corrected week ever being filed again - leaving the statements in OneDrive
  // showing the numbers from before the correction, with nothing on screen to say
  // so. Not fatal if it fails: the Summary page can always file the week by hand.
  const { error: claimErr } = await sb.from('onedrive_file_log')
    .delete().eq('week_start', ymd(weekStart));
  if (claimErr) {
    alert('The week is unlocked, but its OneDrive filing record could not be cleared.\n\n'
        + 'When you approve it again the pay statements may not refile on their own. '
        + 'Use "File week to OneDrive" on the Summary page to force them.');
  }

  await loadWeek();
  renderDetail(groupId);
}

// ---------- Submit a brand-new ticket ----------
let newTicketState = null;

function emptyNewTicketState() {
  return { mode: 'welder', welderId: '', entryDate: ymd(new Date()), jobId: '', oneOffName: '', forJobId: '', description: '', hours: 8, perDiem: true, stainless: false, parts: [{ id: null, description: '', quantity: 1, rate: '' }], helpers: [{ helperId: '', hours: 8, perDiem: false }] };
}

function newTicketHelpersHtml(state) {
  return `
    <div class="edit-parts-list">
      ${state.helpers.map((h, hi) => `
        <div class="edit-part-row nt-helper-row" data-helper-idx="${hi}">
          <select class="input nt-helper-select">
            <option value="">Pick helper…</option>
            ${helpersList.map(hp => `<option value="${esc(hp.id)}" ${h.helperId === hp.id ? 'selected' : ''}>${esc(hp.name)}</option>`).join('')}
          </select>
          <input type="number" step="0.5" min="0" class="input nt-helper-hours" placeholder="Hours" value="${esc(h.hours)}">
          <label class="new-ticket-helper-pd"><input type="checkbox" class="nt-helper-pd" ${h.perDiem ? 'checked' : ''}> PD</label>
          <button type="button" class="remove-part" data-action="remove-new-helper">&times;</button>
        </div>
      `).join('')}
    </div>
    <button type="button" class="add-part" data-action="add-new-helper">+ Add helper</button>`;
}

function newTicketPartsHtml(state) {
  return `
    <div class="edit-parts-list">
      ${state.parts.map((p, pi) => `
        <div class="edit-part-row" data-part-idx="${pi}">
          <input type="text" class="input nt-part-desc" placeholder="Part" value="${esc(p.description)}">
          <input type="number" step="1" min="0" class="input nt-part-qty" placeholder="Qty" value="${esc(p.quantity)}">
          <span class="part-x">&times;</span>
          <input type="number" step="0.01" min="0" class="input nt-part-rate" placeholder="Rate $" value="${esc(p.rate)}">
          <button type="button" class="remove-part" data-action="remove-new-part">&times;</button>
        </div>
      `).join('')}
    </div>
    <button type="button" class="add-part" data-action="add-new-part">+ Add part</button>`;
}

function newTicketCardHtml(state) {
  // A ticket with no welder on it: the helpers did the day on their own. The
  // welder half of the form comes off rather than being left there to be
  // ignored, because a welder picked and then not wanted is how a helper's day
  // ends up hung off someone who was not there.
  const welderMode = state.mode !== 'helpers';
  const other = state.jobId === 'other';
  const allJobs = Object.values(jobsById).sort((a, b) => a.name.localeCompare(b.name));
  const job = jobsById[state.jobId];
  const yard = !!(job && job.is_yard);
  const flat = !!(job && job.billing_type === 'flat');
  return `
    <div class="new-ticket-card">
      <div class="new-ticket-top">
        <span class="new-ticket-title">New ticket</span>
        <button type="button" class="remove-job" data-action="cancel-new-ticket">&times; Cancel</button>
      </div>
      <div class="nt-mode">
        <button type="button" class="nt-mode-btn${welderMode ? ' on' : ''}" data-action="mode-welder">Welder${welderMode ? ' &amp; helpers' : ''}</button>
        <button type="button" class="nt-mode-btn${welderMode ? '' : ' on'}" data-action="mode-helpers">Helpers only</button>
      </div>
      <div class="new-ticket-row">
        ${welderMode ? `
          <div class="new-ticket-field">
            <label>Welder</label>
            <select class="input nt-welder-select">
              <option value="">Pick welder…</option>
              ${weldersList.map(w => `<option value="${esc(w.id)}" ${w.id === state.welderId ? 'selected' : ''}>${esc(w.full_name)}</option>`).join('')}
            </select>
          </div>` : ''}
        <div class="new-ticket-field new-ticket-field-sm">
          <label>Date</label>
          <input type="date" class="input nt-date-input" value="${esc(state.entryDate)}">
        </div>
      </div>
      <div class="new-ticket-row">
        <div class="new-ticket-field">
          <label>Job</label>
          <select class="input nt-job-select">
            <option value="">Pick job…</option>
            ${allJobs.map(j => `<option value="${esc(j.id)}" ${j.id === state.jobId ? 'selected' : ''}>${esc(j.name)}${j.is_yard ? ' (yard)' : ''}</option>`).join('')}
            <option value="other" ${other ? 'selected' : ''}>Other / one-off…</option>
          </select>
        </div>
      </div>
      ${other ? `
        <div class="new-ticket-row">
          <div class="new-ticket-field">
            <label>One-off job name</label>
            <input type="text" class="input nt-oneoff-input" value="${esc(state.oneOffName)}">
          </div>
        </div>` : ''}
      ${yard ? `
        <div class="new-ticket-row">
          <div class="new-ticket-field">
            <label>Which job is this yard work for?</label>
            <select class="input nt-forjob-select">
              <option value="">Pick the job it's for…</option>
              ${allJobs.filter(j => !j.is_yard).map(j => `<option value="${esc(j.id)}" ${j.id === state.forJobId ? 'selected' : ''}>${esc(j.name)}</option>`).join('')}
            </select>
          </div>
        </div>` : ''}
      <div class="new-ticket-row">
        <div class="new-ticket-field">
          <label>Description</label>
          <textarea class="input nt-desc-input">${esc(state.description)}</textarea>
        </div>
      </div>
      ${welderMode ? `
        <div class="new-ticket-row">
          <div class="new-ticket-field new-ticket-field-sm">
            <label>Hours</label>
            <input type="number" step="0.5" min="0" class="input nt-hours-input" value="${esc(state.hours)}">
          </div>
        </div>
        <div class="new-ticket-checks">
          <label><input type="checkbox" class="nt-pd-input" ${state.perDiem ? 'checked' : ''}> Per diem</label>
          <label><input type="checkbox" class="nt-stainless-input" ${state.stainless ? 'checked' : ''}> Stainless</label>
        </div>` : ''}
      <div class="new-ticket-row" style="margin-top:12px;">
        <div class="new-ticket-field" style="flex-basis:100%;">
          <label>${welderMode ? 'Helpers on this job' : 'Helpers on this ticket'}</label>
          <div class="nt-helpers-wrap">${newTicketHelpersHtml(state)}</div>
        </div>
      </div>
      ${welderMode && flat ? `
        <div class="new-ticket-row" style="margin-top:12px;">
          <div class="new-ticket-field" style="flex-basis:100%;">
            <label>Parts billed (qty &times; rate)</label>
            <div class="nt-parts-wrap">${newTicketPartsHtml(state)}</div>
          </div>
        </div>` : ''}
      <div class="new-ticket-footer">
        <button type="button" class="btn2 btn2-solid small" data-action="save-new-ticket">Submit ticket</button>
      </div>
    </div>`;
}

function renderNewTicketCard() {
  document.getElementById('newTicketCard').innerHTML = newTicketState ? newTicketCardHtml(newTicketState) : '';
}

function syncNewTicketPartsFromDom() {
  document.querySelectorAll('#newTicketCard [data-part-idx]').forEach((el, pi) => {
    if (!newTicketState.parts[pi]) return;
    newTicketState.parts[pi].description = el.querySelector('.nt-part-desc').value;
    newTicketState.parts[pi].quantity = el.querySelector('.nt-part-qty').value;
    newTicketState.parts[pi].rate = el.querySelector('.nt-part-rate').value;
  });
}

function syncNewTicketHelpersFromDom() {
  document.querySelectorAll('#newTicketCard [data-helper-idx]').forEach((el, hi) => {
    if (!newTicketState.helpers[hi]) return;
    newTicketState.helpers[hi].helperId = el.querySelector('.nt-helper-select').value;
    newTicketState.helpers[hi].hours = el.querySelector('.nt-helper-hours').value;
    newTicketState.helpers[hi].perDiem = el.querySelector('.nt-helper-pd').checked;
  });
}

document.getElementById('newTicketBtn').addEventListener('click', () => {
  newTicketState = newTicketState ? null : emptyNewTicketState();
  renderNewTicketCard();
});

document.getElementById('newTicketCard').addEventListener('click', async (e) => {
  if (!newTicketState) return;
  if (e.target.closest('[data-action="cancel-new-ticket"]')) { newTicketState = null; renderNewTicketCard(); return; }
  const modeBtn = e.target.closest('[data-action="mode-welder"], [data-action="mode-helpers"]');
  if (modeBtn) {
    syncNewTicketPartsFromDom();
    syncNewTicketHelpersFromDom();
    newTicketState.mode = modeBtn.dataset.action === 'mode-helpers' ? 'helpers' : 'welder';
    // A helper-only ticket always needs at least one helper, so start it with a
    // row rather than an empty list and an Add button to find.
    if (newTicketState.mode === 'helpers' && !newTicketState.helpers.length) {
      newTicketState.helpers.push({ helperId: '', hours: 8, perDiem: false });
    }
    renderNewTicketCard();
    return;
  }
  if (e.target.closest('[data-action="add-new-part"]')) {
    syncNewTicketPartsFromDom();
    newTicketState.parts.push({ id: null, description: '', quantity: 1, rate: '' });
    renderNewTicketCard();
    return;
  }
  const removePartBtn = e.target.closest('[data-action="remove-new-part"]');
  if (removePartBtn) {
    syncNewTicketPartsFromDom();
    const idx = Number(removePartBtn.closest('[data-part-idx]').dataset.partIdx);
    newTicketState.parts.splice(idx, 1);
    if (!newTicketState.parts.length) newTicketState.parts.push({ id: null, description: '', quantity: 1, rate: '' });
    renderNewTicketCard();
    return;
  }
  if (e.target.closest('[data-action="add-new-helper"]')) {
    syncNewTicketHelpersFromDom();
    newTicketState.helpers.push({ helperId: '', hours: 8, perDiem: false });
    renderNewTicketCard();
    return;
  }
  const removeHelperBtn = e.target.closest('[data-action="remove-new-helper"]');
  if (removeHelperBtn) {
    syncNewTicketHelpersFromDom();
    const idx = Number(removeHelperBtn.closest('[data-helper-idx]').dataset.helperIdx);
    newTicketState.helpers.splice(idx, 1);
    renderNewTicketCard();
    return;
  }
  if (e.target.closest('[data-action="save-new-ticket"]')) { await saveNewTicket(); }
});

document.getElementById('newTicketCard').addEventListener('change', (e) => {
  if (!newTicketState) return;
  if (e.target.classList.contains('nt-welder-select')) { newTicketState.welderId = e.target.value; return; }
  if (e.target.classList.contains('nt-date-input')) { newTicketState.entryDate = e.target.value; return; }
  if (e.target.classList.contains('nt-job-select')) {
    newTicketState.jobId = e.target.value;
    if (newTicketState.jobId !== 'other') newTicketState.oneOffName = '';
    const j = jobsById[newTicketState.jobId];
    if (!(j && j.is_yard)) newTicketState.forJobId = '';
    syncNewTicketPartsFromDom();
    renderNewTicketCard();
    return;
  }
  if (e.target.classList.contains('nt-forjob-select')) { newTicketState.forJobId = e.target.value; return; }
  if (e.target.classList.contains('nt-pd-input')) { newTicketState.perDiem = e.target.checked; return; }
  if (e.target.classList.contains('nt-stainless-input')) { newTicketState.stainless = e.target.checked; return; }
  const helperRow = e.target.closest('[data-helper-idx]');
  if (helperRow) {
    const idx = Number(helperRow.dataset.helperIdx);
    if (!newTicketState.helpers[idx]) return;
    if (e.target.classList.contains('nt-helper-select')) newTicketState.helpers[idx].helperId = e.target.value;
    if (e.target.classList.contains('nt-helper-pd')) newTicketState.helpers[idx].perDiem = e.target.checked;
  }
});

document.getElementById('newTicketCard').addEventListener('input', (e) => {
  if (!newTicketState) return;
  if (e.target.classList.contains('nt-oneoff-input')) { newTicketState.oneOffName = e.target.value; return; }
  if (e.target.classList.contains('nt-desc-input')) { newTicketState.description = e.target.value; return; }
  if (e.target.classList.contains('nt-hours-input')) { newTicketState.hours = e.target.value; return; }
  const partRow = e.target.closest('[data-part-idx]');
  if (partRow) {
    const idx = Number(partRow.dataset.partIdx);
    if (!newTicketState.parts[idx]) return;
    if (e.target.classList.contains('nt-part-desc')) newTicketState.parts[idx].description = e.target.value;
    if (e.target.classList.contains('nt-part-qty')) newTicketState.parts[idx].quantity = e.target.value;
    if (e.target.classList.contains('nt-part-rate')) newTicketState.parts[idx].rate = e.target.value;
  }
  const helperRow = e.target.closest('[data-helper-idx]');
  if (helperRow && e.target.classList.contains('nt-helper-hours')) {
    const idx = Number(helperRow.dataset.helperIdx);
    if (newTicketState.helpers[idx]) newTicketState.helpers[idx].hours = e.target.value;
  }
});

async function saveNewTicket() {
  syncNewTicketPartsFromDom();
  syncNewTicketHelpersFromDom();
  const s = newTicketState;
  const welderMode = s.mode !== 'helpers';
  const other = s.jobId === 'other';
  const job = jobsById[s.jobId];
  const yard = !!(job && job.is_yard);
  const flat = welderMode && !!(job && job.billing_type === 'flat');
  const namedHelpers = s.helpers.filter(h => h.helperId);

  if (welderMode && !s.welderId) { alert('Pick the welder, or switch to Helpers only.'); return; }
  if (!s.entryDate || !s.jobId) { alert('Date and job are both required.'); return; }
  if (other && !s.oneOffName.trim()) { alert('Name the one-off job.'); return; }
  if (yard && !s.forJobId) { alert("Pick which job the yard work is for."); return; }
  if (!s.description.trim()) { alert('Add a description.'); return; }
  if (!welderMode && !namedHelpers.length) {
    alert('A helpers-only ticket needs at least one helper on it.'); return;
  }

  const btn = document.querySelector('#newTicketCard [data-action="save-new-ticket"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  try {
    // With no welder there are no welder hours, no welder per diem and nothing
    // to call stainless - all of that belongs to a man who is not on this ticket.
    const { data, error } = await sb.from('daily_entries').insert({
      welder_id: welderMode ? s.welderId : null,
      // A helpers-only ticket has no welder on it, so without a supervisor it
      // belongs to nobody: every Log Work page filters on one or the other, and
      // an ownerless ticket appears on none of them. Two of Isidro Hinojosa's
      // days went in that way and were only ever visible from this page.
      supervisor_id: welderMode ? null : currentUser.id,
      entry_date: s.entryDate,
      job_id: other ? null : s.jobId,
      one_off_name: other ? s.oneOffName.trim() : null,
      for_job_id: yard ? s.forJobId : null,
      description: s.description.trim(),
      hours: welderMode ? (Number(s.hours) || 0) : 0,
      per_diem: welderMode ? s.perDiem : false,
      is_stainless: welderMode ? s.stainless : false
    }).select().single();
    if (error) throw error;

    if (flat) {
      const validParts = s.parts
        .filter(p => p.description.trim() && Number(p.quantity) > 0 && Number(p.rate) > 0)
        .map(p => ({ daily_entry_id: data.id, description: p.description.trim(), quantity: Number(p.quantity), rate: Number(p.rate) }));
      if (validParts.length) {
        const { error: partsErr } = await sb.from('daily_entry_parts').insert(validParts);
        if (partsErr) throw partsErr;
      }
    }

    const validHelpers = namedHelpers
      .map(h => ({ daily_entry_id: data.id, helper_id: h.helperId, hours: Number(h.hours) || 0, per_diem: h.perDiem }));
    if (validHelpers.length) {
      const { error: helpersErr } = await sb.from('daily_entry_helpers').insert(validHelpers);
      if (helpersErr) {
        // A helper-only ticket with no helpers on it is an empty row nothing can
        // reach, so take it back out rather than leave it on the week.
        if (!welderMode) await sb.from('daily_entries').delete().eq('id', data.id);
        throw helpersErr;
      }
    }

    newTicketState = null;
    renderNewTicketCard();
    await loadWeek();
  } catch (err) {
    alert('Could not submit ticket: ' + err.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Submit ticket'; }
  }
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

  await refreshNextInvoiceNumber();
  await loadWeek();

  InvoicePreview.wire();

  await liveData({
    reload: loadWeek,
    isBusy: () => newTicketState !== null || !!document.querySelector('.edit-row-form'),
    tables: ['daily_entries', 'daily_entry_helpers', 'daily_entry_parts', 'job_weeks'],
    channel: 'approvals'
  });
})();
