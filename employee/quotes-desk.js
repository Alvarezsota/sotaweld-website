(function () {
  "use strict";

  var MOUNT = document.getElementById("sota-quote-desk");
  var PRINT = document.getElementById("sota-qd-print");
  if (!MOUNT) return;

  /* ---------------- storage ---------------- */
  var KEY = "sota.quotedesk.v1";
  var mem = null;
  var store = window.SOTA_QD_STORAGE || {
    load: function () {
      try { var raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; }
      catch (e) { return mem; }
    },
    save: function (s) {
      mem = s;
      try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* private mode: memory only */ }
    }
  };

  /* ---------------- defaults ---------------- */
  var GROUPS = [
    { id: "shop",  label: "Shop fabrication & laser" },
    { id: "field", label: "Field work" },
    { id: "other", label: "Materials & other" }
  ];

  var DEFAULT_RATES = [
    { id: "laser_plate", label: "CNC fiber laser — plate", unit: "hr",  rate: 215,  group: "shop",  qbo: "17" },
    { id: "tube_laser",  label: "Tube laser",                   unit: "hr",  rate: 235,  group: "shop",  qbo: "18" },
    { id: "setup",       label: "Programming & setup",          unit: "ea",  rate: 250,  group: "shop",  qbo: "19" },
    { id: "bench",       label: "Bench / shop fabrication",     unit: "hr",  rate: 85,   group: "shop",  qbo: "20" },
    { id: "welder",      label: "Welder",                       unit: "hr",  rate: 95,   group: "field", qbo: "14" },
    { id: "helper",      label: "Helper",                       unit: "hr",  rate: 45,   group: "field", qbo: "15" },
    { id: "per_diem",    label: "Per diem",                     unit: "day", rate: 100,  group: "field", qbo: "16" },
    { id: "rig",         label: "Truck & rig",                  unit: "hr",  rate: 45,   group: "field", qbo: "21" },
    { id: "mileage",     label: "Mileage",                      unit: "mi",  rate: 0.85, group: "field", qbo: "22" },
    { id: "material",    label: "Material",                     unit: "ea",  rate: 0,    group: "other", qbo: "23" },
    { id: "gas",         label: "Gas & consumables",            unit: "ea",  rate: 0,    group: "other", qbo: "24" },
    { id: "freight",     label: "Freight",                      unit: "ea",  rate: 0,    group: "other", qbo: "25" }
  ];

  var DEFAULT_CUSTOMERS = [
    {
      id: "c_rdbls", company: "ROCKING DOUBLE S LLC", email: "ap@rdbls.com",
      phone: "", address: "", terms: 30,
      contacts: [
        { id: "ct_ap",  name: "Accounts Payable", title: "AP",      email: "ap@rdbls.com",        phone: "" },
        { id: "ct_sw",  name: "Sam Wilde",        title: "",        email: "sam.wilde@rdbls.com", phone: "" },
        { id: "ct_mp",  name: "Mel Palmer",       title: "",        email: "mpalmer@rdbls.com",   phone: "" }
      ]
    },
    {
      id: "c_str", company: "Standard Tech Resources", email: "shenry@standardtechresources.com",
      phone: "", address: "", terms: 30,
      contacts: [
        { id: "ct_sh", name: "Samuel Henry", title: "", email: "shenry@standardtechresources.com", phone: "" }
      ]
    }
  ];

  function blankDraft() {
    return {
      id: uid("d"), number: null, kind: "quote", status: "draft",
      customerId: "", contactId: "", jobName: "", scope: "",
      date: today(), terms: 30, validDays: 30,
      lines: [], lump: { shop: false, field: false, other: false },
      notes: ""
    };
  }

  function defaults() {
    return {
      company: {
        name: "State of the Arc Welding & Services LLC",
        address: "10234 W 64th St, Odessa, TX 79764",
        phone: "",
        emails: ["g.alvarez@sotaweld.com", "sotaweldinganddesign@outlook.com"]
      },
      settings: {
        nextNumber: 2961,
        quotePrefix: "Q-",
        invoicePrefix: "INV-",
        sharedSeries: true,
        salesTax: false
      },
      rates: DEFAULT_RATES.slice(),
      customers: DEFAULT_CUSTOMERS.slice(),
      docs: [],
      draft: blankDraft()
    };
  }

  /* ---------------- helpers ---------------- */
  function uid(p) { return (p || "id") + "_" + Math.random().toString(36).slice(2, 9); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function money(n) {
    return "$" + num(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function addDays(iso, days) {
    var d = new Date(iso + "T00:00:00");
    d.setDate(d.getDate() + num(days));
    return d.toISOString().slice(0, 10);
  }
  function prettyDate(iso) {
    if (!iso) return "—";
    var d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  /* ---------------- state ---------------- */
  var S = null;
  var subs = [];
  var tab = "quote";
  var activeCustomer = null;

  function loaded(raw) {
    var d = defaults();
    if (!raw || typeof raw !== "object") return d;
    var s = {
      company:   Object.assign(d.company, raw.company || {}),
      settings:  Object.assign(d.settings, raw.settings || {}),
      rates:     Array.isArray(raw.rates) && raw.rates.length ? raw.rates : d.rates,
      customers: Array.isArray(raw.customers) ? raw.customers : d.customers,
      docs:      Array.isArray(raw.docs) ? raw.docs : [],
      draft:     raw.draft && typeof raw.draft === "object" ? raw.draft : d.draft
    };
    if (!s.draft.lump) s.draft.lump = { shop: false, field: false, other: false };
    if (!Array.isArray(s.draft.lines)) s.draft.lines = [];
    return s;
  }

  function persist() {
    try { store.save(S); } catch (e) { /* adapter failure is not fatal */ }
    subs.forEach(function (fn) { try { fn(S); } catch (e) {} });
  }

  function rateById(id) {
    for (var i = 0; i < S.rates.length; i++) if (S.rates[i].id === id) return S.rates[i];
    return null;
  }
  function customerById(id) {
    for (var i = 0; i < S.customers.length; i++) if (S.customers[i].id === id) return S.customers[i];
    return null;
  }

  /* ---------------- math ---------------- */
  function lineTotal(l) { return num(l.qty) * num(l.rate); }
  function groupTotal(doc, g) {
    return doc.lines.reduce(function (sum, l) { return l.group === g ? sum + lineTotal(l) : sum; }, 0);
  }
  function docTotal(doc) {
    return doc.lines.reduce(function (sum, l) { return sum + lineTotal(l); }, 0);
  }

  /* ---------------- numbering ----------------
     Two separate series, because they answer to different things.

     A quote is ours alone, and the office numbers quotes by the day they were
     written: SOTA-MM-DD-YYYY-NN, NN counting up within that date. Month before
     day, deliberately.

     An invoice is not ours alone. It continues the same run as the field
     tickets, out of the invoice_counter the crew app already draws from, so a
     week billed from Approvals and an invoice raised here can never land on the
     same number. QuickBooks still has the final say: the number we hand over is
     a proposal, and whatever QuickBooks puts on the invoice is written back.

     Both come from the host page, which is the only thing holding a database
     connection. Without a provider the desk falls back to its own counter so it
     still works standing alone.                                        */
  var numbers = window.SOTA_QD_NUMBERS || null;

  function localFallback() {
    var n = S.settings.nextNumber;
    S.settings.nextNumber = n + 1;
    return n;
  }

  function takeNumber(kind) {
    if (!numbers) return Promise.resolve(String(localFallback()));
    var fn = kind === "invoice" ? numbers.invoice : numbers.quote;
    if (typeof fn !== "function") return Promise.resolve(String(localFallback()));
    return Promise.resolve(fn()).then(function (n) {
      if (n === null || n === undefined || n === "") throw new Error("no number came back");
      return String(n);
    });
  }

  // Both series arrive fully formed, so a number is shown exactly as issued
  // rather than having a prefix stuck on the front of it here.
  function docLabel(doc) {
    if (!doc.number) return "unsaved";
    return String(doc.number);
  }

  /* ---------------- render ---------------- */
  function render() {
    MOUNT.innerHTML =
      bar() +
      tabs() +
      '<div class="qd-body">' +
        (tab === "quote"     ? viewQuote()     :
         tab === "documents" ? viewDocuments() :
         tab === "customers" ? viewCustomers() :
         tab === "rates"     ? viewRates()     : viewSettings()) +
      "</div>";
    recalc();
  }

  function bar() {
    var d = S.draft;
    return '' +
      '<div class="qd-bar">' +
        '<div class="qd-mark"><b>State of the Arc</b><span>Quote Desk</span></div>' +
        '<span class="qd-doc-no">' + esc(docLabel(d)) + '</span>' +
        '<span class="qd-pill qd-pill--' + esc(d.status) + '">' + esc(d.status) + '</span>' +
        '<div class="qd-bar-right">' +
          '<button class="qd-btn qd-btn--ghost" data-act="new">New quote</button>' +
          '<button class="qd-btn" data-act="print">Print / PDF</button>' +
          '<button class="qd-btn" data-act="invoice">Convert to invoice</button>' +
          '<button class="qd-btn qd-btn--primary" data-act="save">Save quote</button>' +
        '</div>' +
      '</div>';
  }

  function tabs() {
    var items = [["quote","Quote"],["documents","Documents"],["customers","Customers"],["rates","Rates"],["settings","Settings"]];
    return '<div class="qd-tabs" role="tablist">' + items.map(function (t) {
      return '<button class="qd-tab" role="tab" aria-selected="' + (tab === t[0]) + '" data-tab="' + t[0] + '">' + t[1] + '</button>';
    }).join("") + '</div>';
  }

  /* ---------------- quote tab ---------------- */
  function viewQuote() {
    var d = S.draft;
    var cust = customerById(d.customerId);

    var custOpts = '<option value="">— select company —</option>' + S.customers.map(function (c) {
      return '<option value="' + esc(c.id) + '"' + (c.id === d.customerId ? " selected" : "") + '>' + esc(c.company) + '</option>';
    }).join("");

    // Contacts are drawn ONLY from the selected company. A contact can
    // never surface under a company it does not belong to.
    var contactOpts = '<option value="">— select contact —</option>' +
      (cust ? cust.contacts.map(function (ct) {
        return '<option value="' + esc(ct.id) + '"' + (ct.id === d.contactId ? " selected" : "") + '>' +
               esc(ct.name) + (ct.title ? " · " + esc(ct.title) : "") + '</option>';
      }).join("") : "");

    return '' +
    '<div class="qd-work">' +
      '<div>' +
        '<div class="qd-panel">' +
          '<div class="qd-panel-hd"><h2>Bill to</h2></div>' +
          '<div class="qd-panel-bd">' +
            '<div class="qd-grid qd-grid--2">' +
              field("Company", '<select class="qd-select" data-doc="customerId">' + custOpts + '</select>') +
              field("Contact", '<select class="qd-select" data-doc="contactId"' + (cust ? "" : " disabled") + '>' + contactOpts + '</select>' +
                    (cust ? "" : '<span class="qd-hint">Pick a company first.</span>')) +
            '</div>' +
            '<div class="qd-grid qd-grid--2" style="margin-top:14px">' +
              field("Job / location", '<input class="qd-input" data-doc="jobName" value="' + esc(d.jobName) + '" placeholder="Vaquero Antelope compressor station">') +
              field("Quote date", '<input class="qd-input" type="date" data-doc="date" value="' + esc(d.date) + '">') +
            '</div>' +
            '<div class="qd-grid qd-grid--3" style="margin-top:14px">' +
              field("Net terms (days)", '<input class="qd-input qd-num" type="number" min="0" step="1" data-doc="terms" value="' + esc(d.terms) + '">') +
              field("Quote good for (days)", '<input class="qd-input qd-num" type="number" min="0" step="1" data-doc="validDays" value="' + esc(d.validDays) + '">') +
              field("Billing email", '<input class="qd-input" value="' + esc(cust ? cust.email : "") + '" readonly>') +
            '</div>' +
            '<div class="qd-field" style="margin-top:14px">' +
              '<span class="qd-label">Scope of work</span>' +
              '<textarea class="qd-area" data-doc="scope" placeholder="What the customer is buying, in their words.">' + esc(d.scope) + '</textarea>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div class="qd-panel">' +
          '<div class="qd-panel-hd"><h2>Line items</h2>' +
            '<span class="qd-spacer"></span>' +
            '<span class="qd-hint">Rates pull from the Rates tab — override any line.</span>' +
          '</div>' +
          '<div class="qd-panel-bd">' + GROUPS.map(section).join("") + '</div>' +
        '</div>' +
      '</div>' +

      '<div class="qd-rail">' + rail() + '</div>' +
    '</div>';
  }

  function field(label, control) {
    return '<label class="qd-field"><span class="qd-label">' + label + '</span>' + control + '</label>';
  }

  function section(g) {
    var d = S.draft;
    var rows = d.lines.filter(function (l) { return l.group === g.id; });
    var lumpNote = g.id === "shop"
      ? "Bill as one lump sum"
      : (g.id === "field" ? "Bill as one lump sum" : "Bill as one lump sum");

    return '' +
    '<div class="qd-section" data-group="' + g.id + '">' +
      '<div class="qd-section-hd">' +
        '<h3>' + esc(g.label) + '</h3>' +
        '<span class="qd-spacer"></span>' +
        '<label class="qd-lump"><input type="checkbox" data-lump="' + g.id + '"' + (d.lump[g.id] ? " checked" : "") + '> ' + lumpNote + '</label>' +
        '<button class="qd-btn qd-btn--mini" data-add="' + g.id + '">+ Line</button>' +
      '</div>' +
      (rows.length
        ? '<div class="qd-row qd-row-hd"><span>Item</span><span>Description</span><span>Qty</span><span>Unit</span><span>Rate</span><span>Amount</span><span></span></div>' +
          '<div class="qd-rows">' + rows.map(lineRow).join("") + '</div>'
        : '<p class="qd-empty">No ' + esc(g.label.toLowerCase()) + ' lines yet.</p>') +
      (d.lump[g.id] && rows.length
        ? '<p class="qd-hint" style="margin-top:8px">The customer sees one line: <strong>' + esc(g.label) + ' — ' + money(groupTotal(d, g.id)) + '</strong>. Your detail stays here.</p>'
        : '') +
    '</div>';
  }

  function lineRow(l) {
    var opts = S.rates.map(function (r) {
      return '<option value="' + esc(r.id) + '"' + (r.id === l.rateId ? " selected" : "") + '>' + esc(r.label) + '</option>';
    }).join("");
    var r = rateById(l.rateId);
    return '' +
    '<div class="qd-row" data-line="' + esc(l.id) + '">' +
      '<select class="qd-select" data-lf="rateId" aria-label="Item">' + opts + '</select>' +
      '<input class="qd-input" data-lf="desc" value="' + esc(l.desc) + '" placeholder="Detail for this line" aria-label="Description">' +
      '<input class="qd-input qd-num" data-lf="qty" type="number" step="0.25" min="0" value="' + esc(l.qty) + '" aria-label="Quantity">' +
      '<span class="qd-unit">' + esc(r ? r.unit : "") + '</span>' +
      '<input class="qd-input qd-num" data-lf="rate" type="number" step="0.01" min="0" value="' + esc(l.rate) + '" aria-label="Rate">' +
      '<span class="qd-amt" data-amt>' + money(lineTotal(l)) + '</span>' +
      '<button class="qd-del" data-del="' + esc(l.id) + '" title="Remove line" aria-label="Remove line">&times;</button>' +
    '</div>';
  }

  function rail() {
    var d = S.draft;
    return '' +
    '<div class="qd-panel">' +
      '<div class="qd-panel-hd"><h2>Totals</h2></div>' +
      '<div class="qd-panel-bd">' +
        '<div class="qd-sum">' +
          GROUPS.map(function (g) {
            return '<div class="qd-sum-row"><span>' + esc(g.label) + '</span><span data-sub="' + g.id + '">' + money(groupTotal(d, g.id)) + '</span></div>';
          }).join("") +
        '</div>' +
        '<div class="qd-total"><span class="qd-label">Quote total</span><b data-total>' + money(docTotal(d)) + '</b></div>' +
        '<p class="qd-hint" style="margin-top:10px">No sales tax applied — tax is switched off in the QuickBooks company, so pushed lines go over non-taxable.</p>' +
      '</div>' +
    '</div>' +
    '<div class="qd-panel">' +
      '<div class="qd-panel-hd"><h2>Notes on the quote</h2></div>' +
      '<div class="qd-panel-bd">' +
        '<textarea class="qd-area" data-doc="notes" placeholder="Exclusions, lead time, who supplies material.">' + esc(d.notes) + '</textarea>' +
      '</div>' +
    '</div>';
  }

  /* ---------------- documents tab ---------------- */
  function viewDocuments() {
    if (!S.docs.length) {
      return '<div class="qd-panel"><div class="qd-panel-bd"><p class="qd-empty">Nothing saved yet. Build a quote and hit <strong>Save quote</strong>.</p></div></div>';
    }
    var rows = S.docs.slice().reverse().map(function (doc) {
      var c = customerById(doc.customerId);
      return '<tr>' +
        '<td class="qd-doc-no">' + esc(docLabel(doc)) + '</td>' +
        '<td>' + statusSelect(doc) + '</td>' +
        '<td>' + esc(c ? c.company : "—") + '</td>' +
        '<td>' + esc(doc.jobName || "—") + '</td>' +
        '<td>' + esc(prettyDate(doc.date)) + '</td>' +
        '<td>' + esc(doc.dueDate ? prettyDate(doc.dueDate) : "—") + '</td>' +
        '<td class="qd-r">' + money(docTotal(doc)) + '</td>' +
        '<td class="qd-r"><button class="qd-btn qd-btn--mini" data-open="' + esc(doc.id) + '">Open</button></td>' +
      '</tr>';
    }).join("");

    return '' +
    '<div class="qd-panel">' +
      '<div class="qd-panel-hd"><h2>Quotes &amp; invoices</h2><span class="qd-spacer"></span>' +
        '<span class="qd-hint">Quotes are dated SOTA numbers; invoices carry on the field-ticket run' +
          (S.settings.nextInvoiceNo ? ' — next invoice would be ' + esc(S.settings.nextInvoiceNo) : '') + '</span></div>' +
      '<div class="qd-panel-bd qd-scroll">' +
        '<table><thead><tr><th>Number</th><th>Status</th><th>Company</th><th>Job</th><th>Date</th><th>Due</th><th class="qd-r">Total</th><th></th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>' +
      '</div>' +
    '</div>';
  }

  var STATUSES = ["draft", "sent", "accepted", "invoiced", "paid", "void"];
  function statusSelect(doc) {
    return '<select class="qd-select qd-status" data-status="' + esc(doc.id) + '" aria-label="Status">' +
      STATUSES.map(function (s) {
        return '<option value="' + s + '"' + (s === doc.status ? " selected" : "") + '>' + s + '</option>';
      }).join("") + '</select>';
  }

  /* ---------------- customers tab ---------------- */
  function viewCustomers() {
    if (!activeCustomer && S.customers.length) activeCustomer = S.customers[0].id;
    var c = customerById(activeCustomer);

    var list = S.customers.map(function (x) {
      return '<button class="qd-list-item" data-cust="' + esc(x.id) + '" aria-current="' + (x.id === activeCustomer) + '">' +
        esc(x.company) + '<small>' + x.contacts.length + ' contact' + (x.contacts.length === 1 ? "" : "s") +
        ' · net ' + esc(x.terms) + '</small></button>';
    }).join("");

    var editor = !c ? '<p class="qd-empty">No customers yet.</p>' :
      '<div class="qd-grid qd-grid--2">' +
        field("Company", '<input class="qd-input" data-cf="company" value="' + esc(c.company) + '">') +
        field("Billing email", '<input class="qd-input" data-cf="email" value="' + esc(c.email) + '">') +
      '</div>' +
      '<div class="qd-grid qd-grid--3" style="margin-top:14px">' +
        field("Phone", '<input class="qd-input" data-cf="phone" value="' + esc(c.phone) + '">') +
        field("Net terms (days)", '<input class="qd-input qd-num" type="number" min="0" step="1" data-cf="terms" value="' + esc(c.terms) + '">') +
        field("Address", '<input class="qd-input" data-cf="address" value="' + esc(c.address) + '">') +
      '</div>' +
      '<div class="qd-section" style="margin-top:22px">' +
        '<div class="qd-section-hd"><h3>Contacts at ' + esc(c.company) + '</h3><span class="qd-spacer"></span>' +
          '<button class="qd-btn qd-btn--mini" data-addcontact="1">+ Contact</button></div>' +
        (c.contacts.length
          ? '<div class="qd-rows">' + c.contacts.map(function (ct) {
              return '<div class="qd-contact" data-contact="' + esc(ct.id) + '">' +
                '<input class="qd-input" data-ctf="name" value="' + esc(ct.name) + '" placeholder="Name" aria-label="Contact name">' +
                '<input class="qd-input" data-ctf="email" value="' + esc(ct.email) + '" placeholder="Email" aria-label="Contact email">' +
                '<input class="qd-input" data-ctf="phone" value="' + esc(ct.phone) + '" placeholder="Phone" aria-label="Contact phone">' +
                '<button class="qd-del" data-delcontact="' + esc(ct.id) + '" title="Remove contact" aria-label="Remove contact">&times;</button>' +
              '</div>';
            }).join("") + '</div>'
          : '<p class="qd-empty">No contacts on file for this company.</p>') +
        '<p class="qd-note" style="margin-top:14px">Contacts belong to this company only. They will not appear on a quote billed to anyone else.</p>' +
      '</div>';

    return '' +
    '<div class="qd-book">' +
      '<div class="qd-panel">' +
        '<div class="qd-panel-hd"><h2>Customers</h2><span class="qd-spacer"></span>' +
          '<button class="qd-btn qd-btn--mini" data-act="addcust">+ New</button></div>' +
        '<div class="qd-panel-bd"><div class="qd-list">' + list + '</div></div>' +
      '</div>' +
      '<div class="qd-panel"><div class="qd-panel-bd">' + editor + '</div></div>' +
    '</div>';
  }

  /* ---------------- rates tab ---------------- */
  function viewRates() {
    var rows = S.rates.map(function (r) {
      return '<tr data-rate="' + esc(r.id) + '">' +
        '<td><input class="qd-input" data-rf="label" value="' + esc(r.label) + '"></td>' +
        '<td><input class="qd-input" data-rf="unit" value="' + esc(r.unit) + '" style="width:70px"></td>' +
        '<td class="qd-r"><input class="qd-input qd-num" data-rf="rate" type="number" step="0.01" min="0" value="' + esc(r.rate) + '" style="width:110px"></td>' +
        '<td><select class="qd-select" data-rf="group">' + GROUPS.map(function (g) {
            return '<option value="' + g.id + '"' + (g.id === r.group ? " selected" : "") + '>' + esc(g.label) + '</option>';
          }).join("") + '</select></td>' +
        '<td class="qd-r"><input class="qd-input qd-num" data-rf="qbo" value="' + esc(r.qbo) + '" style="width:80px"></td>' +
      '</tr>';
    }).join("");

    return '' +
    '<div class="qd-panel">' +
      '<div class="qd-panel-hd"><h2>Rates</h2><span class="qd-spacer"></span>' +
        '<span class="qd-hint">Edited here, applied to every new line.</span></div>' +
      '<div class="qd-panel-bd qd-scroll">' +
        '<table><thead><tr><th>Item</th><th>Unit</th><th class="qd-r">Rate</th><th>Section</th><th class="qd-r">QBO item</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>' +
        '<p class="qd-note" style="margin-top:16px">QBO item numbers map each line to the service item in QuickBooks Online when an invoice is pushed. Welding Services (1010000001) is the catch-all if an item is ever missing.</p>' +
      '</div>' +
    '</div>';
  }

  /* ---------------- settings tab ---------------- */
  function viewSettings() {
    var co = S.company, st = S.settings;
    return '' +
    '<div class="qd-work">' +
      '<div>' +
        '<div class="qd-panel">' +
          '<div class="qd-panel-hd"><h2>Company on the quote</h2></div>' +
          '<div class="qd-panel-bd">' +
            '<div class="qd-grid qd-grid--2">' +
              field("Legal name", '<input class="qd-input" data-co="name" value="' + esc(co.name) + '">') +
              field("Phone", '<input class="qd-input" data-co="phone" value="' + esc(co.phone) + '" placeholder="(432) …">') +
            '</div>' +
            '<div class="qd-field" style="margin-top:14px">' +
              '<span class="qd-label">Address</span>' +
              '<input class="qd-input" data-co="address" value="' + esc(co.address) + '">' +
            '</div>' +
            '<div class="qd-grid qd-grid--2" style="margin-top:14px">' +
              field("Email 1", '<input class="qd-input" data-co="email0" value="' + esc(co.emails[0] || "") + '">') +
              field("Email 2", '<input class="qd-input" data-co="email1" value="' + esc(co.emails[1] || "") + '">') +
            '</div>' +
            '<p class="qd-hint" style="margin-top:10px">Both addresses print on every quote.</p>' +
          '</div>' +
        '</div>' +

        '<div class="qd-panel">' +
          '<div class="qd-panel-hd"><h2>Numbering</h2></div>' +
          '<div class="qd-panel-bd">' +
            '<div class="qd-grid qd-grid--2">' +
              field("Quote numbers", '<input class="qd-input" value="SOTA-MM-DD-YYYY-NN" readonly>') +
              field("Next invoice number", '<input class="qd-input qd-num" value="' + esc(st.nextInvoiceNo || "—") + '" readonly>') +
            '</div>' +
            '<p class="qd-note" style="margin-top:16px">Two series, and neither is typed here. A quote is numbered by the day it was written &mdash; month, day, year, then a count within that day. An invoice carries on the same run as the field tickets, taken from the crew app\'s invoice counter at the moment it is raised, so a week billed from Approvals and an invoice raised here can never collide. QuickBooks has the final say: the number sent is a proposal, and whatever QuickBooks puts on the invoice is written back over it.</p>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="qd-rail">' +
        '<div class="qd-panel">' +
          '<div class="qd-panel-hd"><h2>Data</h2></div>' +
          '<div class="qd-panel-bd">' +
            '<p class="qd-hint">Everything lives in this browser unless your site supplies a storage adapter.</p>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">' +
              '<button class="qd-btn qd-btn--mini" data-act="export">Export JSON</button>' +
              '<button class="qd-btn qd-btn--mini" data-act="reset">Reset to defaults</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* ---------------- live totals ---------------- */
  function recalc() {
    var d = S.draft;
    MOUNT.querySelectorAll("[data-line]").forEach(function (el) {
      var l = lineById(el.getAttribute("data-line"));
      if (!l) return;
      var amt = el.querySelector("[data-amt]");
      if (amt) amt.textContent = money(lineTotal(l));
    });
    GROUPS.forEach(function (g) {
      var el = MOUNT.querySelector('[data-sub="' + g.id + '"]');
      if (el) el.textContent = money(groupTotal(d, g.id));
    });
    var tot = MOUNT.querySelector("[data-total]");
    if (tot) tot.textContent = money(docTotal(d));
  }

  function lineById(id) {
    for (var i = 0; i < S.draft.lines.length; i++) if (S.draft.lines[i].id === id) return S.draft.lines[i];
    return null;
  }

  function toast(msg) {
    var t = document.createElement("div");
    t.className = "qd-toast";
    t.textContent = msg;
    MOUNT.appendChild(t);
    setTimeout(function () { t.remove(); }, 2200);
  }

  /* ---------------- events ---------------- */
  MOUNT.addEventListener("input", onEdit);
  MOUNT.addEventListener("change", onEdit);

  function onEdit(e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;

    // header / draft fields
    var docKey = t.getAttribute("data-doc");
    if (docKey) {
      if (docKey === "customerId") {
        S.draft.customerId = t.value;
        S.draft.contactId = "";                       // never carry a contact across companies
        var c = customerById(t.value);
        if (c) S.draft.terms = num(c.terms);
        persist(); render(); return;
      }
      S.draft[docKey] = (docKey === "terms" || docKey === "validDays") ? num(t.value) : t.value;
      persist(); return;
    }

    // line fields
    var rowEl = t.closest && t.closest("[data-line]");
    var lf = t.getAttribute("data-lf");
    if (rowEl && lf) {
      var l = lineById(rowEl.getAttribute("data-line"));
      if (!l) return;
      if (lf === "rateId") {
        l.rateId = t.value;
        var r = rateById(t.value);
        if (r) { l.rate = r.rate; l.group = r.group; }
        persist(); render(); return;
      }
      l[lf] = (lf === "qty" || lf === "rate") ? num(t.value) : t.value;
      persist(); recalc(); return;
    }

    // lump sum toggles
    var lump = t.getAttribute("data-lump");
    if (lump) { S.draft.lump[lump] = t.checked; persist(); render(); return; }

    // customer fields
    var cf = t.getAttribute("data-cf");
    if (cf) {
      var cu = customerById(activeCustomer);
      if (!cu) return;
      cu[cf] = (cf === "terms") ? num(t.value) : t.value;
      persist();
      if (cf === "company" && e.type === "change") render();
      return;
    }

    var ctf = t.getAttribute("data-ctf");
    if (ctf) {
      var holder = t.closest("[data-contact]");
      var cu2 = customerById(activeCustomer);
      if (!holder || !cu2) return;
      var id = holder.getAttribute("data-contact");
      cu2.contacts.forEach(function (ct) { if (ct.id === id) ct[ctf] = t.value; });
      persist(); return;
    }

    // rates
    var rf = t.getAttribute("data-rf");
    if (rf) {
      var tr = t.closest("[data-rate]");
      if (!tr) return;
      var rr = rateById(tr.getAttribute("data-rate"));
      if (!rr) return;
      rr[rf] = (rf === "rate") ? num(t.value) : t.value;
      persist(); return;
    }

    // company + settings
    var co = t.getAttribute("data-co");
    if (co) {
      if (co === "email0") S.company.emails[0] = t.value;
      else if (co === "email1") S.company.emails[1] = t.value;
      else S.company[co] = t.value;
      persist(); return;
    }
    var st = t.getAttribute("data-st");
    if (st) {
      S.settings[st] = (st === "nextNumber") ? num(t.value) : t.value;
      persist(); return;
    }

    // document status
    var ds = t.getAttribute("data-status");
    if (ds) {
      S.docs.forEach(function (d2) { if (d2.id === ds) d2.status = t.value; });
      if (S.draft.id === ds) S.draft.status = t.value;
      persist(); render(); return;
    }
  }

  MOUNT.addEventListener("click", function (e) {
    var t = e.target.closest ? e.target.closest("[data-tab],[data-add],[data-del],[data-cust],[data-open],[data-act],[data-addcontact],[data-delcontact]") : null;
    if (!t) return;

    var v;
    if ((v = t.getAttribute("data-tab"))) { tab = v; render(); return; }

    if ((v = t.getAttribute("data-add"))) {
      var first = null;
      for (var i = 0; i < S.rates.length; i++) if (S.rates[i].group === v) { first = S.rates[i]; break; }
      if (!first) first = S.rates[0];
      S.draft.lines.push({ id: uid("l"), group: v, rateId: first.id, desc: "", qty: 0, rate: first.rate });
      persist(); render(); return;
    }

    if ((v = t.getAttribute("data-del"))) {
      S.draft.lines = S.draft.lines.filter(function (l) { return l.id !== v; });
      persist(); render(); return;
    }

    if ((v = t.getAttribute("data-cust"))) { activeCustomer = v; render(); return; }

    if ((v = t.getAttribute("data-open"))) {
      for (var j = 0; j < S.docs.length; j++) {
        if (S.docs[j].id === v) { S.draft = JSON.parse(JSON.stringify(S.docs[j])); break; }
      }
      tab = "quote"; persist(); render(); return;
    }

    if (t.getAttribute("data-addcontact")) {
      var cu = customerById(activeCustomer);
      if (!cu) return;
      cu.contacts.push({ id: uid("ct"), name: "", title: "", email: "", phone: "" });
      persist(); render(); return;
    }

    if ((v = t.getAttribute("data-delcontact"))) {
      var cu3 = customerById(activeCustomer);
      if (!cu3) return;
      cu3.contacts = cu3.contacts.filter(function (ct) { return ct.id !== v; });
      if (S.draft.contactId === v) S.draft.contactId = "";
      persist(); render(); return;
    }

    if ((v = t.getAttribute("data-act"))) act(v, t);
  });

  /* ---------------- actions ---------------- */
  function busy(btn, label) {
    if (!btn) return;
    if (label) {
      if (!btn.hasAttribute("data-idle")) btn.setAttribute("data-idle", btn.textContent);
      btn.disabled = true; btn.textContent = label;
    } else {
      btn.disabled = false;
      if (btn.hasAttribute("data-idle")) { btn.textContent = btn.getAttribute("data-idle"); btn.removeAttribute("data-idle"); }
    }
  }

  function upsert(doc) {
    for (var i = 0; i < S.docs.length; i++) {
      if (S.docs[i].id === doc.id) { S.docs[i] = JSON.parse(JSON.stringify(doc)); return; }
    }
    S.docs.push(JSON.parse(JSON.stringify(doc)));
  }

  function act(name, btn) {
    var d = S.draft;

    if (name === "new") {
      S.draft = blankDraft(); tab = "quote"; persist(); render();
      toast("New quote started"); return;
    }

    if (name === "save") {
      if (!d.customerId) { tab = "quote"; render(); toast("Pick a company first"); return; }
      if (!d.lines.length) { toast("Add at least one line"); return; }

      // Already numbered: re-saving must never spend a second number.
      if (d.number) { upsert(d); persist(); render(); toast("Saved " + docLabel(d)); return; }

      busy(btn, "Numbering...");
      takeNumber(d.kind === "invoice" ? "invoice" : "quote").then(function (n) {
        d.number = n;
        upsert(d); persist(); render();
        toast("Saved " + docLabel(d));
      }, function (err) {
        // Saving an unnumbered document would leave a quote nobody can refer
        // to, so nothing is written and the office is told why.
        busy(btn, false);
        toast("No number issued — nothing saved. " + (err && err.message ? err.message : ""));
      });
      return;
    }

    if (name === "invoice") {
      if (!d.customerId || !d.lines.length) { toast("Finish the quote before invoicing"); return; }
      if (d.kind === "invoice") { toast("This is already " + docLabel(d)); return; }

      busy(btn, "Numbering...");

      // The quote keeps its own SOTA number and the invoice takes a fresh one
      // off the field-ticket run. They are different series, so the invoice
      // cannot inherit the quote's number the way it used to.
      var quoteNo = d.number ? Promise.resolve(d.number) : takeNumber("quote");

      quoteNo.then(function (qn) {
        d.number = qn;
        return takeNumber("invoice");
      }).then(function (invNo) {
        d.status = "accepted";
        upsert(d);

        var inv = JSON.parse(JSON.stringify(d));
        inv.id = uid("d");
        inv.number = invNo;
        inv.kind = "invoice";
        inv.status = "invoiced";
        inv.fromQuote = d.id;
        inv.fromQuoteNumber = d.number;
        inv.date = today();
        inv.dueDate = addDays(inv.date, inv.terms);   // net terms drive the due date
        upsert(inv);

        S.draft = inv; tab = "quote"; persist(); render();
        toast(docLabel(d) + " → " + docLabel(inv) + ", due " + prettyDate(inv.dueDate));
      }, function (err) {
        busy(btn, false);
        toast("No number issued — nothing invoiced. " + (err && err.message ? err.message : ""));
      });
      return;
    }

    if (name === "print") { buildPrint(d); window.print(); return; }

    if (name === "addcust") {
      var c = { id: uid("c"), company: "New company", email: "", phone: "", address: "", terms: 30, contacts: [] };
      S.customers.push(c); activeCustomer = c.id; tab = "customers"; persist(); render(); return;
    }

    if (name === "export") {
      var json = JSON.stringify(S, null, 2);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(json).then(function () { toast("JSON copied to clipboard"); },
                                                 function () { toast("Copy blocked — use SOTAQuoteDesk.getState()"); });
      } else { toast("Use SOTAQuoteDesk.getState() in the console"); }
      return;
    }

    if (name === "reset") {
      if (btn.getAttribute("data-armed") !== "1") {
        btn.setAttribute("data-armed", "1");
        btn.textContent = "Click again to erase everything";
        setTimeout(function () {
          if (btn.isConnected) { btn.removeAttribute("data-armed"); btn.textContent = "Reset to defaults"; }
        }, 4000);
        return;
      }
      S = defaults(); activeCustomer = null; persist(); render();
      toast("Reset to defaults"); return;
    }
  }

  /* ---------------- customer-facing document ---------------- */
  function buildPrint(d) {
    var c = customerById(d.customerId);
    var ct = c ? c.contacts.filter(function (x) { return x.id === d.contactId; })[0] : null;
    var isInv = d.kind === "invoice";

    var body = "";
    GROUPS.forEach(function (g) {
      var rows = d.lines.filter(function (l) { return l.group === g.id; });
      if (!rows.length) return;

      if (d.lump[g.id]) {
        body += '<tr class="p-grp"><td colspan="3">' + esc(g.label) + '</td>' +
                '<td class="p-r">' + money(groupTotal(d, g.id)) + '</td></tr>';
        return;
      }
      body += '<tr class="p-grp"><td colspan="4">' + esc(g.label) + '</td></tr>';
      rows.forEach(function (l) {
        var r = rateById(l.rateId);
        body += '<tr>' +
          '<td>' + esc(r ? r.label : "") + (l.desc ? ' — ' + esc(l.desc) : "") + '</td>' +
          '<td class="p-r">' + esc(l.qty) + " " + esc(r ? r.unit : "") + '</td>' +
          '<td class="p-r">' + money(l.rate) + '</td>' +
          '<td class="p-r">' + money(lineTotal(l)) + '</td>' +
        '</tr>';
      });
    });

    PRINT.innerHTML =
      '<div class="p-hd">' +
        '<div class="p-co"><b>' + esc(S.company.name) + '</b>' +
          '<span>' + esc(S.company.address) + '</span>' +
          (S.company.phone ? '<span>' + esc(S.company.phone) + '</span>' : "") +
          '<span>' + esc(S.company.emails.filter(Boolean).join("  ·  ")) + '</span>' +
        '</div>' +
        '<div class="p-doc"><b>' + (isInv ? "Invoice" : "Quotation") + '</b>' +
          '<span>' + esc(docLabel(d)) + '</span>' +
          '<span>' + esc(prettyDate(d.date)) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="p-meta">' +
        '<div><strong>Bill to</strong>' + esc(c ? c.company : "—") +
          (ct ? '<br>' + esc(ct.name) : "") +
          (ct && ct.email ? '<br>' + esc(ct.email) : "") +
          (c && c.address ? '<br>' + esc(c.address) : "") + '</div>' +
        '<div><strong>Job</strong>' + esc(d.jobName || "—") + '</div>' +
        '<div><strong>' + (isInv ? "Due" : "Valid until") + '</strong>' +
          esc(isInv ? prettyDate(d.dueDate || addDays(d.date, d.terms)) : prettyDate(addDays(d.date, d.validDays))) +
          '<br>Net ' + esc(d.terms) + '</div>' +
      '</div>' +
      (d.scope ? '<p style="font-size:10pt;margin:0 0 6pt">' + esc(d.scope) + '</p>' : "") +
      '<table><thead><tr><th>Description</th><th class="p-r">Qty</th><th class="p-r">Rate</th><th class="p-r">Amount</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table>' +
      '<div class="p-tot">Total &nbsp; ' + money(docTotal(d)) + '</div>' +
      (d.notes ? '<div class="p-ft">' + esc(d.notes) + '</div>' : "") +
      '<div class="p-ft">' + esc(S.company.name) + ' · ' + esc(S.company.emails.filter(Boolean).join(" · ")) + '</div>';
  }

  /* ---------------- public API ---------------- */
  window.SOTAQuoteDesk = {
    getState: function () { return JSON.parse(JSON.stringify(S)); },
    setState: function (obj) { S = loaded(obj); persist(); render(); },
    subscribe: function (fn) { if (typeof fn === "function") subs.push(fn); },
    render: render,
    exportQBO: function (docId) {
      var d = (docId ? S.docs.filter(function (x) { return x.id === docId; })[0] : S.draft);
      if (!d) return null;
      var c = customerById(d.customerId);
      return {
        docNumber: docLabel(d),
        txnDate: d.date,
        dueDate: d.dueDate || addDays(d.date, d.terms),
        customer: c ? c.company : "",
        customerEmail: c ? c.email : "",
        taxable: false,
        lines: d.lines.map(function (l) {
          var r = rateById(l.rateId);
          return {
            itemId: r ? r.qbo : "1010000001",
            itemName: r ? r.label : "Welding Services",
            description: l.desc,
            qty: num(l.qty),
            rate: num(l.rate),
            amount: lineTotal(l)
          };
        }),
        total: docTotal(d)
      };
    }
  };

  /* ---------------- boot ---------------- */
  function boot(raw) { S = loaded(raw); render(); }
  var initial;
  try { initial = store.load(); } catch (e) { initial = null; }
  if (initial && typeof initial.then === "function") {
    initial.then(boot, function () { boot(null); });
  } else {
    boot(initial);
  }
})();
