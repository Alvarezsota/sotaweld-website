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
    const [{ data: q }, { data: inv }] = await Promise.all([
      sb.rpc('peek_quote_no'),
      sb.rpc('peek_invoice_no')
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

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await sb.auth.signOut();
  window.location.href = 'login.html';
});
