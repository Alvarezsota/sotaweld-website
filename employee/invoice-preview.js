/* ---------------------------------------------------------------------------
   THE INVOICE, BEFORE IT LEAVES
   ---------------------------------------------------------------------------
   Shared by Approvals and the parts-invoice page, because both are asking the
   same question and both end in the same irreversible act. Two copies of this
   would mean the day they drifted, one screen would show a customer a different
   invoice from the one being sent.

   What it shows is not a drawing of the invoice, it is the invoice: the same
   call that pushes, with dryRun on, so the lines here are the lines QuickBooks
   would be sent. Anything that would stop the push comes back with it and is
   listed underneath, which is the difference between knowing why the button is
   grey and pressing it to find out.

   The page it sits on owns nothing but the markup:
     <div class="inv-sheet" id="invSheet" hidden>
       <div class="inv-sheet-back" data-inv-close></div>
       <div class="inv-card" role="dialog" aria-modal="true" aria-labelledby="invName">
         <button class="inv-x" data-inv-close>&times;</button>
         <div id="invSheetBody"></div>
       </div>
     </div>
--------------------------------------------------------------------------- */

const InvoicePreview = (function () {
  const PUSH_URL = `${SUPABASE_URL}/functions/v1/qb-push-invoice`;

  let current = null;   // what is open: the ids, the payload, the callback

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
  }

  function money(n) {
    return '$' + Number(n || 0).toLocaleString('en-US',
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /** One call for both the look and the send. dryRun decides which. */
  async function call(ids, dryRun) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error('Your session expired. Log in again.');
    const body = { dryRun };
    if (ids.jobWeekId) body.job_week_id = ids.jobWeekId;
    if (ids.partsInvoiceId) body.parts_invoice_id = ids.partsInvoiceId;
    const res = await fetch(PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { res, json };
  }

  const sheet = () => document.getElementById('invSheet');
  const bodyEl = () => document.getElementById('invSheetBody');

  /**
   * opts:
   *   jobWeekId | partsInvoiceId   which one to draw. Exactly one.
   *   name          what to call it before the payload arrives
   *   qbInvoiceId   the QuickBooks invoice it is already on, if it is
   *   onPushed      run after a successful push, so the page can reload
   */
  async function open(opts) {
    const el = sheet();
    if (!el) return;
    current = { ...opts, payload: null };

    bodyEl().innerHTML = '<p class="inv-loading">Building the invoice…</p>';
    el.hidden = false;
    document.body.classList.add('inv-open');

    if (!opts.jobWeekId && !opts.partsInvoiceId) {
      bodyEl().innerHTML = `
        <div class="inv-head"><h3 id="invName">${esc(opts.name || 'This invoice')}</h3></div>
        <p class="inv-none">Nothing has been saved for this yet, so there is no invoice to build.</p>`;
      return;
    }

    let out;
    try {
      out = await call(opts, true);
    } catch (err) {
      bodyEl().innerHTML = `<p class="inv-none">Could not build the invoice: ${esc(err.message)}</p>`;
      return;
    }

    if (!out.res.ok && !out.json.payload) {
      bodyEl().innerHTML =
        `<p class="inv-none">Could not build the invoice: ${esc(out.json.error || out.res.statusText)}</p>`;
      return;
    }

    current.payload = out.json.payload || null;
    render(out.json);
  }

  function render(json) {
    const p = json.payload || {};
    const blockers = Array.isArray(json.blockers) ? json.blockers : [];
    const canPush = blockers.length === 0;
    const lines = Array.isArray(p.lines) ? p.lines : [];
    const number = p.invoice_no || null;

    if (p.error) {
      bodyEl().innerHTML = `
        <div class="inv-head"><h3 id="invName">${esc(p.job_name || current.name || 'This invoice')}</h3></div>
        <p class="inv-none">${esc(p.error)}</p>
        <div class="inv-actions"><button class="btn2 btn2-ghost" data-inv-close>Close</button></div>`;
      return;
    }

    bodyEl().innerHTML = `
      <div class="inv-head">
        <div>
          <h3 id="invName">Invoice ${number ? '#' + esc(number) : 'draft'}</h3>
          <div class="inv-sub">${esc(p.customer_name || '')} · dated ${esc(p.transaction_date || '')}${
            p.po_number ? ' · PO ' + esc(p.po_number) : ''}</div>
        </div>
        <div class="inv-total-big">${money(p.lines_total)}</div>
      </div>

      ${number ? '' : `<p class="inv-hint">No number on this yet. Finishing it takes
        ${esc(p.next_invoice_no || 'the next one')}; QuickBooks would otherwise number it itself.</p>`}

      <div class="inv-memo">${esc(p.memo || '')}</div>

      <div class="inv-lines-scroll">
      <table class="inv-lines">
        <thead><tr><th>Line</th><th class="r inv-c-qty">Qty</th><th class="r inv-c-rate">Rate</th><th class="r">Amount</th></tr></thead>
        <tbody>
          ${lines.map(l => `
            <tr>
              <td>
                ${esc(l.description)}
                ${l.quantity ? `<div class="inv-qty-note">${esc(l.quantity)} &times; ${money(l.unit_price)}</div>` : ''}
              </td>
              <td class="r inv-c-qty">${l.quantity ? esc(l.quantity) : ''}</td>
              <td class="r inv-c-rate">${l.unit_price ? money(l.unit_price) : ''}</td>
              <td class="r">${money(l.amount)}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr><td class="r">Total</td><td class="r inv-c-qty"></td><td class="r inv-c-rate"></td><td class="r">${money(p.lines_total)}</td></tr>
        </tfoot>
      </table>
      </div>

      ${blockers.length ? `
        <div class="inv-blockers">
          <div class="inv-blockers-h">${blockers.length === 1 ? 'This is in the way' : 'These are in the way'}</div>
          <ul>${blockers.map(b => `<li>${esc(b.message)}</li>`).join('')}</ul>
        </div>` : ''}

      <div class="inv-actions">
        ${current.qbInvoiceId
          ? `<span class="inv-done">Already on QuickBooks invoice ${esc(current.qbInvoiceId)}.</span>`
          : `<button class="btn2 ${canPush ? 'btn2-solid' : 'btn2-line'}" id="invPushBtn" ${canPush ? '' : 'disabled'}>
               Push to QuickBooks
             </button>
             <span class="inv-caveat">${canPush
               ? 'Creates it in QuickBooks unsent, and locks it here.'
               : 'Fix what is listed above and this will work.'}</span>`}
        <button class="btn2 btn2-ghost" data-inv-close>Close</button>
      </div>
      <p class="inv-status" id="invStatus"></p>
    `;

    const pushBtn = document.getElementById('invPushBtn');
    if (pushBtn) pushBtn.addEventListener('click', push);
  }

  async function push() {
    const p = current.payload || {};

    const ok = confirm(
      `Create invoice ${p.invoice_no ? '#' + p.invoice_no : '(unnumbered)'} for ` +
      `${p.customer_name} in QuickBooks, for ${money(p.lines_total)}?\n\n` +
      `It goes in unsent, so you can look at it there before it goes to the customer. ` +
      `It locks here once it does, and only reversing it in QuickBooks unlocks it.`
    );
    if (!ok) return;

    const btn = document.getElementById('invPushBtn');
    const statusEl = document.getElementById('invStatus');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    if (statusEl) { statusEl.textContent = ''; statusEl.className = 'inv-status'; }

    try {
      const { res, json } = await call(current, false);
      if (!res.ok || !json.ok) throw new Error(json.error || `Push failed (${res.status})`);

      if (json.alreadyPushed) {
        if (statusEl) {
          statusEl.textContent = json.note || 'This was already on an invoice.';
          statusEl.className = 'inv-status inv-ok';
        }
      } else {
        // QuickBooks may number it something other than what we proposed. Say so
        // rather than leaving him to notice the two do not match.
        const renumbered = json.number_changed_by_quickbooks
          ? ` QuickBooks numbered it ${json.doc_number} rather than ${json.proposed_number}, so that is the number now.`
          : '';
        if (statusEl) {
          statusEl.textContent = `Created invoice ${json.doc_number || json.qb_invoice_id} for ${money(json.total)}. `
            + `It is in QuickBooks unsent — look it over there before it goes out.${renumbered}`;
          statusEl.className = 'inv-status inv-ok';
        }
      }
      if (btn) btn.remove();
      if (typeof current.onPushed === 'function') await current.onPushed();
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = 'Nothing was created: ' + err.message;
        statusEl.className = 'inv-status inv-err';
      }
      if (btn) { btn.disabled = false; btn.textContent = 'Push to QuickBooks'; }
    }
  }

  function close() {
    const el = sheet();
    if (el) el.hidden = true;
    document.body.classList.remove('inv-open');
    current = null;
  }

  /* Escape and the backdrop close it, on whichever page it is sitting. */
  function wire() {
    const el = sheet();
    if (!el) return;
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-inv-close]')) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !el.hidden) close();
    });
  }

  return { open, close, wire, money };
})();
