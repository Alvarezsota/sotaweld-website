let currentUser = null;
let currentProfile = null;
let jobs = [];
let weldersList = [];
let entries = [];

const dateInput = document.getElementById('dateInput');
const submitBtn = document.getElementById('submitBtn');
const addJobBtn = document.getElementById('addJobBtn');
const entriesContainer = document.getElementById('entriesContainer');

const SPLIT_FN_URL = 'https://woqzbterwialanccprhp.supabase.co/functions/v1/weld-split-credit';

const PI = 3.14;
// [nominal, OD] from the shop weld inch chart
const PIPE = [[1.5,1.63],[2,2.38],[3,3.5],[4,4.5],[5,5.56],[6,6.63],[8,8.63],[10,10.75],[12,12.75],
              [14,14],[16,16],[18,18],[20,20],[22,22],[24,24],[26,26],[28,28],[30,30],
              [32,32],[34,34],[36,36],[38,38],[40,40]];
// [size, Std weld inches] (Sch 80 = Std * 1.4)
const OLET = [[0.5,5.28],[0.75,6.66],[1,8.23],[1.5,11.99],[2,14.95],[3,21.98],[4,28.26],[6,41.64],[8,54.2],[10,67.51]];
// Big pipe (14"+) can be split between two welders working the same weld
const BIG_PIPE = PIPE.filter(([nom]) => nom >= 12);
// Shop policy: 12" and bigger is a two-welder job. Anything that size logged in
// the solo Pipe Welds table gets flagged before it can be submitted.
const SPLIT_POLICY_MIN = 12;
function pipeWeldInches(nominal, schedule) {
  const row = PIPE.find(([nom]) => nom === Number(nominal));
  if (!row) return 0;
  const std = row[1] * PI;
  if (schedule === 'sch80') return std * 1.4;
  if (schedule === 'sch100') return std * 1.6;
  return std;
}
function schedLabel(schedule) {
  return schedule === 'sch80' ? 'Sch80' : schedule === 'sch100' ? 'Sch100+' : 'Std';
}

function fmt(n) { return Math.round(n * 100) / 100; }
function todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function uid() { return Math.random().toString(36).slice(2); }
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
function escAttr(str) { return esc(str).replace(/"/g, '&quot;'); }
function cssEscape(s) { return String(s).replace(/"/g, '\\"'); }

function isYard(jobId) {
  const j = jobs.find(x => x.id === jobId);
  return !!(j && j.is_yard);
}

function newMiscRow(desc) {
  return { uid: uid(), desc: desc || '' };
}
function newSplitLine(nominal, schedule, qty) {
  return { uid: uid(), nominal: nominal || '', schedule: schedule || 'std', qty: qty != null ? qty : 1 };
}
function newEntry() {
  return { uid: uid(), rowId: null, jobId: '', oneOffName: '', forJobId: '', miscRows: [newMiscRow()], splitPartnerId: '', splitLines: [] };
}

function miscRowHtml(r) {
  return `
    <div class="wr-misc-row" data-misc-uid="${r.uid}">
      <input type="text" class="input wr-misc-desc" placeholder="Description (pipe supports, structural steel…)" value="${escAttr(r.desc)}">
      <button type="button" class="row-x" data-action="remove-misc">&times;</button>
    </div>`;
}

function splitLineHtml(line) {
  return `
    <div class="wr-split-row" data-split-uid="${line.uid}">
      <select class="input split-size-select">
        <option value="">Size…</option>
        ${BIG_PIPE.map(([nom]) => `<option value="${nom}" ${Number(line.nominal) === nom ? 'selected' : ''}>${nom}"</option>`).join('')}
      </select>
      <select class="input split-sched-select">
        <option value="std" ${line.schedule === 'std' ? 'selected' : ''}>Std</option>
        <option value="sch80" ${line.schedule === 'sch80' ? 'selected' : ''}>Sch 80</option>
        <option value="sch100" ${line.schedule === 'sch100' ? 'selected' : ''}>Sch 100+</option>
      </select>
      <input type="number" min="0" step="1" class="input split-qty-input" placeholder="Qty" value="${escAttr(line.qty)}">
      <span class="split-line-total" data-split-uid="${line.uid}">0 in (your half)</span>
      <button type="button" class="row-x" data-action="remove-split">&times;</button>
    </div>`;
}

function pipeRowsHtml() {
  return PIPE.map(([nom, od]) => {
    const std = od * PI, s80 = std * 1.4, s100 = std * 1.6;
    return `
      <tr data-rowkey="pipe-${nom}">
        <td class="wr-l">${nom}"</td>
        <td class="wr-per">${od.toFixed(2)}</td>
        <td class="wr-per">${fmt(std)}</td>
        <td><input class="input wr-qty-input" type="number" min="0" step="1" data-nom="${nom}" data-val="${std}" data-lbl="${nom}&quot; Std"></td>
        <td class="wr-per">${fmt(s80)}</td>
        <td><input class="input wr-qty-input" type="number" min="0" step="1" data-nom="${nom}" data-val="${s80}" data-lbl="${nom}&quot; Sch80"></td>
        <td class="wr-per">${fmt(s100)}</td>
        <td><input class="input wr-qty-input" type="number" min="0" step="1" data-nom="${nom}" data-val="${s100}" data-lbl="${nom}&quot; Sch100+"></td>
        <td class="wr-rowtot" data-rowtot>0</td>
      </tr>`;
  }).join('');
}
function oletRowsHtml() {
  return OLET.map(([sz, std]) => {
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

function oneOffSlotHtml(entry) {
  if (entry.jobId !== 'other') return '';
  return `
    <div class="oneoff">
      <label class="field-label">Name this one-off job</label>
      <input type="text" class="input oneoff-name-input" placeholder="e.g. Emergency repair — Miller lease" value="${escAttr(entry.oneOffName)}">
    </div>`;
}
function forJobSlotHtml(entry) {
  if (!isYard(entry.jobId)) return '';
  return `
    <div class="oneoff yard">
      <label class="field-label">Which job is this yard work for?</label>
      <select class="input for-job-select">
        <option value="">Pick the job it's for…</option>
        ${jobs.filter(j => !j.is_yard).map(j => `<option value="${j.id}" ${entry.forJobId === j.id ? 'selected' : ''}>${esc(j.name)}${j.operator ? ' — ' + esc(j.operator) : ''}</option>`).join('')}
      </select>
      <span class="oneoff-note">These weld inches land on that job's log.</span>
    </div>`;
}

function entryCardHtml(entry) {
  const other = entry.jobId === 'other';
  return `
    <div class="job-card wr-entry" data-entry-uid="${entry.uid}">
      <div class="job-card-top">
        <span class="job-idx">Weld report</span>
        <button type="button" class="remove-job" data-action="remove-entry">&times; Remove</button>
      </div>
      <label class="field-label">Jobsite</label>
      <select class="input job-select">
        <option value="">Pick your job…</option>
        ${jobs.map(j => `<option value="${j.id}" ${entry.jobId === j.id ? 'selected' : ''}>${esc(j.name)}${j.operator ? ' — ' + esc(j.operator) : ''}${j.is_yard ? ' (yard)' : ''}</option>`).join('')}
        <option value="other" ${other ? 'selected' : ''}>+ Other / one-off job…</option>
      </select>
      <div data-oneoff-slot>${oneOffSlotHtml(entry)}</div>
      <div data-forjob-slot>${forJobSlotHtml(entry)}</div>

      <div class="wr-section-inner">
        <div class="wr-section-head"><span>Pipe Welds</span><span class="wr-section-total" data-pipe-sub>0 in</span></div>
        <div class="wr-table-scroll">
          <table class="wr-table">
            <thead>
              <tr><th class="wr-l">Nominal</th><th>OD</th><th>Std /weld</th><th>Qty</th><th>Sch 80 /weld</th><th>Qty</th><th>Sch 100+ /weld</th><th>Qty</th><th>Weld In.</th></tr>
            </thead>
            <tbody data-pipe-body>${pipeRowsHtml()}</tbody>
          </table>
        </div>
        <div class="wr-big-warn" data-bigwarn hidden>
          <div class="wr-big-warn-hd">&#9888; Are you sure this shouldn&rsquo;t be a split weld?</div>
          <div class="wr-big-warn-txt">Shop policy: <b>12&Prime; and bigger runs with two welders.</b> You logged these in the solo pipe table:</div>
          <div class="wr-big-warn-list" data-bigwarn-list></div>
          <div class="wr-big-warn-txt">If you had a partner on them, clear them here and put them under <b>Split Welds</b> below instead &mdash; your partner gets credited automatically.</div>
          <label class="wr-big-warn-ack"><input type="checkbox" class="wr-big-ack"> No partner &mdash; I ran these by myself.</label>
        </div>
      </div>

      <div class="wr-section-inner">
        <div class="wr-section-head"><span>Miscellaneous / Off-chart</span></div>
        <div data-misc-body>${entry.miscRows.map(miscRowHtml).join('')}</div>
        <button type="button" class="add-part" data-action="add-misc">+ Add line</button>
      </div>

      <div class="wr-section-inner wr-split-section">
        <div class="wr-section-head"><span>Split Welds (12&Prime;+ with a partner)</span><span class="wr-section-total" data-split-sub>0 in (your half)</span></div>
        <span class="oneoff-note" style="display:block;margin-bottom:10px;">For big pipe where two welders worked the same weld together — pick who you split it with. They're automatically credited their half too, no need for them to log it separately.</span>
        <label class="field-label">Split with</label>
        <select class="input split-partner-select">
          <option value="">Pick the other welder…</option>
          ${weldersList.filter(w => w.id !== currentUser.id).map(w => `<option value="${w.id}" ${entry.splitPartnerId === w.id ? 'selected' : ''}>${esc(w.full_name)}</option>`).join('')}
        </select>
        <div data-split-body>${entry.splitLines.map(splitLineHtml).join('')}</div>
        <button type="button" class="add-part" data-action="add-split">+ Add split weld</button>
      </div>

      <div class="wr-section-inner">
        <div class="wr-section-head"><span>Olet Welds</span><span class="wr-section-total" data-olet-sub>0 in</span></div>
        <div class="wr-table-scroll">
          <table class="wr-table">
            <thead>
              <tr><th class="wr-l">Olet Size</th><th>Std /weld</th><th>Qty</th><th>Sch 80 /weld</th><th>Qty</th><th>Weld In.</th></tr>
            </thead>
            <tbody data-olet-body>${oletRowsHtml()}</tbody>
          </table>
        </div>
      </div>

      <div class="wr-entry-total-row"><span>Job total</span><span data-entry-total>0 in</span></div>
    </div>`;
}

function recalcEntry(entryEl) {
  let pipeTotal = 0, oletTotal = 0, miscTotal = 0;
  entryEl.querySelectorAll('[data-pipe-body] tr').forEach(tr => {
    let t = 0;
    tr.querySelectorAll('.wr-qty-input').forEach(q => { t += (Number(q.value) || 0) * Number(q.dataset.val); });
    tr.querySelector('[data-rowtot]').textContent = fmt(t);
    pipeTotal += t;
  });
  entryEl.querySelectorAll('[data-olet-body] tr').forEach(tr => {
    let t = 0;
    tr.querySelectorAll('.wr-qty-input').forEach(q => { t += (Number(q.value) || 0) * Number(q.dataset.val); });
    tr.querySelector('[data-rowtot]').textContent = fmt(t);
    oletTotal += t;
  });

  updateBigWeldWarning(entryEl);

  let splitTotal = 0;
  entryEl.querySelectorAll('.wr-split-row').forEach(row => {
    const nominal = row.querySelector('.split-size-select').value;
    const schedule = row.querySelector('.split-sched-select').value;
    const qty = Number(row.querySelector('.split-qty-input').value) || 0;
    const half = nominal ? pipeWeldInches(nominal, schedule) / 2 : 0;
    const lineTotal = half * qty;
    const totalEl = row.querySelector('.split-line-total');
    if (totalEl) totalEl.textContent = fmt(lineTotal) + ' in (your half)';
    splitTotal += lineTotal;
  });
  const splitSubEl = entryEl.querySelector('[data-split-sub]');
  if (splitSubEl) splitSubEl.textContent = fmt(splitTotal) + ' in (your half)';

  const grand = pipeTotal + oletTotal + miscTotal + splitTotal;
  entryEl.querySelector('[data-pipe-sub]').textContent = fmt(pipeTotal) + ' in';
  entryEl.querySelector('[data-olet-sub]').textContent = fmt(oletTotal) + ' in';
  entryEl.querySelector('[data-entry-total]').textContent = fmt(grand) + ' in';
  entryEl.dataset.grand = fmt(grand);
  return { pipeTotal: fmt(pipeTotal + splitTotal), oletTotal: fmt(oletTotal), miscTotal: fmt(miscTotal), splitTotal: fmt(splitTotal), grand: fmt(grand) };
}

// Flags 12"+ welds sitting in the solo pipe table. Returns true when the welder
// still owes us an answer on them.
function updateBigWeldWarning(entryEl) {
  const box = entryEl.querySelector('[data-bigwarn]');
  if (!box) return false;

  const flagged = [];
  entryEl.querySelectorAll('[data-pipe-body] .wr-qty-input').forEach(q => {
    const nom = Number(q.dataset.nom);
    const qty = Number(q.value) || 0;
    if (nom >= SPLIT_POLICY_MIN && qty > 0) flagged.push(`${qty} &times; ${esc(q.dataset.lbl)}`);
  });

  const ack = box.querySelector('.wr-big-ack');
  if (!flagged.length) {
    box.hidden = true;
    if (ack) ack.checked = false;
    return false;
  }
  box.hidden = false;
  box.querySelector('[data-bigwarn-list]').innerHTML = flagged.join('<br>');
  return !(ack && ack.checked);
}

function recalcGrand() {
  let grand = 0;
  entriesContainer.querySelectorAll('.wr-entry').forEach(el => { grand += Number(el.dataset.grand || 0); });
  document.getElementById('grandTotal').textContent = fmt(grand);
  updateSubmitState();
  return fmt(grand);
}

function entrySplitLinesValid(entryEl) {
  const rows = [...entryEl.querySelectorAll('.wr-split-row')];
  const hasQty = rows.some(row => row.querySelector('.split-size-select').value && Number(row.querySelector('.split-qty-input').value) > 0);
  if (!hasQty) return true;
  return !!entryEl.querySelector('.split-partner-select').value;
}

function updateSubmitState() {
  const grand = [...entriesContainer.querySelectorAll('.wr-entry')].reduce((s, el) => s + Number(el.dataset.grand || 0), 0);
  const hasMiscDesc = [...entriesContainer.querySelectorAll('.wr-misc-desc')].some(el => el.value.trim());

  let missing = '';
  if (!entries.length) {
    missing = 'Add at least one job.';
  } else {
    for (const e of entries) {
      if (!e.jobId) { missing = 'Pick a jobsite for every job.'; break; }
      if (e.jobId === 'other' && !e.oneOffName.trim()) { missing = 'Name the one-off job.'; break; }
      if (isYard(e.jobId) && !e.forJobId) { missing = 'Pick which job the yard work is for.'; break; }
    }
    if (!missing) {
      const badSplit = [...entriesContainer.querySelectorAll('.wr-entry')].find(el => !entrySplitLinesValid(el));
      if (badSplit) missing = 'Pick who a split weld was shared with.';
    }
    if (!missing) {
      const unconfirmed = [...entriesContainer.querySelectorAll('.wr-entry')].some(el => {
        const box = el.querySelector('[data-bigwarn]');
        const ack = box && box.querySelector('.wr-big-ack');
        return box && !box.hidden && !(ack && ack.checked);
      });
      if (unconfirmed) missing = 'Confirm the 12" and bigger welds you ran by yourself, or move them to Split Welds.';
    }
    if (!missing && !(grand > 0 || hasMiscDesc)) missing = 'Enter at least some weld inches, or a description under Miscellaneous / Off-chart.';
  }

  submitBtn.disabled = !!missing;
  const hintEl = document.getElementById('submitHint');
  if (hintEl) hintEl.textContent = missing;
}

function buildBreakdownForEntry(entryEl, partnerId, partnerName) {
  const breakdown = [];
  entryEl.querySelectorAll('.wr-qty-input').forEach(q => {
    const v = Number(q.value) || 0;
    if (v > 0) breakdown.push({ label: q.dataset.lbl, qty: v, total: fmt(v * Number(q.dataset.val)) });
  });
  entryEl.querySelectorAll('.wr-split-row').forEach(row => {
    const nominal = row.querySelector('.split-size-select').value;
    const schedule = row.querySelector('.split-sched-select').value;
    const qty = Number(row.querySelector('.split-qty-input').value) || 0;
    if (!nominal || qty <= 0) return;
    const half = pipeWeldInches(nominal, schedule) / 2;
    breakdown.push({
      label: `${nominal}" ${schedLabel(schedule)} (split w/ ${partnerName})`,
      qty, total: fmt(half * qty),
      nominal: Number(nominal), schedule, partnerId
    });
  });
  return breakdown;
}
function buildSplitItemsForPartner(entryEl, myName) {
  const items = [];
  entryEl.querySelectorAll('.wr-split-row').forEach(row => {
    const nominal = row.querySelector('.split-size-select').value;
    const schedule = row.querySelector('.split-sched-select').value;
    const qty = Number(row.querySelector('.split-qty-input').value) || 0;
    if (!nominal || qty <= 0) return;
    const half = pipeWeldInches(nominal, schedule) / 2;
    items.push({ label: `${nominal}" ${schedLabel(schedule)} (split w/ ${myName})`, qty, total: fmt(half * qty) });
  });
  return items;
}
function buildMiscItemsForEntry(entry) {
  return entry.miscRows
    .filter(r => r.desc.trim())
    .map(r => ({ description: r.desc.trim(), inches: 0 }));
}

function appendEntryCard(entry, breakdown) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = entryCardHtml(entry);
  const entryEl = wrapper.firstElementChild;
  entriesContainer.appendChild(entryEl);

  if (breakdown && breakdown.length) {
    breakdown.filter(item => !item.partnerId).forEach(item => {
      const input = entryEl.querySelector(`.wr-qty-input[data-lbl="${cssEscape(item.label)}"]`);
      if (input) input.value = item.qty;
    });
  }

  if (entries.length <= 1) {
    entryEl.querySelector('[data-action="remove-entry"]').style.display = 'none';
  }

  recalcEntry(entryEl);
  recalcGrand();
}

function refreshRemoveButtons() {
  const cards = entriesContainer.querySelectorAll('.wr-entry [data-action="remove-entry"]');
  cards.forEach(btn => { btn.style.display = entries.length > 1 ? '' : 'none'; });
}

entriesContainer.addEventListener('input', (e) => {
  const entryEl = e.target.closest('.wr-entry');
  if (!entryEl) return;
  const entry = entries.find(x => x.uid === entryEl.dataset.entryUid);
  if (!entry) return;

  if (e.target.classList.contains('wr-qty-input') || e.target.classList.contains('split-qty-input')) {
    recalcEntry(entryEl);
    recalcGrand();
  }
  if (e.target.classList.contains('oneoff-name-input')) {
    entry.oneOffName = e.target.value;
    updateSubmitState();
  }
  const row = e.target.closest('[data-misc-uid]');
  if (row) {
    const r = entry.miscRows.find(x => x.uid === row.dataset.miscUid);
    if (r && e.target.classList.contains('wr-misc-desc')) { r.desc = e.target.value; updateSubmitState(); }
  }
  const splitRow = e.target.closest('[data-split-uid]');
  if (splitRow && e.target.classList.contains('split-qty-input')) {
    const line = entry.splitLines.find(x => x.uid === splitRow.dataset.splitUid);
    if (line) line.qty = e.target.value;
  }
});

entriesContainer.addEventListener('change', (e) => {
  const entryEl = e.target.closest('.wr-entry');
  if (!entryEl) return;
  const entry = entries.find(x => x.uid === entryEl.dataset.entryUid);
  if (!entry) return;

  if (e.target.classList.contains('wr-big-ack')) {
    updateSubmitState();
    return;
  }
  if (e.target.classList.contains('job-select')) {
    entry.jobId = e.target.value;
    if (entry.jobId !== 'other') entry.oneOffName = '';
    if (!isYard(entry.jobId)) entry.forJobId = '';
    entryEl.querySelector('[data-oneoff-slot]').innerHTML = oneOffSlotHtml(entry);
    entryEl.querySelector('[data-forjob-slot]').innerHTML = forJobSlotHtml(entry);
    updateSubmitState();
    return;
  }
  if (e.target.classList.contains('for-job-select')) {
    entry.forJobId = e.target.value;
    updateSubmitState();
    return;
  }
  if (e.target.classList.contains('split-partner-select')) {
    entry.splitPartnerId = e.target.value;
    updateSubmitState();
    return;
  }
  const splitRow = e.target.closest('[data-split-uid]');
  if (splitRow && (e.target.classList.contains('split-size-select') || e.target.classList.contains('split-sched-select'))) {
    const line = entry.splitLines.find(x => x.uid === splitRow.dataset.splitUid);
    if (line) {
      if (e.target.classList.contains('split-size-select')) line.nominal = e.target.value;
      if (e.target.classList.contains('split-sched-select')) line.schedule = e.target.value;
    }
    recalcEntry(entryEl);
    recalcGrand();
  }
});

entriesContainer.addEventListener('click', async (e) => {
  const entryEl = e.target.closest('.wr-entry');
  if (!entryEl) return;
  const entry = entries.find(x => x.uid === entryEl.dataset.entryUid);
  if (!entry) return;

  if (e.target.closest('[data-action="remove-entry"]')) {
    if (entries.length <= 1) return;
    if (entry.rowId) {
      if (!confirm("Remove this job from today's weld report? This deletes it right away.")) return;
      // A refused delete returns no error and no rows. Without asking what was
      // removed this cleared the job off the screen and left it in the database,
      // so it came back on the next load - and stayed on the invoice meanwhile.
      const { data: gone, error } = await sb.from('weld_reports')
        .delete().eq('id', entry.rowId).select('id');
      if (error) { alert('Could not remove: ' + error.message); return; }
      if (!gone || gone.length === 0) {
        alert('That could not be removed.\n\n'
            + 'It is still on your report. Tell the office rather than sending it as is.');
        return;
      }
    }
    entries = entries.filter(x => x.uid !== entry.uid);
    entryEl.remove();
    refreshRemoveButtons();
    recalcGrand();
    return;
  }
  if (e.target.closest('[data-action="add-misc"]')) {
    entry.miscRows.push(newMiscRow());
    entryEl.querySelector('[data-misc-body]').innerHTML = entry.miscRows.map(miscRowHtml).join('');
    return;
  }
  const removeMiscBtn = e.target.closest('[data-action="remove-misc"]');
  if (removeMiscBtn) {
    const row = e.target.closest('[data-misc-uid]');
    entry.miscRows = entry.miscRows.filter(x => x.uid !== row.dataset.miscUid);
    if (!entry.miscRows.length) entry.miscRows.push(newMiscRow());
    entryEl.querySelector('[data-misc-body]').innerHTML = entry.miscRows.map(miscRowHtml).join('');
    recalcEntry(entryEl);
    recalcGrand();
    return;
  }
  if (e.target.closest('[data-action="add-split"]')) {
    entry.splitLines.push(newSplitLine());
    entryEl.querySelector('[data-split-body]').innerHTML = entry.splitLines.map(splitLineHtml).join('');
    recalcEntry(entryEl);
    recalcGrand();
    return;
  }
  const removeSplitBtn = e.target.closest('[data-action="remove-split"]');
  if (removeSplitBtn) {
    const row = e.target.closest('[data-split-uid]');
    entry.splitLines = entry.splitLines.filter(x => x.uid !== row.dataset.splitUid);
    entryEl.querySelector('[data-split-body]').innerHTML = entry.splitLines.map(splitLineHtml).join('');
    recalcEntry(entryEl);
    recalcGrand();
  }
});

addJobBtn.addEventListener('click', () => {
  const entry = newEntry();
  entries.push(entry);
  appendEntryCard(entry);
  refreshRemoveButtons();
});

let helpersList = [];
const helperPick = document.getElementById('helperPick');
const helperHint = document.getElementById('helperHint');

function fillHelperPicker() {
  const keep = helperPick.value;
  helperPick.innerHTML = '<option value="">Worked alone</option>'
    + helpersList.map((h) => `<option value="${h.id}">${esc(h.name)}</option>`).join('');
  if (keep) helperPick.value = keep;
}

function setHelper(id, why) {
  helperPick.value = id || '';
  const name = (helpersList.find((h) => h.id === id) || {}).name;
  if (!id) { helperHint.textContent = ''; helperHint.className = 'wr-helper-hint'; return; }
  helperHint.className = 'wr-helper-hint' + (why === 'saved' ? ' filled' : '');
  helperHint.textContent = why === 'saved'
    ? 'Saved with this report.'
    : (name || 'Somebody') + ' is on your time ticket for this day. Change it if that is wrong.';
}

/* Nothing chosen yet, so offer whoever is already on his time ticket that day.
   It is only a suggestion - he can set it back to "Worked alone". */
async function suggestHelperFromTimeTicket(date) {
  try {
    const { data: rows } = await sb.from('daily_entries')
      .select('id').eq('welder_id', currentUser.id).eq('entry_date', date);
    const ids = (rows || []).map((r) => r.id);
    if (!ids.length) { setHelper('', ''); return; }
    const { data: helpers } = await sb.from('daily_entry_helpers')
      .select('helper_id').in('daily_entry_id', ids);
    const first = (helpers || []).find((h) => h.helper_id);
    setHelper(first ? first.helper_id : '', 'suggested');
  } catch {
    setHelper('', '');            // never let this block the report
  }
}

helperPick.addEventListener('change', () => setHelper(helperPick.value, 'saved'));

async function loadReportsForDate() {
  const date = dateInput.value || todayIso();
  entriesContainer.innerHTML = '';
  entries = [];

  const { data } = await sb.from('weld_reports')
    .select('*')
    .eq('welder_id', currentUser.id)
    .eq('report_date', date)
    .order('created_at');

  if (data && data.length) {
    data.forEach(row => {
      const splitItems = (row.breakdown || []).filter(b => b.partnerId);
      const entry = {
        uid: uid(),
        rowId: row.id,
        jobId: row.job_id || 'other',
        oneOffName: row.one_off_name || '',
        forJobId: row.for_job_id || '',
        miscRows: (row.misc_items && row.misc_items.length) ? row.misc_items.map(m => newMiscRow(m.description)) : [newMiscRow()],
        splitPartnerId: splitItems.length ? splitItems[0].partnerId : '',
        splitLines: splitItems.length ? splitItems.map(b => newSplitLine(b.nominal, b.schedule, b.qty)) : []
      };
      entries.push(entry);
      appendEntryCard(entry, row.breakdown || []);
    });
    submitBtn.textContent = 'Update Weld Report';
    const saved = data.find(r => r.helper_id);
    if (saved) setHelper(saved.helper_id, 'saved');
    else await suggestHelperFromTimeTicket(date);
  } else {
    const entry = newEntry();
    entries.push(entry);
    appendEntryCard(entry);
    submitBtn.textContent = 'Submit Weld Report';
  }
  refreshRemoveButtons();
  recalcGrand();
}

submitBtn.addEventListener('click', async () => {
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving...';

  const date = dateInput.value || todayIso();

  try {
    for (const entry of entries) {
      const entryEl = entriesContainer.querySelector(`[data-entry-uid="${entry.uid}"]`);
      const totals = recalcEntry(entryEl);
      const other = entry.jobId === 'other';
      const yard = isYard(entry.jobId);

      const partner = entry.splitPartnerId ? weldersList.find(w => w.id === entry.splitPartnerId) : null;
      const partnerName = partner ? partner.full_name : '';
      const breakdown = buildBreakdownForEntry(entryEl, entry.splitPartnerId || null, partnerName);
      const miscItems = buildMiscItemsForEntry(entry);

      if (totals.grand <= 0 && !breakdown.length && !miscItems.length) {
        if (entry.rowId) {
          const { data: gone, error } = await sb.from('weld_reports')
            .delete().eq('id', entry.rowId).select('id');
          if (error) throw error;
          // Emptied to nothing but the row would not go: leave rowId in place so
          // the next save updates it rather than adding a second one.
          if (gone && gone.length > 0) entry.rowId = null;
        }
        continue;
      }

      const payload = {
        welder_id: currentUser.id,
        report_date: date,
        job_id: other ? null : entry.jobId,
        one_off_name: other ? entry.oneOffName.trim() : null,
        for_job_id: yard ? entry.forJobId : null,
        pipe_inches: totals.pipeTotal,
        olet_inches: totals.oletTotal,
        misc_inches: totals.miscTotal,
        total_inches: totals.grand,
        breakdown,
        misc_items: miscItems,
        // One answer for the whole day, written onto every job's row, because
        // the question is whether somebody was with him - not which job.
        helper_id: helperPick.value || null,
        updated_at: new Date().toISOString()
      };

      if (entry.rowId) {
        const { error } = await sb.from('weld_reports').update(payload).eq('id', entry.rowId);
        if (error) throw error;
      } else {
        const { data, error } = await sb.from('weld_reports').insert(payload).select().single();
        if (error) throw error;
        entry.rowId = data.id;
      }

      if (entry.splitPartnerId) {
        const splitItems = buildSplitItemsForPartner(entryEl, currentProfile ? currentProfile.full_name : currentUser.email);
        if (splitItems.length) {
          const { data: { session } } = await sb.auth.getSession();
          try {
            const res = await fetch(SPLIT_FN_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
              body: JSON.stringify({
                partnerWelderId: entry.splitPartnerId,
                reportDate: date,
                jobId: other ? null : entry.jobId,
                oneOffName: other ? entry.oneOffName.trim() : null,
                forJobId: yard ? entry.forJobId : null,
                items: splitItems
              })
            });
            const resJson = await res.json();
            if (!res.ok || !resJson.ok) console.error('Split credit failed:', resJson);
          } catch (splitErr) {
            console.error('Split credit request failed:', splitErr);
          }
        }
      }
    }

    const grandNow = recalcGrand();
    document.getElementById('successSub').textContent = `${grandNow} in logged for ${new Date(date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}. It'll be included in tonight's summary.`;
    document.getElementById('reportScreen').style.display = 'none';
    document.getElementById('successScreen').style.display = 'block';
  } catch (err) {
    console.error(err);
    alert('Something went wrong saving. Please try again or contact the office.');
  }
  submitBtn.disabled = false;
  submitBtn.textContent = 'Submit Weld Report';
});

document.getElementById('editAgainBtn').addEventListener('click', () => {
  document.getElementById('successScreen').style.display = 'none';
  document.getElementById('reportScreen').style.display = 'block';
});

dateInput.addEventListener('change', () => { loadReportsForDate(); });

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

  const [{ data: jobsData }, { data: weldersData }, { data: helpersData }] = await Promise.all([
    sb.from('jobs').select('*').eq('active', true).order('name'),
    sb.from('welders_public').select('*').order('full_name'),
    sb.from('helpers_public').select('id, name').eq('active', true).order('name')
  ]);
  jobs = jobsData || [];
  weldersList = weldersData || [];
  helpersList = helpersData || [];
  fillHelperPicker();

  await loadReportsForDate();
})();
