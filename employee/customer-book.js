/* ---------------------------------------------------------------------------
   THE CUSTOMER BOOK
   ---------------------------------------------------------------------------
   Adding a customer, correcting one, and pulling the list back down from
   QuickBooks.

   The invoice screens could only ever offer the customers that happened to be
   in the table the day it was filled. New plate work walks in from somebody who
   has never been billed before, and the only way to invoice them was to go into
   QuickBooks, make the customer there, and come back -- assuming you knew that
   was what the short dropdown was telling you.

   Every write goes through QuickBooks first and only lands here once they have
   taken it. An invoice references a customer by id, so a name typed into the
   portal that does not exist over there is worth nothing: it would be picked,
   saved, previewed, and refused at the last step.

   WHERE THE INVOICE GETS EMAILED
   ------------------------------
   QuickBooks keeps one address on the customer and has nowhere at all to keep
   carbon copies. Rocking Double S wants an AP address plus three copies on
   every invoice, which is four addresses retyped for each one. So the address
   is written to QuickBooks and the copies are kept here, and the push sets both
   on the invoice itself -- the send window opens filled in.

   SUB-CUSTOMERS
   -------------
   A customer can hang under another one: a job site or a project, billed with
   its parent. Those are shown under the name they are filed under rather than
   their own, because flat in a list they look exactly like a company.
--------------------------------------------------------------------------- */

const CustomerBook = (function () {
  const FN_URL = `${SUPABASE_URL}/functions/v1/qb-customers`;

  let rows = [];             // every customer, active or not
  let onChanged = null;      // the page's reload, when the book changes
  let editingId = null;      // the customer open in the sheet, or null for new
  let busy = false;

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
  }
  const escAttr = (s) => esc(s).replace(/"/g, '&quot;');

  async function call(body) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error('Your session expired. Log in again.');
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { res, json };
  }

  /** The name to read a customer by. A job site reads under its parent. */
  function label(c) {
    if (c.is_sub_customer && c.fully_qualified_name) {
      return c.fully_qualified_name.split(':').join(' › ') + '  (job site)';
    }
    return c.display_name +
      (c.company_name && c.company_name !== c.display_name ? ' — ' + c.company_name : '');
  }

  /* --- the list ----------------------------------------------------------- */

  function render() {
    const host = document.getElementById('customerBook');
    if (!host) return;

    const live = rows.filter(c => c.active);
    const noEmail = live.filter(c => !(c.bill_email || '').trim()).length;

    host.innerHTML = `
      <div class="card">
        <h2 class="card-h">
          Customers
          <span class="cb-actions">
            <button type="button" class="btn2 btn2-ghost small" data-cb="sync">Refresh from QuickBooks</button>
            <button type="button" class="btn2 btn2-solid small" data-cb="new">+ Add customer</button>
          </span>
        </h2>

        <p class="cb-intro">
          These are your QuickBooks customers. An invoice goes to the address on
          the customer, with the copies underneath it.
          ${noEmail
            ? `<b class="cb-warn">${noEmail} ${noEmail === 1 ? 'has' : 'have'} no address</b> — an invoice to ${noEmail === 1 ? 'that one' : 'those'} has nowhere to go.`
            : `Every one of them has an address.`}
        </p>

        <div class="cb-status" id="cbStatus"></div>

        <ul class="entry-list2 cb-list">
          ${live.length ? live.map(rowHtml).join('') : '<li class="empty-state2">No customers yet.</li>'}
        </ul>
      </div>`;
  }

  function rowHtml(c) {
    const email = (c.bill_email || '').trim();
    const cc = (c.bill_email_cc || '').trim();
    return `
      <li class="cb-row" data-cb="edit" data-id="${escAttr(c.id)}" tabindex="0" role="button">
        <div class="cb-name">${esc(label(c))}</div>
        <div class="cb-mail">
          ${email
            ? esc(email) + (cc ? `<span class="cb-cc"> + cc ${esc(cc)}</span>` : '')
            : '<span class="cb-none">no address</span>'}
        </div>
        <span class="cb-go" aria-hidden="true">&rsaquo;</span>
      </li>`;
  }

  function status(msg, bad) {
    const el = document.getElementById('cbStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'cb-status' + (msg ? (bad ? ' cb-err' : ' cb-ok') : '');
  }

  /* --- the sheet ---------------------------------------------------------- */

  function openSheet(id) {
    editingId = id || null;
    const c = id ? rows.find(x => x.id === id) : null;
    const sheet = document.getElementById('cbSheet');
    const body = document.getElementById('cbSheetBody');
    if (!sheet || !body) return;

    body.innerHTML = `
      <h3 class="cb-h">${c ? 'Edit ' + esc(c.display_name) : 'Add a customer'}</h3>
      <p class="cb-sub">
        ${c
          ? 'Saved to QuickBooks. A new name shows on every invoice ever raised against them, including ones already sent.'
          : 'Created in QuickBooks, so it can be invoiced straight away.'}
      </p>

      <div class="cb-fields">
        <div class="cb-field">
          <label class="field-label" for="cbName">Name</label>
          <input class="input" id="cbName" type="text" value="${escAttr(c ? c.display_name : '')}"
                 placeholder="what you call them" autocomplete="off">
        </div>
        <div class="cb-field">
          <label class="field-label" for="cbCompany">Company <span class="pi-opt">(if different)</span></label>
          <input class="input" id="cbCompany" type="text" value="${escAttr(c ? (c.company_name || '') : '')}"
                 placeholder="their legal name" autocomplete="off">
        </div>
        <div class="cb-field cb-field-wide">
          <label class="field-label" for="cbEmail">Where the invoice goes</label>
          <input class="input" id="cbEmail" type="email" value="${escAttr(c ? (c.bill_email || '') : '')}"
                 placeholder="ap@theircompany.com" autocomplete="off">
        </div>
        <div class="cb-field cb-field-wide">
          <label class="field-label" for="cbCc">Copies <span class="pi-opt">(commas between them)</span></label>
          <input class="input" id="cbCc" type="text" value="${escAttr(c ? (c.bill_email_cc || '') : '')}"
                 placeholder="foreman@theirs.com, super@theirs.com" autocomplete="off">
          <div class="cb-hint">QuickBooks has nowhere to keep these, so they are kept here and set on each invoice as it is sent.</div>
        </div>
        <div class="cb-field">
          <label class="field-label" for="cbPhone">Phone <span class="pi-opt">(optional)</span></label>
          <input class="input" id="cbPhone" type="tel" value="" placeholder="(432) 555-0100" autocomplete="off">
        </div>
      </div>

      <div class="cb-sheet-status" id="cbSheetStatus"></div>

      <div class="cb-sheet-btns">
        <button type="button" class="btn2 btn2-ghost" data-cb="cancel">Cancel</button>
        <button type="button" class="btn2 btn2-solid" data-cb="save">
          ${c ? 'Save to QuickBooks' : 'Create in QuickBooks'}
        </button>
      </div>`;

    sheet.hidden = false;
    const first = document.getElementById('cbName');
    if (first) first.focus();
  }

  function closeSheet() {
    const sheet = document.getElementById('cbSheet');
    if (sheet) sheet.hidden = true;
    editingId = null;
  }

  function sheetStatus(msg, bad) {
    const el = document.getElementById('cbSheetStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'cb-sheet-status' + (msg ? (bad ? ' cb-err' : ' cb-ok') : '');
  }

  /* --- writing ------------------------------------------------------------ */

  async function save() {
    if (busy) return;
    const name = document.getElementById('cbName').value.trim();
    const company = document.getElementById('cbCompany').value.trim();
    const email = document.getElementById('cbEmail').value.trim();
    const cc = document.getElementById('cbCc').value.trim();
    const phone = document.getElementById('cbPhone').value.trim();

    if (!name) { sheetStatus('A customer needs a name.', true); return; }

    // Caught here rather than by QuickBooks, which refuses the whole write for
    // one bad address and says so in language nobody wants to read.
    const bad = [email].concat(cc.split(','))
      .map(s => s.trim()).filter(Boolean)
      .filter(a => !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(a));
    if (bad.length) { sheetStatus(`That is not an email address: ${bad[0]}`, true); return; }

    busy = true;
    sheetStatus(editingId ? 'Saving to QuickBooks…' : 'Creating in QuickBooks…', false);

    const { res, json } = await call(editingId
      ? { action: 'update', id: editingId, display_name: name, company_name: company, email, email_cc: cc, phone }
      : { action: 'create', display_name: name, company_name: company, email, email_cc: cc, phone });

    busy = false;

    if (!res.ok || !json.ok) {
      sheetStatus(json.error || `QuickBooks would not take that (${res.status}).`, true);
      return;
    }

    closeSheet();
    await reload();
    status(editingId ? 'Saved.' : `${name} is in QuickBooks and ready to invoice.`, false);
    if (onChanged) await onChanged();
  }

  async function sync() {
    if (busy) return;
    busy = true;
    status('Asking QuickBooks for the list…', false);
    const { res, json } = await call({ action: 'sync' });
    busy = false;
    if (!res.ok || !json.ok) {
      status(json.error || `Could not reach QuickBooks (${res.status}).`, true);
      return;
    }
    await reload();
    status(`${json.customers} customers, straight from QuickBooks.`, false);
    if (onChanged) await onChanged();
  }

  async function reload() {
    const { data, error } = await sb.from('qb_customers')
      .select('*').order('display_name');
    // A failed read must never look like an empty book.
    if (error) { status('Could not read the customer list: ' + error.message, true); return; }
    rows = data || [];
    render();
  }

  /* --- wiring ------------------------------------------------------------- */

  function wire(opts) {
    onChanged = (opts && opts.onChanged) || null;

    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-cb-close]')) { closeSheet(); return; }
      const el = e.target.closest('[data-cb]');
      if (!el) return;
      const what = el.dataset.cb;
      if (what === 'new') { openSheet(null); return; }
      if (what === 'edit') { openSheet(el.dataset.id); return; }
      if (what === 'cancel') { closeSheet(); return; }
      if (what === 'save') { save(); return; }
      if (what === 'sync') { sync(); return; }
    });

    // A row is a button, so it answers to the keyboard like one.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeSheet(); return; }
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const row = e.target.closest('.cb-row');
      if (!row) return;
      e.preventDefault();
      openSheet(row.dataset.id);
    });
  }

  return { wire, reload, label, open: openSheet, all: () => rows };
})();
