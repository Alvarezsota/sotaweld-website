/* ---------------------------------------------------------------------------
   PARTS INVOICES
   ---------------------------------------------------------------------------
   A lot of the work never goes near a job week: plate goes on the laser, parts
   come off, they get handed over. There is nobody's hours to approve and no
   week to close, but it still has to be billed -- and billed out of the same
   book of numbers, or two invoices go out with the same number on them.

   A draft takes no number. Only marking it finished spends one, so a job that
   gets talked out of existence does not leave a hole in the run for the
   accountant to explain.

   The preview and the push are InvoicePreview's, the same ones Approvals uses.
--------------------------------------------------------------------------- */

let currentUser = null;
let invoices = [];
let customers = [];
let items = [];
let editing = null;          // the invoice being written, or null
let nextInvoiceNumber = '';

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
function escAttr(str) { return esc(str).replace(/"/g, '&quot;'); }
function uid() { return Math.random().toString(36).slice(2); }

/* A job site reads under the customer it is filed under, so it cannot be taken
   for a company. CustomerBook owns the wording; this is the same list. */
const customerLabel = (c) => CustomerBook.label(c);
function money(n) {
  return '$' + Number(n || 0).toLocaleString('en-US',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function dateLabel(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined,
    { month: 'short', day: 'numeric', year: 'numeric' });
}

async function requireAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return null; }
  return session.user;
}

/* --- what a line comes to ------------------------------------------------ */
function lineAmount(l) {
  return Math.round(Number(l.quantity || 0) * Number(l.unit_price || 0) * 100) / 100;
}
function invoiceTotal(lines) {
  return (lines || []).reduce((s, l) => s + lineAmount(l), 0);
}

/* --- loading -------------------------------------------------------------- */

async function loadAll() {
  const [invRes, custRes, itemRes, nextRes] = await Promise.all([
    sb.from('parts_invoices')
      .select('*, parts_invoice_lines(*)')
      .order('invoice_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(60),
    sb.from('qb_customers').select('*').eq('active', true).order('display_name'),
    sb.from('qb_items').select('*').eq('active', true).order('name'),
    sb.rpc('peek_invoice_no'),
  ]);

  // A failed read must never look like an empty list. That mistake cost a day
  // on the Approvals page and is not being repeated here.
  const failed = [
    ['the invoices', invRes], ['the customer list', custRes], ['the item list', itemRes],
  ].filter(([, r]) => r.error);
  if (failed.length) {
    document.getElementById('invoiceList').innerHTML =
      `<li class="empty-state2">Could not load ${failed.map(([n]) => n).join(' or ')}. `
      + `<button class="btn2 btn2-ghost small" onclick="loadAll()">Try again</button></li>`;
    failed.forEach(([, r]) => console.error(r.error));
    return;
  }

  invoices = invRes.data || [];
  customers = custRes.data || [];
  items = itemRes.data || [];
  if (!nextRes.error && nextRes.data) nextInvoiceNumber = String(nextRes.data);

  renderList();
}

/* --- the list ------------------------------------------------------------- */

function statusPill(inv) {
  if (inv.status === 'synced') return '<span class="pi-pill pi-synced">In QuickBooks</span>';
  if (inv.status === 'ready') return '<span class="pi-pill pi-ready">Finished</span>';
  return '<span class="pi-pill pi-draft">Draft</span>';
}

function renderList() {
  const el = document.getElementById('invoiceList');
  if (!invoices.length) {
    el.innerHTML = '<li class="empty-state2">No parts invoices yet. Start one with the button above.</li>';
    return;
  }

  el.innerHTML = invoices.map(inv => {
    const total = invoiceTotal(inv.parts_invoice_lines);
    const count = (inv.parts_invoice_lines || []).length;
    return `
    <li>
      <div class="pi-row">
        <div class="pi-row-main">
          <div class="pi-row-top">
            <span class="pi-row-no">${inv.invoice_no ? '#' + esc(inv.invoice_no) : 'No number yet'}</span>
            ${statusPill(inv)}
          </div>
          <div class="pi-row-cust">${esc(inv.qb_customer_name)}</div>
          <div class="pi-row-meta">${esc(dateLabel(inv.invoice_date))}
            · ${count} line${count === 1 ? '' : 's'}${inv.po_number ? ' · PO ' + esc(inv.po_number) : ''}</div>
        </div>
        <div class="pi-row-side">
          <div class="pi-row-total">${money(total)}</div>
          <div class="pi-row-btns">
            <button class="btn2 btn2-line small" data-preview="${escAttr(inv.id)}">Preview</button>
            ${inv.status === 'synced'
              ? ''
              : `<button class="btn2 btn2-ghost small" data-edit="${escAttr(inv.id)}">Edit</button>`}
          </div>
        </div>
      </div>
    </li>`;
  }).join('');
}

/* --- the editor ----------------------------------------------------------- */

function blankLine() {
  return { uid: uid(), description: '', quantity: 1, unit_price: 0, qb_item_id: '' };
}

function startNew() {
  editing = {
    id: null,
    qb_customer_id: '',
    qb_customer_name: '',
    invoice_date: todayIso(),
    po_number: '',
    notes: '',
    status: 'draft',
    lines: [blankLine()],
  };
  renderEditor();
}

function startEdit(id) {
  const inv = invoices.find(i => i.id === id);
  if (!inv) return;
  if (inv.status === 'synced') return;
  editing = {
    id: inv.id,
    qb_customer_id: inv.qb_customer_id,
    qb_customer_name: inv.qb_customer_name,
    invoice_date: inv.invoice_date,
    po_number: inv.po_number || '',
    notes: inv.notes || '',
    status: inv.status,
    invoice_no: inv.invoice_no,
    lines: (inv.parts_invoice_lines || [])
      .slice()
      .sort((a, b) => (a.sort_order - b.sort_order) || a.created_at.localeCompare(b.created_at))
      .map(l => ({
        uid: uid(), id: l.id, description: l.description,
        quantity: Number(l.quantity), unit_price: Number(l.unit_price),
        qb_item_id: l.qb_item_id || '',
      })),
  };
  if (!editing.lines.length) editing.lines.push(blankLine());
  renderEditor();
  document.getElementById('editorWrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeEditor() {
  editing = null;
  document.getElementById('editorWrap').innerHTML = '';
}

function renderEditor() {
  const wrap = document.getElementById('editorWrap');
  if (!editing) { wrap.innerHTML = ''; return; }

  const total = invoiceTotal(editing.lines);
  const isNew = !editing.id;

  wrap.innerHTML = `
    <div class="card pi-editor">
      <h2 class="card-h">
        ${isNew ? 'New parts invoice' : `Invoice ${editing.invoice_no ? '#' + esc(editing.invoice_no) : 'draft'}`}
        <button class="btn2 btn2-ghost small" data-action="close-editor">Close</button>
      </h2>

      <div class="pi-fields">
        <div class="pi-field pi-field-wide">
          <div class="pi-label-row">
            <label class="field-label" for="piCustomer">Customer</label>
            <button type="button" class="pi-inline-btn" data-cb="new">+ new</button>
          </div>
          <select class="input" id="piCustomer">
            <option value="">Pick a customer…</option>
            ${customers.map(c => `
              <option value="${escAttr(c.id)}" ${c.id === editing.qb_customer_id ? 'selected' : ''}>
                ${esc(customerLabel(c))}
              </option>`).join('')}
          </select>
        </div>
        <div class="pi-field">
          <label class="field-label" for="piDate">Date</label>
          <input class="input" type="date" id="piDate" value="${escAttr(editing.invoice_date)}">
        </div>
        <div class="pi-field">
          <label class="field-label" for="piPo">PO number <span class="pi-opt">(optional)</span></label>
          <input class="input" type="text" id="piPo" value="${escAttr(editing.po_number)}" placeholder="theirs, not ours">
        </div>
      </div>

      <div class="pi-lines-head">
        <span>What was cut</span>
        <span class="pi-lines-total">Total ${money(total)}</span>
      </div>

      <div class="pi-lines">
        ${editing.lines.map((l, i) => lineHtml(l, i)).join('')}
      </div>

      <button type="button" class="btn2 btn2-ghost small" data-action="add-line">+ Add a line</button>

      <div class="pi-field pi-notes">
        <label class="field-label" for="piNotes">Note on the invoice <span class="pi-opt">(optional)</span></label>
        <input class="input" type="text" id="piNotes" value="${escAttr(editing.notes)}"
               placeholder="Parts cut${editing.po_number ? ' - PO ' + esc(editing.po_number) : ''}">
      </div>

      <div class="pi-editor-actions">
        <button class="btn2 btn2-line" data-action="save">Save draft</button>
        <button class="btn2 btn2-solid" data-action="finish">
          ${editing.status === 'draft' ? `Finish &amp; take ${esc(nextInvoiceNumber || 'a number')}` : 'Save &amp; preview'}
        </button>
        ${editing.id ? '<button class="btn2 btn2-danger small" data-action="delete">Delete</button>' : ''}
        <p class="pi-editor-note">A draft keeps no number. Finishing it takes the next one and opens the invoice so you can look at it before it goes.</p>
      </div>
      <p class="pi-status" id="piStatus"></p>
    </div>`;
}

function lineHtml(l, i) {
  const amount = lineAmount(l);
  return `
    <div class="pi-line" data-line-uid="${escAttr(l.uid)}">
      <div class="pi-line-n">${i + 1}</div>
      <div class="pi-line-fields">
        <input class="input pi-desc" type="text" data-f="description" placeholder="1/2&quot; A36 bracket, laser cut"
               value="${escAttr(l.description)}">
        <div class="pi-line-nums">
          <label class="pi-mini"><span>Qty</span>
            <input class="input" type="number" min="0" step="any" data-f="quantity" value="${escAttr(l.quantity)}"></label>
          <label class="pi-mini"><span>Each</span>
            <input class="input" type="number" min="0" step="0.01" data-f="unit_price" value="${escAttr(l.unit_price)}"></label>
          <label class="pi-mini pi-mini-wide"><span>Books to</span>
            <select class="input" data-f="qb_item_id">
              <option value="">Welding Services</option>
              ${items.map(it => `<option value="${escAttr(it.id)}" ${it.id === l.qb_item_id ? 'selected' : ''}>${esc(it.name)}</option>`).join('')}
            </select></label>
          <span class="pi-line-amt">${money(amount)}</span>
          <button type="button" class="pi-line-x" data-action="remove-line" aria-label="Remove line">&times;</button>
        </div>
      </div>
    </div>`;
}

/* --- saving --------------------------------------------------------------- */

function readEditorFields() {
  const custSel = document.getElementById('piCustomer');
  editing.qb_customer_id = custSel.value;
  const c = customers.find(x => x.id === custSel.value);
  editing.qb_customer_name = c ? (c.fully_qualified_name || c.display_name) : '';
  editing.invoice_date = document.getElementById('piDate').value || todayIso();
  editing.po_number = document.getElementById('piPo').value.trim();
  editing.notes = document.getElementById('piNotes').value.trim();
}

function say(msg, bad) {
  const el = document.getElementById('piStatus');
  if (!el) return;
  el.textContent = msg;
  el.className = 'pi-status' + (bad ? ' pi-err' : ' pi-ok');
}

/** Saves whatever is on screen. `finish` marks it done, which is what spends a
 *  number, so it is deliberately a separate button from Save. */
async function saveEditor(finish) {
  readEditorFields();

  if (!editing.qb_customer_id) { say('Pick a customer first — QuickBooks will not take an invoice without one.', true); return null; }
  const usable = editing.lines.filter(l => l.description.trim() && lineAmount(l) !== 0);
  if (finish && !usable.length) { say('Nothing to bill yet — every line is blank or comes to zero.', true); return null; }

  const head = {
    qb_customer_id: editing.qb_customer_id,
    qb_customer_name: editing.qb_customer_name,
    invoice_date: editing.invoice_date,
    po_number: editing.po_number || null,
    notes: editing.notes || null,
  };
  if (finish) head.status = 'ready';

  let invoiceId = editing.id;
  if (invoiceId) {
    const { error } = await sb.from('parts_invoices').update(head).eq('id', invoiceId);
    if (error) { say('That did not save: ' + error.message, true); return null; }
  } else {
    const { data, error } = await sb.from('parts_invoices')
      .insert({ ...head, created_by: currentUser.id }).select().single();
    if (error) { say('That did not save: ' + error.message, true); return null; }
    invoiceId = data.id;
    editing.id = data.id;
  }

  // Lines are replaced wholesale. They are few, they have no history worth
  // keeping, and matching them up one by one would be more ways to get it wrong.
  const { error: delErr } = await sb.from('parts_invoice_lines').delete().eq('invoice_id', invoiceId);
  if (delErr) { say('Could not rewrite the lines: ' + delErr.message, true); return null; }

  const rows = editing.lines
    .filter(l => l.description.trim())
    .map((l, i) => ({
      invoice_id: invoiceId,
      sort_order: i,
      description: l.description.trim(),
      quantity: Number(l.quantity) || 0,
      unit_price: Number(l.unit_price) || 0,
      qb_item_id: l.qb_item_id || null,
    }));
  if (rows.length) {
    const { error: insErr } = await sb.from('parts_invoice_lines').insert(rows);
    if (insErr) { say('Could not save the lines: ' + insErr.message, true); return null; }
  }

  await loadAll();
  const saved = invoices.find(i => i.id === invoiceId);
  if (saved) {
    editing.status = saved.status;
    editing.invoice_no = saved.invoice_no;
  }
  return invoiceId;
}

async function deleteInvoice() {
  if (!editing || !editing.id) return;
  if (!confirm('Delete this invoice? It has not gone to QuickBooks, so nothing over there changes.')) return;
  const { error } = await sb.from('parts_invoices').delete().eq('id', editing.id);
  if (error) { say('Could not delete it: ' + error.message, true); return; }
  closeEditor();
  await loadAll();
}

/* --- wiring --------------------------------------------------------------- */

document.addEventListener('input', (e) => {
  const lineEl = e.target.closest('[data-line-uid]');
  if (!lineEl || !editing) return;
  const l = editing.lines.find(x => x.uid === lineEl.dataset.lineUid);
  if (!l) return;
  const f = e.target.dataset.f;
  if (!f) return;
  l[f] = (f === 'quantity' || f === 'unit_price') ? e.target.value : e.target.value;

  // Only the arithmetic is redrawn. Redrawing the row would take the cursor
  // out from under him mid-number.
  const amtEl = lineEl.querySelector('.pi-line-amt');
  if (amtEl) amtEl.textContent = money(lineAmount(l));
  const totalEl = document.querySelector('.pi-lines-total');
  if (totalEl) totalEl.textContent = 'Total ' + money(invoiceTotal(editing.lines));
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action], [data-edit], [data-preview]');
  if (!btn) return;

  if (btn.dataset.preview) {
    const inv = invoices.find(i => i.id === btn.dataset.preview);
    InvoicePreview.open({
      partsInvoiceId: btn.dataset.preview,
      name: inv ? inv.qb_customer_name : 'This invoice',
      qbInvoiceId: inv ? inv.qb_invoice_id : null,
      onPushed: loadAll,
    });
    return;
  }
  if (btn.dataset.edit) { startEdit(btn.dataset.edit); return; }

  const action = btn.dataset.action;
  if (action === 'close-editor') { closeEditor(); return; }

  if (action === 'add-line') {
    readEditorFields();
    editing.lines.push(blankLine());
    renderEditor();
    return;
  }
  if (action === 'remove-line') {
    const lineEl = btn.closest('[data-line-uid]');
    readEditorFields();
    editing.lines = editing.lines.filter(x => x.uid !== lineEl.dataset.lineUid);
    if (!editing.lines.length) editing.lines.push(blankLine());
    renderEditor();
    return;
  }
  if (action === 'save') {
    btn.disabled = true;
    const id = await saveEditor(false);
    btn.disabled = false;
    if (id) { say('Saved as a draft. It has taken no invoice number yet.', false); renderEditor(); }
    return;
  }
  if (action === 'finish') {
    btn.disabled = true;
    const id = await saveEditor(true);
    btn.disabled = false;
    if (!id) return;
    closeEditor();
    const inv = invoices.find(i => i.id === id);
    InvoicePreview.open({
      partsInvoiceId: id,
      name: inv ? inv.qb_customer_name : 'This invoice',
      qbInvoiceId: inv ? inv.qb_invoice_id : null,
      onPushed: loadAll,
    });
    return;
  }
  if (action === 'delete') { await deleteInvoice(); return; }
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
  document.getElementById('newInvoiceBtn').addEventListener('click', startNew);

  InvoicePreview.wire();
  // Adding a customer has to redraw the picker, or the one just created is not
  // in the list he created it to use.
  CustomerBook.wire({ onChanged: loadAll });
  await Promise.all([loadAll(), CustomerBook.reload()]);

  await liveData({
    reload: loadAll,
    isBusy: () => editing !== null,
    tables: ['parts_invoices', 'parts_invoice_lines'],
    channel: 'parts-invoice',
  });
})();
