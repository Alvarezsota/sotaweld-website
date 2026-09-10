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

/* Quotes live in desk_quotes and desk_quote_lines now. The blob is still
   written on every save, but it is no longer the truth -- it holds the desk's
   working state (company details, the customer list, the open draft, and the
   two legacy invoice documents from before converting went to Parts and
   Services) and it doubles as a copy to fall back on.

   The module knows none of this. It hands over its whole state and asks for it
   back the same way; composing that from tables and taking it apart again
   happens here. */

let lastSavedJson = null;
let saveInFlight = null;
const syncedDocs = new Map();       // doc id -> the json last written to the tables
let syncTimer = null;

/* A doc as the desk wants it, out of a quote row and its lines. */
function docFromRow(q, lines) {
  return {
    id: q.doc_id,
    kind: 'quote',
    number: q.quote_no || '',
    date: q.quote_date,
    status: q.status || 'draft',
    jobName: q.job_name || '',
    scope: q.scope || '',
    notes: q.notes || '',
    terms: Number(q.net_days == null ? 30 : q.net_days),
    validDays: Number(q.valid_days == null ? 30 : q.valid_days),
    customerId: q.desk_customer_id || '',
    contactId: q.desk_contact_id || '',
    lump: (q.lump && typeof q.lump === 'object') ? q.lump : { shop: false, field: false, other: false },
    invoicedNo: q.invoiced_no || '',
    invoicedInvoiceId: q.invoiced_parts_invoice_id || null,
    lines: (lines || []).map((l) => ({
      id: 'l_' + String(l.id).slice(0, 8),
      rateId: l.rate_id || '',
      group: l.rate_group || 'other',
      desc: l.line_note || '',
      qty: Number(l.quantity || 0),
      rate: Number(l.unit_price || 0),
    })),
  };
}

/* And the other way, for writing back. */
function rowFromDoc(d, state) {
  const cust = (state.customers || []).find((c) => c.id === d.customerId) || {};
  return {
    doc_id: d.id,
    quote_no: d.number || null,
    quote_date: d.date,
    customer_name: cust.company || '',
    customer_email: cust.email || null,
    qb_customer_id: cust.qbCustomerId || null,
    desk_customer_id: d.customerId || null,
    desk_contact_id: d.contactId || null,
    job_name: d.jobName || '',
    scope: d.scope || '',
    notes: d.notes || '',
    status: d.status || 'draft',
    net_days: Number(d.terms == null ? 30 : d.terms),
    valid_days: Number(d.validDays == null ? 30 : d.validDays),
    lump: d.lump || {},
    total: (d.lines || []).reduce((t, l) => t + Number(l.qty || 0) * Number(l.rate || 0), 0),
    updated_at: new Date().toISOString(),
  };
}

/* description is the whole line as it should read on an invoice; line_note is
   only the typed half, which is what goes back in the editor's box. */
function lineRowsFor(quoteId, d, rateOf) {
  return (d.lines || []).map((l, i) => {
    const r = rateOf(l.rateId);
    const label = r ? r.label : '';
    const note = (l.desc || '').trim();
    return {
      quote_id: quoteId,
      sort_order: i + 1,
      description: [label, note].filter(Boolean).join(' - ') || 'Line ' + (i + 1),
      line_note: note || null,
      quantity: Number(l.qty || 0),
      unit: r ? r.unit : null,
      unit_price: Number(l.rate || 0),
      qb_item_id: r ? r.qbo : null,
      rate_group: l.group || (r ? r.group : null),
      rate_id: l.rateId || null,
    };
  });
}

/* Writes the quotes that actually changed. Lines are replaced wholesale rather
   than diffed: a quote has a handful of them, and a half-applied diff is a
   quote that silently disagrees with what is on screen. */
async function syncQuotesToTables(state) {
  const rates = state.rates || [];
  const rateOf = (id) => rates.find((r) => r.id === id) || null;
  const quotes = (state.docs || []).filter((d) => d && d.kind === 'quote');

  for (const d of quotes) {
    const json = JSON.stringify(d);
    if (syncedDocs.get(d.id) === json) continue;

    const { data: head, error: headErr } = await sb.from('desk_quotes')
      .upsert(rowFromDoc(d, state), { onConflict: 'doc_id' })
      .select('id').single();
    if (headErr) { deskWarn('Quote not saved: ' + headErr.message); syncedDocs.delete(d.id); return; }

    const { error: delErr } = await sb.from('desk_quote_lines').delete().eq('quote_id', head.id);
    if (delErr) { deskWarn('Quote lines not saved: ' + delErr.message); syncedDocs.delete(d.id); return; }

    const rows = lineRowsFor(head.id, d, rateOf);
    if (rows.length) {
      const { error: insErr } = await sb.from('desk_quote_lines').insert(rows);
      if (insErr) { deskWarn('Quote lines not saved: ' + insErr.message); syncedDocs.delete(d.id); return; }
    }
    syncedDocs.set(d.id, json);
  }
}

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
    const blob = (data && data.state && Object.keys(data.state).length) ? data.state : null;

    const [{ data: rateRows }, { data: quoteRows }] = await Promise.all([
      sb.from('desk_rates').select('id, label, unit, rate, group_id, qb_item_id, sort_order')
        .eq('active', true).order('sort_order'),
      sb.from('desk_quotes')
        .select('id, doc_id, quote_no, quote_date, customer_name, job_name, scope, notes, '
              + 'status, net_days, valid_days, lump, invoiced_no, invoiced_parts_invoice_id, '
              + 'desk_customer_id, desk_contact_id')
        .order('quote_date', { ascending: false }),
    ]);

    const state = blob || {};
    state.settings = Object.assign({}, state.settings, hints);

    if (Array.isArray(rateRows) && rateRows.length) {
      state.rates = rateRows.map((r) => ({
        id: r.id, label: r.label, unit: r.unit,
        rate: Number(r.rate), group: r.group_id, qbo: r.qb_item_id,
      }));
    }

    // Only take the tables over the blob if they actually answered. A failed
    // read must not blank the desk.
    if (Array.isArray(quoteRows)) {
      const ids = quoteRows.map((q) => q.id);
      let lines = [];
      if (ids.length) {
        const { data: lineData } = await sb.from('desk_quote_lines')
          .select('id, quote_id, sort_order, line_note, quantity, unit_price, rate_group, rate_id')
          .in('quote_id', ids).order('sort_order');
        lines = Array.isArray(lineData) ? lineData : [];
      }
      const byQuote = new Map();
      lines.forEach((l) => {
        if (!byQuote.has(l.quote_id)) byQuote.set(l.quote_id, []);
        byQuote.get(l.quote_id).push(l);
      });

      const fromTables = quoteRows.map((q) => docFromRow(q, byQuote.get(q.id)));
      fromTables.forEach((d) => syncedDocs.set(d.id, JSON.stringify(d)));

      // The two invoice documents raised before converting went to Parts and
      // Services stay as they are. They are on QuickBooks already and there is
      // nothing to gain from moving them.
      const legacyInvoices = (state.docs || []).filter((d) => d && d.kind !== 'quote');
      state.docs = fromTables.concat(legacyInvoices);
    }

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

    // The tables are the truth, but they are several writes per quote and this
    // runs on every keystroke. Let the typing settle, then write.
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncQuotesToTables(state).catch((err) => deskWarn('Quote not saved: ' + err.message));
    }, 1200);

    return saveInFlight;
  }
};

/* ---------------- converting ----------------
   The desk asks; Postgres does it. convert_quote_to_invoice writes the Parts
   and Services invoice, copies the lines and marks the quote in one
   transaction, so there is no state where the invoice exists and the quote does
   not know about it.

   The quote has to be in the tables before it can be converted, and the desk
   saves on a timer -- so anything still pending is flushed first. Converting a
   quote the database has never seen would fail on a row that is not there. */
window.SOTA_QD_CONVERT = {
  toInvoice: async function (doc) {
    const profile = await adminReady;
    if (!profile) throw new Error('not an admin');

    clearTimeout(syncTimer);
    const state = window.SOTAQuoteDesk ? window.SOTAQuoteDesk.getState() : null;
    if (state) await syncQuotesToTables(state);

    const { data: row, error: findErr } = await sb.from('desk_quotes')
      .select('id').eq('doc_id', doc.id).maybeSingle();
    if (findErr) throw new Error(findErr.message);
    if (!row) throw new Error('That quote has not saved yet. Try again in a moment.');

    const { data, error } = await sb.rpc('convert_quote_to_invoice', { p_quote_id: row.id });
    if (error) throw new Error(error.message);
    return { invoiceId: data };
  }
};

/* ---------------- the quote as a PDF ----------------
   The same letterhead the invoice is drawn on, off the same function. Like the
   convert, anything still pending is flushed first: the server draws from the
   rows, so a quote the tables have not caught up with would come back as it was
   a minute ago rather than as it is on screen. */
const QUOTE_PDF_URL = `${SUPABASE_URL}/functions/v1/qb-invoice-pdf`;

window.SOTA_QD_PDF = {
  download: async function (doc) {
    const profile = await adminReady;
    if (!profile) throw new Error('not an admin');

    clearTimeout(syncTimer);
    const state = window.SOTAQuoteDesk ? window.SOTAQuoteDesk.getState() : null;
    if (state) await syncQuotesToTables(state);

    const { data: row, error: findErr } = await sb.from('desk_quotes')
      .select('id').eq('doc_id', doc.id).maybeSingle();
    if (findErr) throw new Error(findErr.message);
    if (!row) throw new Error('That quote has not saved yet. Try again in a moment.');

    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error('signed out -- sign in again');

    const res = await fetch(QUOTE_PDF_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ quote_id: row.id }),
    });
    if (!res.ok) {
      const why = await res.json().catch(() => ({}));
      throw new Error(why.error || `the quote could not be drawn (${res.status})`);
    }

    // Handed over as a blob rather than navigated to: a plain link would drop
    // the Authorization header and come back a 401.
    const blob = await res.blob();
    const name = (res.headers.get('content-disposition') || '')
      .match(/filename="([^"]+)"/)?.[1] || `quote-${doc.number || 'draft'}.pdf`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
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


/* ---------------- what used to live here ----------------
   upsertDeskInvoice wrote a converted quote into desk_invoices so the desk's
   own Send to QuickBooks button had a row to push. Both the button and the
   table are gone: convert_quote_to_invoice writes a Parts and Services invoice
   in one transaction, and that page owns the push from there -- including
   attaching the letterhead PDF. Two ways to put the same work on their books
   was one too many. */

/* ---------------- the dashboard's copy ----------------
   There used to be a second writer here: every save mirrored a cut-down row
   into desk_quotes so the dashboard had something to show. desk_quotes is the
   real thing now and the storage adapter above writes it in full, lines and
   all, so a second writer putting a partial row on top of it is only a way for
   the two to disagree. It is gone.

   What is left is deleting, which the adapter has no reason to do. */

window.SOTA_QD_BACKEND = {
  /* The adapter writes the quote and its lines. Nothing to mirror. */
  saveQuote: async function () {},

  /* convert_quote_to_invoice marks the quote inside the same transaction that
     writes the invoice, and the number lands on it by trigger when the invoice
     is finished. Kept only for the pre-Parts-and-Services path in the desk. */
  markInvoiced: async function (quoteDocId, invoiceNo) {
    try {
      await sb.from('desk_quotes')
        .update({ status: 'invoiced', invoiced_no: invoiceNo || null })
        .eq('doc_id', quoteDocId);
    } catch (err) { console.warn(err); }
  },

  removeQuote: async function (docId) {
    try { await sb.from('desk_quotes').delete().eq('doc_id', docId); } catch (err) { console.warn(err); }
  },
};

/* ---------------- deleting a document ----------------
   Voiding leaves it in the list with its number spent forever. That is right
   for an invoice a customer has already seen and wrong for one raised by
   mistake, so the desk can now delete outright -- and the number goes back on
   the shelf when it is safe for it to.

   The one thing it will not do is delete something QuickBooks already has.
   Removing our copy would not remove theirs; it would only lose the last
   record of which document their invoice came from. QuickBooks first, here
   second -- the same order as everything else that touches their books. */
window.SOTA_QD_DELETE = {
  remove: async function (doc) {
    const profile = await adminReady;
    if (!profile) throw new Error('Admins only.');

    // A quote that became an invoice keeps the invoice. Deleting the quote here
    // would leave a Parts and Services invoice with nothing pointing at it, and
    // if it has been pushed, a QuickBooks invoice with no record of where it
    // came from. QuickBooks first, here second -- the same order as everything
    // else that touches their books.
    const { data: q, error: lookErr } = await sb.from('desk_quotes')
      .select('id, invoiced_no, invoiced_parts_invoice_id').eq('doc_id', doc.id).maybeSingle();
    if (lookErr) throw new Error(lookErr.message);

    if (q && q.invoiced_parts_invoice_id) {
      throw new Error('This became invoice ' + (q.invoiced_no || 'a draft')
        + ' on Parts and Services. Delete that invoice first, then delete this.');
    }

    // The lines go with it: desk_quote_lines cascades on the quote row.
    await sb.from('desk_quotes').delete().eq('doc_id', doc.id);

    // Quote numbers are dated and counted within their day; handing one back
    // would renumber a day that may already have others on it. Only the
    // invoice run is a single line that can be wound back.
    let freed = null;
    if (doc.kind === 'invoice' && /^\d+$/.test(String(doc.number || ''))) {
      const { data } = await sb.rpc('release_invoice_no', { p_no: Number(doc.number) });
      freed = data || null;
    }
    return freed;
  }
};

/* The desk's own Send to QuickBooks button is retired.
   ---------------------------------------------------------------------------
   It wrote a desk_invoices row and pushed that. desk_invoices is gone. The hook
   is kept so the button says something useful rather than failing on a table
   that is not there. */
window.SOTA_QD_QUICKBOOKS = {
  send: async function (doc) {
    if (doc.kind !== 'invoice') throw new Error('Convert the quote to an invoice first.');
    throw new Error('Invoices are pushed from the Parts and Services tab now. '
      + 'Convert the quote and finish it there.');
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
