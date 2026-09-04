/* The crew board.
 *
 * Every welder sees every welder's inches for the week. Nothing on this page
 * writes anything, and nothing on it can be clicked into a record: it reads
 * crew_week_inches(), which returns names and inches and nothing else - no job,
 * no customer, no rate, no hours, no money. A man can see he is behind without
 * being handed the book.
 *
 * A welder cannot read another man's weld_reports row, and should not be able
 * to. That is why this goes through the function rather than the table. */

let currentUser = null;
let weekStart = null;                 // Monday of the week on screen
let sortBy = 'inches';                // 'inches' or 'rate' - a view, never a write

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
function fmt(n) { return Math.round(Number(n || 0) * 100) / 100; }
function fmt0(n) { return Math.round(Number(n || 0)); }
function fmt1(n) { return (Math.round(Number(n || 0) * 10) / 10).toFixed(1); }

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

/* Weeks run Monday to Sunday, the same as everywhere else in the portal. */
function mondayOf(d) {
  const x = new Date(d);
  const back = (x.getDay() + 6) % 7;   // Sun -> 6, Mon -> 0
  x.setDate(x.getDate() - back);
  x.setHours(0, 0, 0, 0);
  return x;
}

function weekLabel(start) {
  const end = addDays(start, 6);
  const opt = { month: 'short', day: 'numeric' };
  const a = start.toLocaleDateString('en-US', opt);
  const b = end.toLocaleDateString('en-US', opt);
  const thisWeek = ymd(mondayOf(new Date())) === ymd(start);
  return `${a} – ${b}${thisWeek ? ' · this week' : ''}`;
}

function render(rows) {
  const body = document.getElementById('boardBody');
  const totalsEl = document.getElementById('crewTotals');

  if (!rows.length) {
    body.innerHTML = '<p class="cb-empty">No weld reports turned in for this week yet.</p>';
    totalsEl.innerHTML = '';
    return;
  }

  // One line per man, his days across it.
  const byWelder = {};
  rows.forEach(r => {
    const w = byWelder[r.welder_id] || (byWelder[r.welder_id] = {
      id: r.welder_id, name: r.welder_name, days: {}, total: 0, hours: 0, rate: null,
    });
    w.days[r.report_date] = (w.days[r.report_date] || 0) + Number(r.inches || 0);
    w.total += Number(r.inches || 0);
    // Only hours from days he actually turned a report in, so the rate divides
    // the inches by the time that produced them. A day with no ticket filed
    // leaves hours unknown rather than counting as zero.
    if (r.hours != null && Number(r.hours) > 0) w.hours += Number(r.hours);
  });
  Object.values(byWelder).forEach(w => {
    w.rate = w.hours > 0 ? w.total / w.hours : null;
  });

  // Inches is the headline; in/hr is the fair one. A man on eight hours reads
  // lower than one on twelve on inches alone even when he outworked him, so the
  // board can be read either way. Nothing is edited by this - it reorders rows.
  const welders = Object.values(byWelder).sort((a, b) => sortBy === 'rate'
    ? (b.rate == null ? -1 : a.rate == null ? 1 : b.rate - a.rate)
    : b.total - a.total);
  const crewTotal = welders.reduce((s, w) => s + w.total, 0);
  const crewHours = welders.reduce((s, w) => s + w.hours, 0);
  const bestTotal = Math.max(0, ...welders.map(w => w.total));
  const bestRate  = Math.max(0, ...welders.map(w => w.rate || 0));

  totalsEl.innerHTML = `
    <div class="cb-stat"><span class="cb-stat-lbl">Crew this week</span><span class="cb-stat-val">${fmt0(crewTotal)} in</span></div>
    <div class="cb-stat"><span class="cb-stat-lbl">Welders reporting</span><span class="cb-stat-val">${welders.length}</span></div>
    <div class="cb-stat"><span class="cb-stat-lbl">Crew in/hr</span><span class="cb-stat-val">${crewHours > 0 ? fmt1(crewTotal / crewHours) : '—'}</span></div>`;

  const dates = DAYS.map((_, i) => ymd(addDays(weekStart, i)));

  body.innerHTML = `
    <div class="cb-table">
      <div class="cb-row cb-row-head">
        <div class="cb-c-rank"></div>
        <div class="cb-c-name">Welder</div>
        ${DAYS.map(d => `<div class="cb-c-day">${d}</div>`).join('')}
        <div class="cb-c-total">Week</div>
        <div class="cb-c-rate">In/hr</div>
      </div>
      ${welders.map((w, i) => {
        const me = w.id === (currentUser && currentUser.id);
        // The bar is relative to the best week on the board, so the shape of it
        // reads at a glance without anybody doing arithmetic.
        const val  = sortBy === 'rate' ? (w.rate || 0) : w.total;
        const best = sortBy === 'rate' ? bestRate : bestTotal;
        const pct = best > 0 && val > 0 ? Math.max(3, Math.round((val / best) * 100)) : 0;
        return `
        <div class="cb-row${me ? ' cb-row-me' : ''}">
          <div class="cb-c-rank">${i + 1}</div>
          <div class="cb-c-name">
            ${esc(w.name)}${me ? '<span class="cb-you">you</span>' : ''}
            <span class="cb-bar"><span class="cb-bar-fill" style="width:${pct}%"></span></span>
          </div>
          ${dates.map((d, di) => {
            const v = w.days[d];
            // The day carries its own label so a phone can drop the header row
            // and still say which column is which.
            return `<div class="cb-c-day${v ? '' : ' cb-c-nil'}" data-day="${DAYS[di]}">${v ? fmt0(v) : '·'}</div>`;
          }).join('')}
          <div class="cb-c-total">${fmt0(w.total)}</div>
          <div class="cb-c-rate${w.rate == null ? ' cb-c-nil' : ''}"
               title="${w.rate == null ? 'No hours on his time ticket for the days he reported' : `${fmt0(w.total)} in over ${fmt(w.hours)} hrs`}"
          >${w.rate == null ? '—' : fmt1(w.rate)}</div>
        </div>`;
      }).join('')}
    </div>`;
}

async function load() {
  document.getElementById('weekLabel').textContent = weekLabel(weekStart);
  const body = document.getElementById('boardBody');
  body.innerHTML = '<p class="cb-empty">Loading…</p>';

  const { data, error } = await sb.rpc('crew_week_inches', { p_week_start: ymd(weekStart) });
  if (error) {
    body.innerHTML = `<p class="cb-empty cb-err">Could not load the board: ${esc(error.message)}</p>`;
    document.getElementById('crewTotals').innerHTML = '';
    return;
  }
  render(data || []);
}

document.querySelectorAll('.cb-sort-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (sortBy === btn.dataset.sort) return;
    sortBy = btn.dataset.sort;
    document.querySelectorAll('.cb-sort-btn').forEach(b => b.classList.toggle('on', b === btn));
    load();
  });
});

document.getElementById('prevWeekBtn').addEventListener('click', () => { weekStart = addDays(weekStart, -7); load(); });
document.getElementById('nextWeekBtn').addEventListener('click', () => {
  const next = addDays(weekStart, 7);
  // Nothing to see past this week.
  if (next > mondayOf(new Date())) return;
  weekStart = next;
  load();
});

(async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  const { data: profile } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
  document.getElementById('userName').textContent = profile ? profile.full_name : currentUser.email;
  if (profile && profile.role === 'admin') {
    document.getElementById('adminBadge').style.display = '';
    document.getElementById('adminNavLinks').style.display = '';
  }

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await sb.auth.signOut();
    window.location.href = 'login.html';
  });

  weekStart = mondayOf(new Date());
  await load();
})();
