let currentUser = null;
let currentProfile = null;
let existingReportId = null;

const dateInput = document.getElementById('dateInput');
const submitBtn = document.getElementById('submitBtn');

const PI = 3.14;
// [nominal, OD] from the shop weld inch chart
const PIPE = [[2,2.38],[3,3.5],[4,4.5],[5,5.56],[6,6.63],[8,8.63],[10,10.75],[12,12.75],
              [14,14],[16,16],[18,18],[20,20],[22,22],[24,24],[26,26],[28,28],[30,30],
              [32,32],[34,34],[36,36],[38,38],[40,40]];
// [size, Std weld inches] (Sch 80 = Std * 1.4)
const OLET = [[0.5,5.28],[0.75,6.66],[1,8.23],[2,14.95],[3,21.98],[4,28.26],[6,41.64],[8,54.2],[10,67.51]];

function fmt(n) { return Math.round(n * 100) / 100; }
function todayIso() { return new Date().toISOString().slice(0, 10); }

function newMiscRow(desc, inches) {
  return { uid: Math.random().toString(36).slice(2), desc: desc || '', inches: inches != null ? inches : '' };
}
let miscRows = [newMiscRow()];

function miscRowHtml(r) {
  return `
    <div class="wr-misc-row" data-misc-uid="${r.uid}">
      <input type="text" class="input wr-misc-desc" placeholder="Description (pipe supports, tacks, repairs…)" value="${escAttr(r.desc)}">
      <input type="number" step="0.1" min="0" class="input wr-misc-in" placeholder="in" value="${escAttr(r.inches)}">
      <button type="button" class="row-x" data-action="remove-misc">&times;</button>
    </div>`;
}
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
function escAttr(str) { return esc(str).replace(/"/g, '&quot;'); }

function renderMisc() {
  document.getElementById('miscBody').innerHTML = miscRows.map(miscRowHtml).join('');
}

function buildPipeRows() {
  const pb = document.getElementById('pipeBody');
  pb.innerHTML = PIPE.map(([nom, od]) => {
    const std = od * PI, s80 = std * 1.4, s100 = std * 1.6;
    return `
      <tr data-rowkey="pipe-${nom}">
        <td class="wr-l">${nom}"</td>
        <td class="wr-per">${od.toFixed(2)}</td>
        <td class="wr-per">${fmt(std)}</td>
        <td><input class="input wr-qty-input" type="number" min="0" step="1" data-val="${std}" data-lbl="${nom}&quot; Std"></td>
        <td class="wr-per">${fmt(s80)}</td>
        <td><input class="input wr-qty-input" type="number" min="0" step="1" data-val="${s80}" data-lbl="${nom}&quot; Sch80"></td>
        <td class="wr-per">${fmt(s100)}</td>
        <td><input class="input wr-qty-input" type="number" min="0" step="1" data-val="${s100}" data-lbl="${nom}&quot; Sch100+"></td>
        <td class="wr-rowtot" data-rowtot>0</td>
      </tr>`;
  }).join('');
}
function buildOletRows() {
  const ob = document.getElementById('oletBody');
  ob.innerHTML = OLET.map(([sz, std]) => {
    const s80 = std * 1.4;
    return `
      <tr data-rowkey="olet-${sz}">
        <td class="wr-l">${sz}"</td>
        <td class="wr-per">${fmt(std)}</td>
        <td><input class="input wr-qty-input" type="number" min="0" step="1" data-val="${std}" data-lbl="Olet ${sz}&quot; Std"></td>
        <td class="wr-per">${fmt(s80)}</td>
        <td><input class="input wr-qty-input" type="number" min="0" step="1" data-val="${s80}" data-lbl="Olet ${sz}&quot; Sch80"></td>
        <td class="wr-rowtot" data-rowtot>0</td>
      </tr>`;
  }).join('');
}

function recalc() {
  let pipeTotal = 0, oletTotal = 0, miscTotal = 0;
  document.querySelectorAll('#pipeBody tr').forEach(tr => {
    let t = 0;
    tr.querySelectorAll('.wr-qty-input').forEach(q => { t += (Number(q.value) || 0) * Number(q.dataset.val); });
    tr.querySelector('[data-rowtot]').textContent = fmt(t);
    pipeTotal += t;
  });
  document.querySelectorAll('#oletBody tr').forEach(tr => {
    let t = 0;
    tr.querySelectorAll('.wr-qty-input').forEach(q => { t += (Number(q.value) || 0) * Number(q.dataset.val); });
    tr.querySelector('[data-rowtot]').textContent = fmt(t);
    oletTotal += t;
  });
  document.querySelectorAll('.wr-misc-in').forEach(m => { miscTotal += Number(m.value) || 0; });

  const grand = pipeTotal + oletTotal + miscTotal;
  document.getElementById('pipeSub').textContent = fmt(pipeTotal) + ' in';
  document.getElementById('oletSub').textContent = fmt(oletTotal) + ' in';
  document.getElementById('miscSub').textContent = fmt(miscTotal) + ' in';
  document.getElementById('pipeSub2').textContent = fmt(pipeTotal);
  document.getElementById('oletSub2').textContent = fmt(oletTotal);
  document.getElementById('miscSub2').textContent = fmt(miscTotal);
  document.getElementById('grandTotal').textContent = fmt(grand);
  return { pipeTotal: fmt(pipeTotal), oletTotal: fmt(oletTotal), miscTotal: fmt(miscTotal), grand: fmt(grand) };
}

document.addEventListener('input', (e) => {
  if (e.target.classList.contains('wr-qty-input') || e.target.classList.contains('wr-misc-in')) recalc();
  if (e.target.classList.contains('wr-misc-desc')) {
    const row = e.target.closest('[data-misc-uid]');
    const r = miscRows.find(x => x.uid === row.dataset.miscUid);
    if (r) r.desc = e.target.value;
  }
  if (e.target.classList.contains('wr-misc-in')) {
    const row = e.target.closest('[data-misc-uid]');
    const r = miscRows.find(x => x.uid === row.dataset.miscUid);
    if (r) r.inches = e.target.value;
  }
});

document.getElementById('miscBody').addEventListener('click', (e) => {
  if (e.target.closest('[data-action="remove-misc"]')) {
    const row = e.target.closest('[data-misc-uid]');
    miscRows = miscRows.filter(x => x.uid !== row.dataset.miscUid);
    if (!miscRows.length) miscRows.push(newMiscRow());
    renderMisc();
    recalc();
  }
});
document.getElementById('addMiscBtn').addEventListener('click', () => {
  miscRows.push(newMiscRow());
  renderMisc();
});

function buildBreakdown() {
  const breakdown = [];
  document.querySelectorAll('.wr-qty-input').forEach(q => {
    const v = Number(q.value) || 0;
    if (v > 0) breakdown.push({ label: q.dataset.lbl, qty: v, total: fmt(v * Number(q.dataset.val)) });
  });
  return breakdown;
}
function buildMiscItems() {
  return miscRows
    .filter(r => r.desc.trim() || Number(r.inches) > 0)
    .map(r => ({ description: r.desc.trim() || '(no description)', inches: Number(r.inches) || 0 }));
}

async function loadExistingReport() {
  existingReportId = null;
  const date = dateInput.value || todayIso();
  const { data } = await sb.from('weld_reports')
    .select('*')
    .eq('welder_id', currentUser.id)
    .eq('report_date', date)
    .maybeSingle();

  buildPipeRows();
  buildOletRows();
  miscRows = [newMiscRow()];
  renderMisc();

  if (data) {
    existingReportId = data.id;
    (data.breakdown || []).forEach(item => {
      const input = document.querySelector(`.wr-qty-input[data-lbl="${cssEscape(item.label)}"]`);
      if (input) input.value = item.qty;
    });
    if ((data.misc_items || []).length) {
      miscRows = data.misc_items.map(m => newMiscRow(m.description, m.inches));
      renderMisc();
    }
    document.getElementById('submitBtn').textContent = 'Update Weld Report';
  } else {
    document.getElementById('submitBtn').textContent = 'Submit Weld Report';
  }
  recalc();
}
function cssEscape(s) { return String(s).replace(/"/g, '\\"'); }

submitBtn.addEventListener('click', async () => {
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving...';

  const totals = recalc();
  const date = dateInput.value || todayIso();
  const payload = {
    welder_id: currentUser.id,
    report_date: date,
    pipe_inches: totals.pipeTotal,
    olet_inches: totals.oletTotal,
    misc_inches: totals.miscTotal,
    total_inches: totals.grand,
    breakdown: buildBreakdown(),
    misc_items: buildMiscItems(),
    updated_at: new Date().toISOString()
  };

  const { error } = await sb.from('weld_reports').upsert(payload, { onConflict: 'welder_id,report_date' });

  if (error) {
    console.error(error);
    alert('Something went wrong saving. Please try again or contact the office.');
    submitBtn.disabled = false;
    submitBtn.textContent = existingReportId ? 'Update Weld Report' : 'Submit Weld Report';
    return;
  }

  document.getElementById('successSub').textContent = `${totals.grand} in logged for ${new Date(date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}. It'll be included in tonight's summary.`;
  document.getElementById('reportScreen').style.display = 'none';
  document.getElementById('successScreen').style.display = 'block';
  submitBtn.disabled = false;
});

document.getElementById('editAgainBtn').addEventListener('click', () => {
  document.getElementById('successScreen').style.display = 'none';
  document.getElementById('reportScreen').style.display = 'block';
});

dateInput.addEventListener('change', () => { loadExistingReport(); });

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

  await loadExistingReport();
})();
