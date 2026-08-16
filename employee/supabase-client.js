const SUPABASE_URL = 'https://woqzbterwialanccprhp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_HGtY9w_Oays9WK4xkOnyYA_tk0RMQzO';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Portal pages fetch their data once on load, so anything changed elsewhere goes
// unnoticed: correct a time ticket in Approvals and the Weld Log tab still shows
// the hours it loaded with, and hitting Back restores the page straight out of
// the browser's back/forward cache without re-running any of it. Re-fetch when
// the page comes back into view. `isBusy` lets a page skip the refresh while
// someone is mid-edit so the reload can't wipe their form out from under them.
function refreshOnReturn(reload, isBusy) {
  const STALE_MS = 15000;
  let lastLoad = Date.now();
  let running = false;

  async function refresh() {
    if (running || (isBusy && isBusy())) return;
    running = true;
    try {
      await reload();
    } catch (err) {
      console.error('Refresh failed', err);
    } finally {
      running = false;
      lastLoad = Date.now();
    }
  }

  window.addEventListener('pageshow', (e) => { if (e.persisted) refresh(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastLoad > STALE_MS) refresh();
  });
}
