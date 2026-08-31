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
  const PUSH_URL = PUSH_FN_URL;
  const BACKUP_URL = `${SUPABASE_URL}/functions/v1/qb-invoice-backup`;

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

  /* Month, day, year -- the way it is read out loud in the office and the way
     the crew sheet and the pay statements already print it.

     Only what is shown turns round. transaction_date goes to QuickBooks as
     TxnDate and their API takes YYYY-MM-DD, so the payload stays ISO; formatting
     it at the source would have put a date QuickBooks cannot read on every
     invoice. Anything that is not a plain ISO date is passed through untouched
     rather than mangled into something that looks like a date and is not. */
  function usDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso == null ? '' : iso).trim());
    return m ? `${m[2]}-${m[3]}-${m[1]}` : (iso == null ? '' : String(iso));
  }

  /** One call for both the look and the send. dryRun decides which. */
  async function call(ids, dryRun) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error('Your session expired. Log in again.');
    const body = { dryRun };
    if (ids.jobWeekId) body.job_week_id = ids.jobWeekId;
    if (ids.partsInvoiceId) body.parts_invoice_id = ids.partsInvoiceId;
    if (ids.deskInvoiceId) body.desk_invoice_id = ids.deskInvoiceId;
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
   *   jobWeekId | partsInvoiceId | deskInvoiceId   which one to draw. Exactly one.
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

    if (!opts.jobWeekId && !opts.partsInvoiceId && !opts.deskInvoiceId) {
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
          <div class="inv-sub">${esc(p.customer_name || '')} · dated ${esc(usDate(p.transaction_date))}${
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

      ${p.final_invoice ? `
        <div class="inv-final" role="note">FINAL INVOICE
          <small>Nothing further is coming for this job — they can close it out.</small>
        </div>` : ''}

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
        ${current.jobWeekId ? `<button class="btn2 btn2-line" id="invBackupBtn">Crew time sheet</button>` : ''}
        <button class="btn2 btn2-ghost" data-inv-close>Close</button>
      </div>
      ${current.jobWeekId ? `<p class="inv-hint">The crew time sheet — every name, day and hour behind
        these lines — is attached to the invoice in QuickBooks when it is pushed, and goes out with it.
        This is a copy to read first.</p>` : ''}
      <p class="inv-status" id="invStatus"></p>
    `;

    const pushBtn = document.getElementById('invPushBtn');
    if (pushBtn) pushBtn.addEventListener('click', push);
    const backupBtn = document.getElementById('invBackupBtn');
    if (backupBtn) backupBtn.addEventListener('click', downloadBackup);
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
        // The attach cannot un-create the invoice, so a failed one is a note
        // rather than an error. Saying nothing would leave him believing the
        // sheet went with it.
        // A failed attach used to be a clause at the end of a long sentence, and
        // it read as part of the good news. It is the one thing on this screen
        // that needs doing something about, so it gets its own block and says
        // what to do rather than only what happened.
        const b = json.backup || {};
        const attachFailed = json.backup !== undefined && b.attached === false;
        if (statusEl) {
          const created = `Created invoice ${esc(json.doc_number || json.qb_invoice_id)} for ${money(json.total)}. `
            + `It is in QuickBooks unsent — look it over there before it goes out.${esc(renumbered)}`;
          statusEl.innerHTML = attachFailed
            ? `<span class="inv-ok">${created}</span>
               <span class="inv-attach-warn">
                 <b>The crew time sheet did not attach.</b>
                 The invoice is fine and nothing needs pushing again. Use
                 <b>Replace their crew sheets</b> on Approvals to put it on, and
                 do not send this invoice until you have.
                 <span class="inv-attach-why">${esc(b.error || 'reason unknown')}</span>
               </span>`
            : `<span class="inv-ok">${created}${json.backup === undefined ? ''
                 : ' The crew time sheet is attached to it and will go out with it.'}</span>`;
          statusEl.className = 'inv-status';
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

  /* The crew sheet behind the labour lines.
     
     It is attached to the QuickBooks invoice by the push without anybody asking,
     so this button is not how it gets there -- it is how it gets read first, and
     how a copy is pulled for a customer who has mislaid theirs. Works on a week
     already sent as well as one that has not been. */
  async function downloadBackup() {
    const btn = document.getElementById('invBackupBtn');
    const statusEl = document.getElementById('invStatus');
    if (!current || !current.jobWeekId) return;
    const label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Building…'; }
    if (statusEl) { statusEl.textContent = ''; statusEl.className = 'inv-status'; }
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) throw new Error('Your session expired. Log in again.');
      const res = await fetch(BACKUP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ job_week_id: current.jobWeekId }),
      });
      // A refusal comes back as JSON, a sheet comes back as a PDF. Reading the
      // error rather than saving it means he is told why instead of opening a
      // download that turns out to be the word "forbidden".
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Could not build the sheet (${res.status})`);
      }
      const blob = await res.blob();
      const cd = res.headers.get('content-disposition') || '';
      const m = cd.match(/filename="([^"]+)"/);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = m ? m[1] : 'crew-time-backup.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = 'The crew sheet could not be built: ' + err.message;
        statusEl.className = 'inv-status inv-err';
      }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label || 'Crew time sheet'; }
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
