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
let newCustomer = null;      // the customer being added, while that form is open
let nextInvoiceNumber = '';

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
function escAttr(str) { return esc(str).replace(/"/g, '&quot;'); }
function uid() { return Math.random().toString(36).slice(2); }
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

  // The item and customer lists are copies of QuickBooks'. Nothing used to
  // refresh them, so an item added over there never appeared here -- which is
  // how "Gas & consumables" was missing from this screen for three days.
  refreshQuickBooksLists();

  // Our counter first so the page draws straight away, then QuickBooks. An
  // invoice entered over there without us leaves our counter behind, and the
  // number on the button would be one a customer already has. Not awaited:
  // the list is worth showing while QuickBooks is being asked.
  refreshNextInvoiceNo();
}

/* Pulls QuickBooks' item and customer lists down again.

   Quiet and unawaited on a normal page load: the screen is already usable from
   the copies we have, and the throttle in the function means opening this page
   five times running costs QuickBooks one round trip. `force` is the button,
   for when something was added over there thirty seconds ago. */
async function refreshQuickBooksLists(force) {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return null;

    const res = await fetch(PUSH_FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ action: 'sync_lists', force: Boolean(force) }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out.ok) throw new Error(out.error || `QuickBooks would not answer (${res.status})`);
    if (out.skipped) return out;

    // Only redraw if the lists actually moved. A silent re-render under
    // somebody mid-way through typing a line is its own kind of rude.
    const [itemRes, custRes] = await Promise.all([
      sb.from('qb_items').select('*').eq('active', true).order('name'),
      sb.from('qb_customers').select('*').eq('active', true).order('display_name'),
    ]);
    const changed =
      (!itemRes.error && (itemRes.data || []).length !== items.length) ||
      (!custRes.error && (custRes.data || []).length !== customers.length);

    if (!itemRes.error) items = itemRes.data || [];
    if (!custRes.error) customers = custRes.data || [];
    if (changed) { renderList(); if (editing) renderEditor(); }
    return out;
  } catch (err) {
    console.warn('Could not refresh the QuickBooks lists', err);
    return null;
  }
}

/* Re-asks what the next number is and redraws whatever is showing it. Quiet on
   failure -- syncNextInvoiceNo falls back to our own counter, which is what was
   on screen already. */
async function refreshNextInvoiceNo() {
  const fresh = await syncNextInvoiceNo();
  if (!fresh || fresh === nextInvoiceNumber) return;
  nextInvoiceNumber = fresh;
  renderList();
  if (editing) renderEditor();
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
    el.innerHTML = '<li class="empty-state2">No parts and services invoices yet. Start one with the button above.</li>';
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
          ${inv.qb_invoice_id && inv.invoice_pdf_error ? `
            <div class="pi-row-warn">The letterhead invoice is not attached in QuickBooks.
              Do not send it until it is.
              <button class="btn2 btn2-line small" data-attach="${escAttr(inv.id)}">Attach it</button>
              <span class="pi-row-why">${esc(inv.invoice_pdf_error)}</span></div>` : ''}
        </div>
        <div class="pi-row-side">
          <div class="pi-row-total">${money(total)}</div>
          <div class="pi-row-btns">
            <button class="btn2 btn2-line small" data-preview="${escAttr(inv.id)}">Preview</button>
            <button class="btn2 btn2-ghost small" data-pdf="${escAttr(inv.id)}">Invoice PDF</button>
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
  newCustomer = null;
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
  newCustomer = null;
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
  newCustomer = null;
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
        ${isNew ? 'New Parts and Services Invoice' : `Invoice ${editing.invoice_no ? '#' + esc(editing.invoice_no) : 'draft'}`}
        <button class="btn2 btn2-ghost small" data-action="close-editor">Close</button>
      </h2>

      <div class="pi-drop" id="piDrop" tabindex="0" role="button"
           aria-label="Drop a PDF here to fill this invoice in">
        <span class="pi-drop-main">Drop a PDF here to fill this in</span>
        <span class="pi-drop-sub">A quote off the desk, a customer's purchase order, a cut list off the laser.
          Everything it reads lands in the boxes below for you to check \u2014 nothing is saved.</span>
        <input type="file" id="piPdf" accept="application/pdf,.pdf" hidden>
      </div>
      <p class="pi-drop-status" id="piDropStatus"></p>

      <div class="pi-fields">
        <div class="pi-field pi-field-wide">
          <label class="field-label" for="piCustomer">Customer</label>
          <div class="pi-cust-row">
            <select class="input" id="piCustomer">
              <option value="">Pick a customer…</option>
              ${customers.map(c => `
                <option value="${escAttr(c.id)}" ${c.id === editing.qb_customer_id ? 'selected' : ''}>
                  ${esc(c.display_name)}${c.company_name && c.company_name !== c.display_name ? ' — ' + esc(c.company_name) : ''}
                </option>`).join('')}
            </select>
            <button type="button" class="btn2 btn2-ghost small" data-action="new-customer"
                    ${newCustomer ? 'disabled' : ''}>+ New customer</button>
          </div>
          ${newCustomer ? newCustomerHtml() : ''}
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
        <button type="button" class="btn2 btn2-ghost small pi-refresh" data-action="refresh-lists"
                title="Pulls the item and customer lists down from QuickBooks again. Use it if something you just added over there is not in the list yet.">Refresh from QuickBooks</button>
        <span class="pi-lines-total">Total ${money(total)}</span>
      </div>

      <div class="pi-lines">
        ${editing.lines.map((l, i) => lineHtml(l, i)).join('')}
      </div>

      <button type="button" class="btn2 btn2-ghost small" data-action="add-line">+ Add a line</button>

      <div class="pi-field pi-notes">
        <label class="field-label" for="piNotes">Note on the invoice <span class="pi-opt">(optional)</span></label>
        <input class="input" type="text" id="piNotes" value="${escAttr(editing.notes)}"
               placeholder="Parts and Services${editing.po_number ? ' - PO ' + esc(editing.po_number) : ''}">
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

  wireDropZone();
}

/* ---------------------------------------------------------------------------
   FILLING THE FORM FROM A PDF
   ---------------------------------------------------------------------------
   The same job arrives written down three ways -- a quote this portal printed,
   a purchase order on the customer's letterhead, a cut list out of the laser
   software -- and all three were being retyped by hand into this form.

   Drop one here and it gets read. What comes back lands in the boxes and stops
   there: nothing is saved, no number is taken, and every figure is sitting in
   a field that can be changed. A machine reading somebody else's paperwork
   will be wrong sometimes, and a customer's invoice is the wrong place to find
   that out.
*/
const PARSE_URL = `${SUPABASE_URL}/functions/v1/parse-parts-pdf`;
const INVOICE_PDF_URL = `${SUPABASE_URL}/functions/v1/qb-invoice-pdf`;

function wireDropZone() {
  const zone = document.getElementById('piDrop');
  const input = document.getElementById('piPdf');
  if (!zone || !input) return;

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
  });
  input.addEventListener('change', () => {
    if (input.files && input.files[0]) readPdf(input.files[0]);
    input.value = '';                       // so the same file can be dropped twice
  });

  // Without preventDefault on dragover the browser navigates away to the PDF,
  // which loses whatever is typed in the form.
  ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, (e) => {
    e.preventDefault(); zone.classList.add('is-over');
  }));
  ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, (e) => {
    e.preventDefault(); zone.classList.remove('is-over');
  }));
  zone.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) readPdf(f);
  });
}

function dropSay(msg, kind) {
  const el = document.getElementById('piDropStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'pi-drop-status' + (kind ? ' pi-drop-' + kind : '');
}

/* Reads the file as base64 without pulling the whole thing through a string
   one character at a time -- a 5 MB PDF does that 5 million times. */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const out = String(r.result || '');
      const comma = out.indexOf(',');
      resolve(comma >= 0 ? out.slice(comma + 1) : out);
    };
    r.onerror = () => reject(new Error('that file could not be opened'));
    r.readAsDataURL(file);
  });
}

async function readPdf(file) {
  if (!/pdf$/i.test(file.name) && file.type !== 'application/pdf') {
    dropSay('That is not a PDF. Only PDFs can be read.', 'err');
    return;
  }
  const zone = document.getElementById('piDrop');
  if (zone) zone.classList.add('is-busy');
  dropSay('Reading ' + file.name + '\u2026');

  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error('you are signed out \u2014 sign in and try again');

    const res = await fetch(PARSE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ filename: file.name, pdf_base64: await fileToBase64(file) }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out.ok) throw new Error(out.detail || out.error || `that PDF could not be read (${res.status})`);

    applyParsed(out, file.name);
  } catch (err) {
    dropSay(err.message || 'That PDF could not be read.', 'err');
  } finally {
    if (zone) zone.classList.remove('is-busy');
  }
}

/* Everything read goes in. Nothing already typed gets thrown away silently:
   a field the office has filled in stays as it is, because the person is a
   better source than the document. */
function applyParsed(out, filename) {
  readEditorFields();
  const notes = [];

  if (out.document_date && /^\d{4}-\d{2}-\d{2}$/.test(out.document_date)) {
    editing.invoice_date = out.document_date;
  }
  if (out.po_number && !editing.po_number) editing.po_number = String(out.po_number);
  if (out.notes && !editing.notes) editing.notes = String(out.notes);

  // The customer has to match one QuickBooks already knows, because the push
  // sends an id and not a name. A near miss is reported rather than guessed at.
  if (out.customer_name && !editing.qb_customer_id) {
    const want = String(out.customer_name).trim().toLowerCase();
    const hit = customers.find(c =>
      String(c.display_name || '').trim().toLowerCase() === want ||
      String(c.company_name || '').trim().toLowerCase() === want);
    if (hit) {
      editing.qb_customer_id = hit.id;
      editing.qb_customer_name = hit.display_name;
    } else {
      notes.push(`it says "${out.customer_name}", which is not on your customer list \u2014 pick one, or add them`);
    }
  }

  const lines = Array.isArray(out.lines) ? out.lines : [];
  if (lines.length) {
    // A form holding nothing but the one blank line it opens with is empty,
    // and replacing that is not losing anybody's work.
    const typed = editing.lines.filter(l => String(l.description || '').trim());
    const fresh = lines.map(l => ({
      uid: uid(),
      description: String(l.description || ''),
      quantity: Number(l.quantity) || 0,
      unit_price: Number(l.unit_price) || 0,
      qb_item_id: '',
    }));
    // Lines that arrive off a spreadsheet are never typed, so the change
    // handler never sees them. Book them here or they all land on the default.
    const booked = fresh.filter(l => bookLine(l)).length;
    if (booked) {
      notes.push(booked === fresh.length
        ? 'every line booked to an item off its description'
        : `${booked} of ${fresh.length} lines booked to an item off the description`);
    }
    editing.lines = typed.length ? typed.concat(fresh) : fresh;
    if (typed.length) notes.push(`${fresh.length} line${fresh.length === 1 ? '' : 's'} added under what you already had`);
  } else {
    notes.push('no billable lines were found on it');
  }

  if (lines.length && lines.every(l => !Number(l.unit_price))) {
    notes.push('it carried no prices, so every line is at zero');
  }

  renderEditor();
  // What that read cost, said out loud. It is pennies, but it is the one thing
  // in this portal that is billed by use, and a number nobody sees is a number
  // that surprises somebody later.
  const cost = Number(out.cost_usd);
  const price = Number.isFinite(cost) && cost > 0
    ? ` (read for ${cost < 0.01 ? 'under a cent' : '$' + cost.toFixed(2)})` : '';
  const head = `Filled in from ${filename}${price}. Check it before you finish the invoice`;
  dropSay(notes.length ? `${head} \u2014 ${notes.join('; ')}.` : head + '.',
          notes.length ? 'warn' : 'ok');
}

/* --- which item a line books to ------------------------------------------
   Left alone, every line goes out under Welding Services, because that is the
   fallback when nothing is picked. Laser work filed as welding is not wrong on
   the invoice -- the customer only ever reads the description -- but it is
   wrong on the P&L, and nobody notices for a year.

   So the description is read and the item guessed. A guess, not a rule: it
   only ever fills a box that is still empty, it shows on screen in the same
   dropdown he could have used himself, and he can change it before the invoice
   goes anywhere.

   Matched on the item's NAME rather than its QuickBooks id. An id is a number
   in somebody else's system; if one changes or an item is retired, the lookup
   comes back empty and the line falls back to what it does today, which is the
   behaviour we already live with rather than a wrong account.

   Order matters: the first rule that matches wins, and several of these words
   turn up in the same line. The two laser rules go first because a line that
   names the laser is laser work whatever else it mentions -- a bracket cut and
   bevelled ready to weld is still the laser's. "Welding truck" and "welder's
   helper" are the truck and the helper, so those come above welding too.
   Welding is matched WITHOUT a leading word boundary, because "reweld" is
   welding and \bweld would walk straight past it onto the flange behind. */
const ITEM_HINTS = [
  ['Tube laser cutting',          /\btube laser\b|\bsch\s*\d|cut to length/],
  ['Fiber laser - plate cutting', /\blaser\b|\bblind\b|\bplate\b|\bshim|\bbracket|\bgusset|\bsign\b/],
  ['Helper - hourly',             /\bhelper\b/],
  ['Truck & rig',                 /\btruck\b|\brig\b/],
  ['Welder - hourly',             /weld/],
  ['Setup & programming',         /\bprogram|\bset-?up\b|first article/],
  ['Per diem - billed',           /\bper ?diem\b/],
  ['Mileage',                     /\bmileage\b|\bmiles\b/],
  ['Freight & delivery',          /\bhot ?shot\b|\bfreight\b|\bdelivery\b|\bhaul/],
  ['Gas & consumables',           /\bconsumable|assist gas/],
  ['Bench & fit-up',              /\bbench\b|\bfit-?up\b/],
  ['Material',                    /\bflange\b|\bmtr\b|\bmaterial\b|\bheat\s+\w*\d/],
];

/** The item this description reads like, or '' when nothing fits. */
function suggestItemId(description) {
  const text = String(description || '').toLowerCase();
  if (!text.trim()) return '';
  for (const [name, when] of ITEM_HINTS) {
    if (!when.test(text)) continue;
    const hit = items.find(it => it.name === name);
    if (hit) return hit.id;          // an item we do not have is not a guess
  }
  return '';
}

/** Fills a line's item when it has none. Answers with the item's name when it
 *  filled one, so the caller can say so, and '' when it left things alone. */
function bookLine(l) {
  if (!l || (l.qb_item_id || '').trim()) return '';
  const id = suggestItemId(l.description);
  if (!id) return '';
  l.qb_item_id = id;
  const hit = items.find(it => it.id === id);
  return hit ? hit.name : '';
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


/* --- adding a customer ----------------------------------------------------
   The list is a copy of what QuickBooks knows. Adding to the copy alone would
   put a name on an invoice that QuickBooks has never heard of, and it would be
   rejected on the way out -- after the invoice number had been spent. So the
   new customer is created over there first, and the list follows.            */

function newCustomerHtml() {
  return `
    <div class="pi-newcust">
      <div class="pi-newcust-fields">
        <label class="pi-mini pi-mini-wide"><span>Name on the invoice</span>
          <input class="input" type="text" data-nc="display_name" id="piNcName"
                 maxlength="100" placeholder="Permian Tank &amp; Manufacturing"
                 value="${escAttr(newCustomer.display_name)}"></label>
        <label class="pi-mini pi-mini-wide"><span>Company <span class="pi-opt">(if different)</span></span>
          <input class="input" type="text" data-nc="company_name"
                 value="${escAttr(newCustomer.company_name)}"></label>
        <label class="pi-mini pi-mini-wide"><span>Email <span class="pi-opt">(optional)</span></span>
          <input class="input" type="email" data-nc="email" placeholder="ap@theircompany.com"
                 value="${escAttr(newCustomer.email)}"></label>
      </div>
      <div class="pi-newcust-actions">
        <button type="button" class="btn2 btn2-line small" data-action="save-customer">Add customer</button>
        <button type="button" class="btn2 btn2-ghost small" data-action="cancel-customer">Cancel</button>
      </div>
      <p class="pi-newcust-note" id="piNcNote">
        This adds them to QuickBooks too, so the invoice can go out under the name.
        If QuickBooks already has them, they are picked up rather than added twice.
      </p>
    </div>`;
}

function ncNote(msg, bad) {
  const el = document.getElementById('piNcNote');
  if (!el) return;
  el.textContent = msg;
  el.className = 'pi-newcust-note' + (bad ? ' pi-err' : ' pi-ok');
}

async function saveCustomer(btn) {
  const name = (newCustomer.display_name || '').trim();
  if (!name) { ncNote('Give the customer a name first.', true); return; }

  const { data: { session } } = await sb.auth.getSession();
  if (!session) { ncNote('Your session expired. Log in again.', true); return; }

  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Adding…';
  ncNote('Asking QuickBooks…', false);

  try {
    const res = await fetch(PUSH_FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({
        action: 'create_customer',
        display_name: name,
        company_name: (newCustomer.company_name || '').trim(),
        email: (newCustomer.email || '').trim(),
      }),
    });
    const out = await res.json().catch(() => ({}));

    if (!res.ok || !out.ok) {
      ncNote(out.error || 'QuickBooks would not add that customer.', true);
      return;
    }

    // Straight into the list rather than a reload: the invoice on screen is
    // half-written, and reloading would take it away to save a round trip.
    const c = out.customer;
    const already = customers.findIndex(x => x.id === c.id);
    if (already >= 0) customers[already] = c; else customers.push(c);
    customers.sort((a, b) => a.display_name.localeCompare(b.display_name));

    readEditorFields();
    editing.qb_customer_id = c.id;
    editing.qb_customer_name = c.display_name;
    newCustomer = null;
    renderEditor();
    say(out.created
      ? `Added ${c.display_name} to QuickBooks and picked them for this invoice.`
      : `QuickBooks already had ${c.display_name} — picked them for this invoice.`, false);
  } catch (err) {
    ncNote('Could not reach QuickBooks: ' + (err && err.message ? err.message : err), true);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

/* --- saving --------------------------------------------------------------- */

function readEditorFields() {
  const custSel = document.getElementById('piCustomer');
  editing.qb_customer_id = custSel.value;
  const c = customers.find(x => x.id === custSel.value);
  editing.qb_customer_name = c ? c.display_name : '';
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
  if (e.target.dataset && e.target.dataset.nc && newCustomer) {
    newCustomer[e.target.dataset.nc] = e.target.value;
    return;
  }

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

/* The guess runs on change rather than input: on every keystroke it would be
   guessing from half a word, and the dropdown would flicker under him while he
   is still typing the line. On change he has finished the description and
   moved on, which is the moment the answer is worth having. */
document.addEventListener('change', (e) => {
  if (!e.target.dataset || e.target.dataset.f !== 'description') return;
  const lineEl = e.target.closest('[data-line-uid]');
  if (!lineEl || !editing) return;
  const l = editing.lines.find(x => x.uid === lineEl.dataset.lineUid);
  if (!l) return;

  const booked = bookLine(l);
  if (!booked) return;

  // Move the dropdown he can see, not a hidden field. Redrawing the whole row
  // would take the cursor with it.
  const sel = lineEl.querySelector('[data-f="qb_item_id"]');
  if (sel) sel.value = l.qb_item_id;
  say(`Line ${editing.lines.indexOf(l) + 1} books to ${booked}. `
    + 'Change it under "Books to" if that is not where it belongs.', false);
});

/* The invoice on our own letterhead: every line, the quantity, the unit and
   what it came to, with the scope and the terms blocks underneath. QuickBooks
   sends its own invoice and that stays the bill of record -- this is the one a
   customer can actually check the work against.

   The function answers with PDF bytes, so the response is turned into a blob
   and handed to the browser rather than navigated to: a plain link would drop
   the Authorization header and come back a 401. */
async function downloadInvoicePdf(btn) {
  const id = btn.dataset.pdf;
  const was = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Drawing...';
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error('signed out -- sign in again');
    const res = await fetch(INVOICE_PDF_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ parts_invoice_id: id }),
    });
    if (!res.ok) {
      const why = await res.json().catch(() => ({}));
      throw new Error(why.error || `the invoice could not be drawn (${res.status})`);
    }
    const blob = await res.blob();
    const name = (res.headers.get('content-disposition') || '')
      .match(/filename="([^"]+)"/)?.[1] || `invoice-${id}.pdf`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Freed on the next tick rather than immediately: revoking while the click
    // is still being handled cancels the download in Safari.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (err) {
    alert(err.message || String(err));
  } finally {
    btn.disabled = false;
    btn.textContent = was;
  }
}

/* Putting the letterhead invoice on the QuickBooks invoice after an attach that
   did not land. It normally happens by itself the moment the push succeeds; this
   is the way back when it did not. */
async function attachInvoicePdf(btn) {
  const id = btn.dataset.attach;
  const was = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Attaching...';
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error('signed out -- sign in again');
    const res = await fetch(INVOICE_PDF_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ parts_invoice_id: id, attach: true }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out.ok) throw new Error(out.error || `it did not attach (${res.status})`);
    await loadAll();
  } catch (err) {
    alert(err.message || String(err));
    btn.disabled = false;
    btn.textContent = was;
  }
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action], [data-edit], [data-preview], [data-pdf], [data-attach]');
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
  if (btn.dataset.pdf) { downloadInvoicePdf(btn); return; }
  if (btn.dataset.attach) { attachInvoicePdf(btn); return; }
  if (btn.dataset.edit) { startEdit(btn.dataset.edit); return; }

  const action = btn.dataset.action;
  if (action === 'close-editor') { closeEditor(); return; }

  if (action === 'new-customer') {
    readEditorFields();
    newCustomer = { display_name: '', company_name: '', email: '' };
    renderEditor();
    const el = document.getElementById('piNcName');
    if (el) el.focus();
    return;
  }
  if (action === 'cancel-customer') {
    readEditorFields();
    newCustomer = null;
    renderEditor();
    return;
  }
  if (action === 'save-customer') { await saveCustomer(btn); return; }

  if (action === 'refresh-lists') {
    readEditorFields();
    btn.disabled = true;
    const was = btn.textContent;
    btn.textContent = 'Refreshing\u2026';
    const out = await refreshQuickBooksLists(true);
    btn.disabled = false; btn.textContent = was;
    say(out && out.ok
      ? `Lists refreshed \u2014 ${out.items_active} items and ${out.customers_active} customers from QuickBooks.`
      : 'QuickBooks could not be reached. The lists are unchanged.', !(out && out.ok));
    return;
  }

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
    // Finishing is what spends the number: a Postgres trigger reads the counter
    // as the row goes from draft to ready. So the counter has to be past
    // anything QuickBooks has issued BEFORE the save, not after -- once the
    // trigger has taken a number, that number is spent whether or not it
    // collides. This is the one call worth waiting on.
    if (editing && editing.status === 'draft') await refreshNextInvoiceNo();
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
  await loadAll();

  await liveData({
    reload: loadAll,
    isBusy: () => editing !== null,
    tables: ['parts_invoices', 'parts_invoice_lines'],
    channel: 'parts-invoice',
  });
})();
