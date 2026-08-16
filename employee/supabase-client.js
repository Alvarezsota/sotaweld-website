const SUPABASE_URL = 'https://woqzbterwialanccprhp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_HGtY9w_Oays9WK4xkOnyYA_tk0RMQzO';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Keeps a page's numbers current instead of frozen at whatever it loaded with.
//
// Three things trigger a re-fetch:
//   - Postgres tells us a row in one of `tables` changed, so correcting a time
//     ticket in Approvals moves the Weld Log's hours while it sits open.
//   - The page comes back into view — restored from the browser's back/forward
//     cache, or a tab returning from the background. This is the fallback that
//     covers anything the socket missed while it was down.
//   - The socket reconnects after dropping, since changes made during the
//     outage never arrived.
//
// `isBusy` protects a half-finished form. A refresh that lands mid-edit isn't
// dropped, it's held and applied once the edit is done, so the page still ends
// up current without anyone losing what they typed.
async function liveData({ reload, isBusy, tables = [], channel = 'page' }) {
  const STALE_MS = 15000;   // a tab away this long is worth re-fetching
  const SETTLE_MS = 400;    // let a burst of row changes land as one reload
  const RETRY_MS = 3000;    // how often to re-check a refresh held by an edit
  const MAX_RETRY_MS = 30000;

  let lastLoad = Date.now();
  let running = false;
  let pending = false;
  let retryMs = RETRY_MS;
  let timer = null;

  function schedule(delay) {
    clearTimeout(timer);
    timer = setTimeout(run, delay);
  }

  async function run() {
    // Hold, don't drop: whatever blocks us now gets picked up below.
    if (running) { pending = true; return; }
    if (isBusy && isBusy()) { pending = true; schedule(RETRY_MS); return; }
    // No point redrawing a tab nobody is looking at; the return trip catches it.
    if (document.visibilityState === 'hidden') { pending = true; return; }

    let failed = false;
    running = true;
    pending = false;
    try {
      await reload();
      retryMs = RETRY_MS;
    } catch (err) {
      console.error('Live refresh failed', err);
      pending = true;
      failed = true;
    } finally {
      running = false;
      lastLoad = Date.now();
      if (pending) {
        // Back off only when the network is the problem — a refresh that merely
        // landed on top of another one should follow right behind it.
        schedule(failed ? retryMs : SETTLE_MS);
        if (failed) retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
      }
    }
  }

  window.addEventListener('pageshow', (e) => { if (e.persisted) run(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (pending || Date.now() - lastLoad > STALE_MS) run();
  });

  if (!tables.length) return;

  // Realtime carries the caller's token so row-level security still applies.
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session) await sb.realtime.setAuth(session.access_token);
  } catch (err) {
    console.warn('Could not authorize realtime; falling back to refresh on return', err);
  }

  let wasSubscribed = false;
  const ch = sb.channel(`live:${channel}`);
  tables.forEach(table => {
    ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => schedule(SETTLE_MS));
  });

  ch.subscribe((status) => {
    setLiveDot(status);
    if (status !== 'SUBSCRIBED') return;
    // Re-subscribing means the socket had dropped, so we missed whatever
    // changed in the meantime — reload rather than trust what's on screen.
    if (wasSubscribed) run();
    wasSubscribed = true;
  });
}

// Small dot in the header so the crew can see at a glance whether the page is
// listening for changes or has fallen back to refreshing when they come back.
function setLiveDot(status) {
  const dot = document.getElementById('liveDot');
  if (!dot) return;
  const live = status === 'SUBSCRIBED';
  dot.classList.toggle('is-live', live);
  dot.title = live
    ? 'Live — this page updates as tickets change'
    : 'Not live — this page refreshes when you come back to it';
}
