document.getElementById('year').textContent = new Date().getFullYear();

const menuToggle = document.getElementById('menuToggle');
const mobileNav = document.getElementById('mobileNav');
menuToggle.addEventListener('click', () => {
  mobileNav.classList.toggle('open');
});
mobileNav.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => mobileNav.classList.remove('open'));
});

document.querySelectorAll('.m-faq-item').forEach(item => {
  const question = item.querySelector('.m-faq-question');
  question.addEventListener('click', () => {
    const isOpen = item.classList.contains('open');
    document.querySelectorAll('.m-faq-item').forEach(i => {
      i.classList.remove('open');
      i.querySelector('.icon').textContent = '+';
    });
    if (!isOpen) {
      item.classList.add('open');
      question.querySelector('.icon').textContent = '−';
    }
  });
});

/* This sits above the Supabase client on purpose. The client comes off a CDN,
   and if that fails to load nothing after it runs -- the visit would go
   unrecorded for a man who is browsing perfectly well. Recording where he came
   from needs nothing but the browser, so it happens first. */
/* ---------------------------------------------------------------------------
   WHERE A LEAD CAME FROM
   ---------------------------------------------------------------------------
   A quote request used to arrive with a name, a number and a message, and no
   way to tell whether the man found us on Google, read three job pages first,
   or was handed the address by somebody on a location.

   The trail is only readable on the first page of a visit. Once he has clicked
   through to the quote form the browser says he came from sotaweld.com, which
   says nothing. So the first page of every visit writes down where he came from
   and keeps it in sessionStorage -- this tab, this visit -- and every page after
   that only adds itself to the list. What the form sends is the whole visit.

   This runs on every page because script.js is on every page. It is wrapped in
   try/catch throughout: a browser with storage turned off must still be able to
   send a quote request, just without the trail. */
const VISIT_KEY = 'sota_visit';

function trackVisit() {
  const here = location.pathname + location.search;
  let v = null;
  try { v = JSON.parse(sessionStorage.getItem(VISIT_KEY)); } catch (_) { v = null; }

  if (!v || !Array.isArray(v.pages)) {
    const q = new URLSearchParams(location.search);
    v = {
      started_at: new Date().toISOString(),
      landing_page: location.pathname,
      landing_query: location.search.slice(0, 500),
      referrer: (document.referrer || '').slice(0, 500),
      utm_source: q.get('utm_source') || '',
      utm_medium: q.get('utm_medium') || '',
      utm_campaign: q.get('utm_campaign') || '',
      utm_term: q.get('utm_term') || '',
      utm_content: q.get('utm_content') || '',
      // One of these three means a paid click rather than an ordinary result.
      click_id: q.get('gclid') || q.get('fbclid') || q.get('msclkid') || '',
      pages: []
    };
  }

  // A reload or an anchor click is the same page, not another one.
  if (v.pages[v.pages.length - 1] !== here) v.pages.push(here);
  if (v.pages.length > 40) v.pages = v.pages.slice(-40);

  try { sessionStorage.setItem(VISIT_KEY, JSON.stringify(v)); } catch (_) {}
  return v;
}

const visit = trackVisit();

const sb = supabase.createClient(
  'https://woqzbterwialanccprhp.supabase.co',
  'sb_publishable_HGtY9w_Oays9WK4xkOnyYA_tk0RMQzO'
);


const quoteForm = document.getElementById('quoteForm');
if (quoteForm) {
  quoteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('quoteSubmitBtn');
    const errEl = document.getElementById('quoteError');
    const successEl = document.getElementById('quoteSuccess');
    errEl.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Sending...';

    const name = document.getElementById('qName').value.trim();
    const phone = document.getElementById('qPhone').value.trim();
    const email = document.getElementById('qEmail').value.trim();
    const message = document.getElementById('qMessage').value.trim();

    // Blank stays blank rather than becoming an empty string: on the other end
    // "not known" and "he came here directly" are different answers.
    const orNull = (x) => (x && String(x).trim()) ? String(x).trim() : null;

    const { error } = await sb.from('quote_requests').insert({
      name, phone, email: email || null, message,
      landing_page: orNull(visit.landing_page),
      landing_query: orNull(visit.landing_query),
      referrer: orNull(visit.referrer),
      source_page: location.pathname,
      utm_source: orNull(visit.utm_source),
      utm_medium: orNull(visit.utm_medium),
      utm_campaign: orNull(visit.utm_campaign),
      utm_term: orNull(visit.utm_term),
      utm_content: orNull(visit.utm_content),
      click_id: orNull(visit.click_id),
      pages_seen: (visit.pages && visit.pages.length) ? visit.pages : null,
      visit_started_at: visit.started_at || null,
      user_agent: (navigator.userAgent || '').slice(0, 500) || null,
      screen_size: (window.screen && window.screen.width)
        ? window.screen.width + 'x' + window.screen.height
        : null
    });

    if (error) {
      errEl.textContent = 'Something went wrong. Please call or text us instead.';
      btn.disabled = false;
      btn.textContent = 'Request a Quote';
      console.error(error);
      return;
    }

    quoteForm.style.display = 'none';
    successEl.style.display = 'block';
  });
}
