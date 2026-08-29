/* Quote Desk — the portal's half.
 *
 * quotes-desk.js is the drop-in module and boots itself the moment it loads.
 * It reads two globals as it does: where to keep its data, and where to get a
 * number from. Both are installed here, which is why this file is loaded first.
 *
 * The module is deliberately left knowing nothing about Supabase, auth or the
 * invoice counter. It asks; this answers.
 */

const QUOTE_STATE_ID = 1;

let deskProfile = null;

async function requireAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return null; }
  return session.user;
}

/* Auth resolves after the module has already asked for its data, so the answer
   is a promise everything else waits on rather than a value. */
const adminReady = (async () => {
  const user = await requireAuth();
  if (!user) return null;

  const { data: profile } = await sb.from('profiles').select('*').eq('id', user.id).single();
  deskProfile = profile;

  document.getElementById('userName').textContent =
    profile ? profile.full_name : user.email;
  document.getElementById('loadingMsg').style.display = 'none';

  if (!profile || profile.role !== 'admin') {
    document.getElementById('notAdminMsg').style.display = 'block';
    return null;
  }

  document.getElementById('adminContent').style.display = 'block';
  return profile;
})();

/* ---------------- storage ----------------
   The module hands over its whole state and asks for it back the same way, so
   that is exactly what is stored: one row, one JSON document. A write that
   fails must not look like it worked -- the desk keeps what is on screen, and
   the office is told the save did not land. */

let lastSavedJson = null;
let saveInFlight = null;

window.SOTA_QD_STORAGE = {
  load: async function () {
    const profile = await adminReady;
    if (!profile) throw new Error('not an admin');

    const { data, error } = await sb
      .from('quote_desk_state').select('state').eq('id', QUOTE_STATE_ID).single();

    if (error) {
      // An empty desk would look like the quotes had been lost, so say so
      // instead of booting a blank one over the top of real data.
      deskWarn('Could not load the quote desk: ' + error.message);
      throw error;
    }

    const hints = await numberingHints();
    const state = data && data.state && Object.keys(data.state).length ? data.state : null;

    // A desk with nothing saved yet still gets the hints, so the next numbers
    // show from the very first quote rather than only after one is written.
    if (!state) return { settings: hints };

    state.settings = Object.assign({}, state.settings, hints);
    return state;
  },

  save: async function (state) {
    const profile = await adminReady;
    if (!profile) return;

    // The desk saves on every keystroke. Writing the whole document each time
    // is fine, but writing an identical one is not worth a round trip.
    const json = JSON.stringify(state);
    if (json === lastSavedJson) return;
    lastSavedJson = json;

    // Keep writes in order: a slow save must not land on top of a later one.
    saveInFlight = (saveInFlight || Promise.resolve()).then(async () => {
      const { error } = await sb.from('quote_desk_state')
        .update({ state: state, updated_at: new Date().toISOString(), updated_by: profile.id })
        .eq('id', QUOTE_STATE_ID);
      if (error) {
        lastSavedJson = null;                 // let the next attempt try again
        deskWarn('Quote not saved: ' + error.message);
      }
    });
    return saveInFlight;
  }
};

/* ---------------- numbering ----------------
   Two series, neither of them the module's to invent.

   A quote is numbered by the day it was written, SOTA-MM-DD-YYYY-NN, counted
   within that date. An invoice carries on the same run as the field tickets,
   taken from the counter the approved weeks already draw from, so the two can
   never land on the same number. Both are handed out by Postgres, where the
   counter can be locked; two people saving at the same instant queue rather
   than both taking the same number. */

window.SOTA_QD_NUMBERS = {
  quote: async function () {
    const { data, error } = await sb.rpc('take_quote_no');
    if (error) throw new Error(error.message);
    return data;
  },
  invoice: async function () {
    const { data, error } = await sb.rpc('take_desk_invoice_no');
    if (error) throw new Error(error.message);
    return data;
  }
};

/* What the next numbers would be, for the desk to show without spending them. */
async function numberingHints() {
  try {
    // The invoice number goes via syncNextInvoiceNo rather than peek_invoice_no:
    // it asks QuickBooks whether anything has been numbered over there without
    // us and shoves the shared counter past it. Quote numbers are ours alone --
    // QuickBooks has never heard of them -- so peek is the whole story there.
    const [{ data: q }, inv] = await Promise.all([
      sb.rpc('peek_quote_no'),
      syncNextInvoiceNo()
    ]);
    return { nextQuoteNo: q || '', nextInvoiceNo: inv || '' };
  } catch (err) {
    return {};                                 // a missing hint is not worth failing over
  }
}

/* A save that silently failed is the worst outcome here, so failures are said
   out loud rather than logged. */
function deskWarn(msg) {
  let bar = document.getElementById('deskWarn');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'deskWarn';
    bar.setAttribute('role', 'alert');
    bar.style.cssText =
      'position:fixed;left:0;right:0;top:0;z-index:9999;padding:10px 16px;text-align:center;' +
      'background:#A87C74;color:#120806;font:600 13px/1.4 system-ui,-apple-system,sans-serif';
    document.body.appendChild(bar);
  }
  bar.textContent = msg;
}


/* ---------------- QuickBooks ----------------
   Converting a quote writes an invoice row as well as the desk's own copy. The
   desk's JSON is its working state; the row is what the books see, and it is
   what the push reads. The browser never sends figures to QuickBooks -- it
   names a row, and the database works out the money, exactly as a job week and
   a parts invoice already do.

   The row is written once per document. Converting the same quote twice, or
   re-saving an invoice, updates the row it already has rather than raising a
   second one. */

async function upsertDeskInvoice(doc, state) {
  const profile = await adminReady;
  if (!profile) return null;

  const customer = (state.customers || []).find(c => c.id === doc.customerId) || {};
  const rates = state.rates || [];
  const rateOf = id => rates.find(r => r.id === id) || null;

  const { data: existing } = await sb.from('desk_invoices')
    .select('id, qb_invoice_id').eq('doc_id', doc.id).maybeSingle();

  // Already in QuickBooks: leave it exactly as it was sent.
  if (existing && existing.qb_invoice_id) return existing.id;

  const head = {
    doc_id:         doc.id,
    invoice_no:     doc.number || null,
    quote_no:       doc.fromQuoteNumber || null,
    invoice_date:   doc.date,
    due_date:       doc.dueDate || null,
    customer_name:  customer.company || '',
    customer_email: customer.email || '',
    qb_customer_id: customer.qbCustomerId || null,
    job_name:       doc.jobName || '',
    po_number:      customer.usesJobNameAsPo ? (doc.jobName || '') : (doc.poNumber || ''),
    memo:           doc.scope || '',
    status:         doc.status || 'open',
    created_by:     profile.id
  };

  let invoiceId = existing ? existing.id : null;

  if (invoiceId) {
    const { error } = await sb.from('desk_invoices').update(head).eq('id', invoiceId);
    if (error) throw new Error(error.message);
  } else {
    const { data, error } = await sb.from('desk_invoices').insert(head).select('id').single();
    if (error) throw new Error(error.message);
    invoiceId = data.id;
  }

  // Lines are replaced wholesale: the desk owns them until the push happens,
  // and a half-updated set would bill the wrong thing.
  await sb.from('desk_invoice_lines').delete().eq('invoice_id', invoiceId);

  const lines = (doc.lines || []).map((l, i) => {
    const r = rateOf(l.rateId);
    return {
      invoice_id:  invoiceId,
      description: [r ? r.label : '', l.desc].filter(Boolean).join(' - '),
      quantity:    Number(l.qty) || 0,
      unit_price:  Number(l.rate) || 0,
      qb_item_id:  r && r.qbo ? String(r.qbo) : null,
      sort_order:  i
    };
  }).filter(l => l.quantity * l.unit_price !== 0);

  if (lines.length) {
    const { error } = await sb.from('desk_invoice_lines').insert(lines);
    if (error) throw new Error(error.message);
  }

  return invoiceId;
}

/* The desk asks for this when its Send to QuickBooks button is pressed. The
   preview and the push itself are InvoicePreview's -- the same ones Approvals
   and Parts Invoice use, so there is one QuickBooks path, not three. */
window.SOTA_QD_QUICKBOOKS = {
  send: async function (doc, state) {
    if (doc.kind !== 'invoice') throw new Error('Convert the quote to an invoice first.');

    const invoiceId = await upsertDeskInvoice(doc, state);
    if (!invoiceId) throw new Error('Could not prepare the invoice.');

    const { data: row } = await sb.from('desk_invoices')
      .select('qb_invoice_id').eq('id', invoiceId).maybeSingle();

    InvoicePreview.open({
      deskInvoiceId: invoiceId,
      name: (doc.number ? 'Invoice ' + doc.number : 'This invoice'),
      qbInvoiceId: row ? row.qb_invoice_id : null,
      onPushed: () => { /* the desk keeps its own copy; nothing to reload here */ }
    });
  }
};

/* ---------------- the customer list ----------------
   Every company we invoice is already in QuickBooks -- that is where the money
   goes -- and qb_customers is the portal's copy of it. So the desk's list is
   filled from there rather than typed twice. Typing it twice is how a quote
   goes out under a name QuickBooks does not have, which is found out at the
   moment the invoice is refused.

   Pulling brings the QuickBooks id across with the name, and that id is the
   thing an invoice cannot be sent without.

   What he has typed is his. A company already on the desk keeps its contacts,
   terms, phone and address; only the QuickBooks link is filled in. Nothing is
   ever removed -- a customer switched off in QuickBooks stays on the desk, for
   the quotes already written against it. */

function deskCustomerShape(row) {
  return {
    id: 'c_qb_' + row.id,
    company: row.display_name,
    email: '',
    phone: '',
    address: '',
    terms: 30,
    contacts: [],
    qbCustomerId: String(row.id)
  };
}

/** Matches on the QuickBooks id first, then on the name, so a company added by
 *  hand before the pull is linked rather than duplicated beside itself. */
function sameCompany(deskCustomer, row) {
  if (deskCustomer.qbCustomerId && String(deskCustomer.qbCustomerId) === String(row.id)) return true;
  const a = (deskCustomer.company || '').trim().toLowerCase();
  const b = (row.display_name || '').trim().toLowerCase();
  return Boolean(a) && a === b;
}

async function pullCustomers(btn) {
  const profile = await adminReady;
  if (!profile) return;

  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Pulling…';

  try {
    const { data, error } = await sb.from('qb_customers')
      .select('id, display_name, company_name, active')
      .eq('active', true)
      .order('display_name');

    if (error) throw new Error(error.message);

    const rows = (data || []).filter(r => (r.display_name || '').trim());
    if (!rows.length) {
      deskNote('QuickBooks has no customers in the portal\'s copy of the list yet.', true);
      return;
    }

    const state = window.SOTAQuoteDesk.getState();
    const customers = state.customers || [];
    let added = 0, linked = 0;

    rows.forEach(row => {
      const existing = customers.find(c => sameCompany(c, row));
      if (!existing) { customers.push(deskCustomerShape(row)); added++; return; }
      if (!existing.qbCustomerId) { existing.qbCustomerId = String(row.id); linked++; }
      // The name follows QuickBooks, because that is what prints on the invoice.
      existing.company = row.display_name;
    });

    state.customers = customers;
    window.SOTAQuoteDesk.setState(state);

    const ready = customers.filter(c => c.qbCustomerId).length;
    const parts = [];
    if (added)  parts.push(added + (added === 1 ? ' company added' : ' companies added'));
    if (linked) parts.push(linked + ' linked to QuickBooks');
    if (!parts.length) parts.push('nothing new — the desk already had them all');
    deskNote(parts.join(', ') + '. ' + ready + ' of ' + customers.length + ' can be invoiced.', false);
  } catch (err) {
    deskNote('Could not pull the customers: ' + (err && err.message ? err.message : err), true);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

/* The desk owns everything inside its own box, so this sits above it rather
   than inside, and says what it did where he is looking. */
function mountCustomerPull() {
  const host = document.getElementById('adminContent');
  if (!host || document.getElementById('qdPullBar')) return;

  const bar = document.createElement('div');
  bar.id = 'qdPullBar';
  bar.className = 'qd-pull-bar';
  bar.innerHTML =
    '<button type="button" class="btn2 btn2-line small" id="qdPullBtn">Pull customers from QuickBooks</button>' +
    '<p class="qd-pull-note" id="qdPullNote">Brings every company across with its QuickBooks link, ' +
    'which is what an invoice cannot be sent without. Safe to press any time — it adds and links, never removes.</p>';
  host.insertBefore(bar, host.firstChild);

  document.getElementById('qdPullBtn')
    .addEventListener('click', (e) => pullCustomers(e.currentTarget));
}

function deskNote(msg, bad) {
  const el = document.getElementById('qdPullNote');
  if (!el) return;
  el.textContent = msg;
  el.className = 'qd-pull-note' + (bad ? ' qd-pull-bad' : ' qd-pull-ok');
}

adminReady.then(profile => { if (profile) mountCustomerPull(); });

InvoicePreview.wire();

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await sb.auth.signOut();
  window.location.href = 'login.html';
});
