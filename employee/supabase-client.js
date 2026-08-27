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


/* ---------------------------------------------------------------------------
   STALE PHONES
   ---------------------------------------------------------------------------
   A phone that keeps the portal on its home screen holds on to the page itself,
   not just the scripts. The ?v= on each script tag only busts the browser's
   cache for the script -- if the HTML that names it is old, the old version
   number is what gets asked for, and the phone quite correctly serves the old
   file back. The man then sits looking at last week's code with no way to tell.

   That is not hypothetical: the iPhone in the shop spent two days querying
   daily_entries by welder_id alone, which is how the code read before
   helpers-only tickets existed, so a ticket filed against a helper simply was
   not there. Every request came back 200. Nothing looked broken anywhere.

   So the running page checks what the live build is, and when it has fallen
   behind it says so. It does not reload by itself: a welder halfway through
   typing his hours should not have the page pulled out from under him. He taps
   when he is ready, and the tap goes to a URL the phone has never seen, which
   is the only reliable way to make it fetch the page again rather than serve
   its copy. */
async function checkBuild() {
  const meta = document.querySelector('meta[name="sota-build"]');
  if (!meta) return;                       // page predates this check
  try {
    const res = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return;
    const live = (await res.json()).build;
    if (!live || live === meta.content) return;
    showUpdateBar(live);
  } catch (_) {
    /* offline in the field is normal; say nothing */
  }
}

function showUpdateBar(live) {
  if (document.getElementById('sotaUpdateBar')) return;
  const bar = document.createElement('div');
  bar.id = 'sotaUpdateBar';
  bar.setAttribute('role', 'status');
  bar.style.cssText =
    'position:fixed;left:0;right:0;bottom:0;z-index:9999;display:flex;gap:12px;' +
    'align-items:center;justify-content:center;flex-wrap:wrap;padding:12px 16px;' +
    'background:#E9A23B;color:#150F04;font:600 14px/1.4 -apple-system,BlinkMacSystemFont,' +
    "'Segoe UI',Helvetica,Arial,sans-serif;box-shadow:0 -4px 18px rgba(0,0,0,.35)";
  bar.innerHTML =
    '<span>This page is out of date and may be missing work.</span>' +
    '<button type="button" style="background:#150F04;color:#fff;border:none;border-radius:8px;' +
    'padding:8px 16px;font:inherit;cursor:pointer">Update now</button>';
  bar.querySelector('button').addEventListener('click', () => {
    // A URL it has never seen. location.reload() would be served the same
    // cached page straight back.
    const u = new URL(window.location.href);
    u.searchParams.set('b', live);
    window.location.replace(u.toString());
  });
  document.body.appendChild(bar);
}

checkBuild();
// A phone left on the home screen for a week only comes back into view; that is
// the moment worth re-checking, not some timer.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkBuild();
});
