let currentUser = null;
let currentProfile = null;

function fmt(dt) {
  return new Date(dt).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });
}

async function requireAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    window.location.href = 'login.html';
    return null;
  }
  return session.user;
}

async function loadProfile(userId) {
  const { data, error } = await sb.from('profiles').select('*').eq('id', userId).single();
  if (error) {
    console.error(error);
    return null;
  }
  return data;
}

async function loadAnnouncements() {
  const listEl = document.getElementById('announcementList');
  const { data, error } = await sb
    .from('announcements')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error || !data || !data.length) {
    listEl.innerHTML = '<p class="empty-state2">No announcements yet.</p>';
    return;
  }

  listEl.innerHTML = data.map(a => `
    <div class="announcement-item2">
      <h3>${escapeHtml(a.title)}</h3>
      <p>${escapeHtml(a.body)}</p>
      <div class="date2">${fmt(a.created_at)}</div>
    </div>
  `).join('');
}

async function handleAnnouncementSubmit(e) {
  e.preventDefault();
  const title = document.getElementById('annTitle').value.trim();
  const body = document.getElementById('annBody').value.trim();

  await sb.from('announcements').insert({
    author_id: currentUser.id,
    title,
    body
  });

  document.getElementById('announcementForm').reset();
  document.getElementById('announcementForm').style.display = 'none';
  await loadAnnouncements();
}

/* ---------------------------------------------------------------------------
   QUOTE REQUESTS
   ---------------------------------------------------------------------------
   The list used to show a name, a number and the message, and that was the end
   of it -- no telling whether the man found us on Google, read three job pages
   first, or was handed the address on a location. Each request now opens, and
   what opens is the whole visit: what sent him here, where he landed, what he
   read, how long he looked before he asked, and what he was on. */

let quoteRequests = [];

const SEARCH_ENGINES = [
  ['google.', 'Google'], ['bing.', 'Bing'], ['duckduckgo.', 'DuckDuckGo'],
  ['yahoo.', 'Yahoo'], ['ecosia.', 'Ecosia'], ['search.brave.', 'Brave Search'],
  ['baidu.', 'Baidu'], ['yandex.', 'Yandex'], ['aol.', 'AOL Search']
];
const SOCIAL_SITES = [
  ['facebook.', 'Facebook'], ['fb.com', 'Facebook'], ['fb.me', 'Facebook'],
  ['instagram.', 'Instagram'], ['linkedin.', 'LinkedIn'], ['lnkd.in', 'LinkedIn'],
  ['t.co', 'X (Twitter)'], ['twitter.', 'X (Twitter)'], ['x.com', 'X (Twitter)'],
  ['youtube.', 'YouTube'], ['youtu.be', 'YouTube'], ['tiktok.', 'TikTok'],
  ['nextdoor.', 'Nextdoor'], ['reddit.', 'Reddit'], ['pinterest.', 'Pinterest']
];
const LISTING_SITES = [
  ['maps.google', 'Google Maps'], ['yelp.', 'Yelp'], ['bbb.org', 'the BBB'],
  ['thumbtack.', 'Thumbtack'], ['angi.', 'Angi'], ['manta.', 'Manta'],
  ['indeed.', 'Indeed'], ['yellowpages.', 'Yellow Pages']
];
const MAIL_SITES = [
  ['mail.google', 'Gmail'], ['outlook.', 'Outlook'], ['office.com', 'Outlook'],
  ['mail.yahoo', 'Yahoo Mail'], ['com.google.android.gm', 'the Gmail app']
];

/* Plain English for where a lead came from. A referrer is a URL, and a URL is
   not an answer to "how did this man find me". */
function howTheyFound(q) {
  const medium = (q.utm_medium || '').toLowerCase();
  const paid = !!q.click_id || /cpc|ppc|paid|display|banner/.test(medium);

  const ref = (q.referrer || '').trim();
  let host = '';
  try { host = ref ? new URL(ref).hostname.replace(/^www\./, '').toLowerCase() : ''; } catch (_) { host = ''; }

  const named = (list) => {
    for (let i = 0; i < list.length; i++) if (host.indexOf(list[i][0]) !== -1) return list[i][1];
    return '';
  };

  const engine = named(SEARCH_ENGINES);
  if (engine) return { label: paid ? engine + ' ad' : engine + ' search', kind: paid ? 'paid' : 'search' };
  const social = named(SOCIAL_SITES);
  if (social) return { label: paid ? social + ' ad' : social, kind: paid ? 'paid' : 'social' };
  const listing = named(LISTING_SITES);
  if (listing) return { label: listing, kind: 'listing' };
  const mail = named(MAIL_SITES);
  if (mail) return { label: 'A link in ' + mail, kind: 'link' };

  if (host && host.indexOf('sotaweld.com') === -1) return { label: host, kind: 'site' };

  if (paid) return { label: 'A paid ad', kind: 'paid' };
  if (q.utm_source) return { label: q.utm_source, kind: 'campaign' };

  // Nothing at all was recorded, which for an old request means the site was
  // not keeping track yet -- not that he came straight here.
  if (!q.visit_started_at) return { label: 'Not recorded', kind: 'unknown' };

  return { label: 'Came straight here', kind: 'direct' };
}

/* '/services/pipeline-welding.html' reads as a file path. Say the page. The map
   is the site as it stands; anything not in it -- a page added later, a link
   somebody made up -- still gets a readable name out of the file name. */
const PAGE_NAMES = {
  '/': 'Home page',
  '/index.html': 'Home page',
  '/services/metal-fabrication.html': 'Services: Metal Fabrication',
  '/services/mobile-field-welding.html': 'Services: Mobile & Field Welding',
  '/services/pipeline-welding.html': 'Services: Pipeline Welding',
  '/services/repair-and-maintenance.html': 'Services: Repair & Maintenance',
  '/services/structural-steel-fabrication.html': 'Services: Structural Steel Fabrication',
  '/work/cnc-fiber-laser.html': 'Our Work: CNC Fiber Laser Cutting',
  '/work/compressor-stations.html': 'Our Work: Compressor Station Piping',
  '/work/hot-tie-ins-repair-sleeves.html': 'Our Work: Hot Tie-Ins & Repair Sleeves',
  '/work/shop-field-crews.html': 'Our Work: Shop & Field Crews',
  '/work/structural-skids.html': 'Our Work: Structural & Skid Fabrication',
  '/privacy.html': 'Privacy Policy',
  '/terms.html': 'Terms of Service'
};

function pageName(path) {
  if (!path) return '';
  const clean = String(path).split('?')[0].split('#')[0];
  if (PAGE_NAMES[clean]) return PAGE_NAMES[clean];

  const file = clean.split('/').filter(Boolean).pop() || '';
  if (!file || file === 'index.html') return 'Home page';
  const section = clean.indexOf('/services/') === 0 ? 'Services: '
    : clean.indexOf('/work/') === 0 ? 'Our Work: ' : '';
  return section + file.replace(/\.html$/, '').replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function deviceOf(q) {
  const ua = q.user_agent || '';
  if (!ua) return '';
  const kind = /iPad|Tablet/i.test(ua) ? 'Tablet'
    : /iPhone|Android.*Mobile|Mobile/i.test(ua) ? 'Phone' : 'Computer';
  const os = /iPhone|iPad|iPod/i.test(ua) ? 'iPhone/iPad'
    : /Android/i.test(ua) ? 'Android'
    : /Windows/i.test(ua) ? 'Windows'
    : /Mac OS X/i.test(ua) ? 'Mac' : '';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /FBAV|FBAN/.test(ua) ? 'the Facebook app'
    : /Instagram/.test(ua) ? 'the Instagram app'
    : /CriOS|Chrome/.test(ua) ? 'Chrome'
    : /Firefox|FxiOS/.test(ua) ? 'Firefox'
    : /Safari/.test(ua) ? 'Safari' : '';
  return [kind, os, browser && 'on ' + browser].filter(Boolean).join(' · ');
}

/* How long he looked around before he asked. */
function browsedFor(q) {
  if (!q.visit_started_at || !q.created_at) return '';
  const mins = Math.round((new Date(q.created_at) - new Date(q.visit_started_at)) / 60000);
  if (!isFinite(mins) || mins < 0) return '';
  if (mins < 1) return 'Filled it out within a minute of landing';
  if (mins === 1) return 'Looked around for about a minute first';
  if (mins < 60) return 'Looked around for about ' + mins + ' minutes first';
  const hrs = Math.round(mins / 60);
  return 'Was on the site about ' + hrs + (hrs === 1 ? ' hour' : ' hours') + ' before asking';
}

async function loadQuoteRequests() {
  const list = document.getElementById('quoteRequestsList');
  const { data, error } = await sb
    .from('quote_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    list.innerHTML = '<li class="empty-state2">Quote requests could not be loaded. Reload the page.</li>';
    console.error(error);
    return;
  }
  if (!data || !data.length) {
    list.innerHTML = '<li class="empty-state2">No quote requests yet.</li>';
    return;
  }

  quoteRequests = data;

  list.innerHTML = data.map(q => {
    const src = howTheyFound(q);
    return `
    <li>
      <button type="button" class="qr-row" data-quote-id="${escapeHtml(q.id)}">
        <span class="qr-row-main">
          <span class="qr-row-name">${escapeHtml(q.name)}</span>
          <span class="qr-row-meta">${fmt(q.created_at)}${q.status && q.status !== 'new' ? ' · ' + escapeHtml(q.status) : ''}</span>
          <span class="qr-row-msg">${escapeHtml(q.message)}</span>
        </span>
        <span class="qr-row-side">
          <span class="qr-pill qr-${src.kind}">${escapeHtml(src.label)}</span>
          <span class="qr-row-open">Open</span>
        </span>
      </button>
    </li>`;
  }).join('');
}

/* Quotes written on the Quote Desk.
   A separate list from the enquiries above and deliberately so: an enquiry is
   somebody waiting to hear back, a quote is a price already sent. Mixed into
   one list the first kind gets lost among the second.

   Read-only here. The desk owns the document -- this is the copy it writes on
   every save -- so there is nothing to edit and nothing to open. */
const DQ_STATUS_LABEL = {
  draft: 'Draft', sent: 'Sent', accepted: 'Accepted',
  invoiced: 'Invoiced', paid: 'Paid', void: 'Void',
};

async function loadDeskQuotes() {
  const list = document.getElementById('deskQuotesList');
  if (!list) return;

  const { data, error } = await sb
    .from('desk_quotes')
    .select('*')
    .order('quote_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    list.innerHTML = '<li class="empty-state2">Quotes could not be loaded. Reload the page.</li>';
    console.error(error);
    return;
  }
  if (!data || !data.length) {
    list.innerHTML = '<li class="empty-state2">No quotes written yet. They appear here as you save them on the Quote Desk.</li>';
    return;
  }

  list.innerHTML = data.map(q => {
    const st = String(q.status || 'draft');
    const money = '$' + Number(q.total || 0).toLocaleString('en-US',
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const who = q.customer_name || 'No company';
    const job = q.job_name ? ' \u00b7 ' + escapeHtml(q.job_name) : '';
    return `
    <li>
      <div class="dq-row">
        <span class="dq-row-main">
          <span class="dq-row-name">${escapeHtml(who)}${job}</span>
          <span class="dq-row-meta">${escapeHtml(q.quote_no || 'unnumbered')}${q.quote_date ? ' \u00b7 ' + escapeHtml(q.quote_date) : ''}${q.invoiced_no ? ' \u00b7 invoice ' + escapeHtml(q.invoiced_no) : ''}</span>
          ${q.scope ? `<span class="dq-row-msg">${escapeHtml(q.scope)}</span>` : ''}
        </span>
        <span class="dq-row-side">
          <span class="dq-pill dq-${escapeHtml(st)}">${escapeHtml(DQ_STATUS_LABEL[st] || st)}</span>
          <span class="dq-row-total">${money}</span>
        </span>
      </div>
    </li>`;
  }).join('');
}

function fieldRow(label, value) {
  if (!value) return '';
  return `<div class="qr-f"><div class="qr-f-k">${escapeHtml(label)}</div><div class="qr-f-v">${value}</div></div>`;
}

function openQuote(id) {
  const q = quoteRequests.find(r => r.id === id);
  if (!q) return;
  const src = howTheyFound(q);
  const body = document.getElementById('quoteSheetBody');

  const campaign = [
    q.utm_source && 'source ' + q.utm_source,
    q.utm_medium && 'medium ' + q.utm_medium,
    q.utm_campaign && 'campaign ' + q.utm_campaign,
    q.utm_term && 'term ' + q.utm_term,
    q.utm_content && 'ad ' + q.utm_content
  ].filter(Boolean).join(' · ');

  const pages = (q.pages_seen || []).map(pageName).filter(Boolean);
  const walked = pages.length
    ? '<ol class="qr-trail">' + pages.map(p => `<li>${escapeHtml(p)}</li>`).join('') + '</ol>'
    : '';

  const nothingKnown = !q.visit_started_at && !q.referrer && !q.landing_page;

  body.innerHTML = `
    <div class="qr-head">
      <h3 id="qrName">${escapeHtml(q.name)}</h3>
      <div class="qr-when">${fmt(q.created_at)}</div>
    </div>

    <div class="qr-actions">
      <a class="btn2 btn2-solid small" href="tel:${escapeHtml(q.phone)}">Call ${escapeHtml(q.phone)}</a>
      <a class="btn2 btn2-line small" href="sms:${escapeHtml(q.phone)}">Text</a>
      ${q.email ? `<a class="btn2 btn2-line small" href="mailto:${escapeHtml(q.email)}">Email</a>` : ''}
    </div>
    ${q.email ? `<div class="qr-email">${escapeHtml(q.email)}</div>` : ''}

    <div class="qr-sec-h">What he is asking for</div>
    <div class="qr-msg">${escapeHtml(q.message)}</div>

    <div class="qr-sec-h">How he got to you</div>
    ${nothingKnown
      ? `<p class="qr-none">This request came in before the site started keeping track, so there is nothing to show. Everything from here on will have it.</p>`
      : `<div class="qr-fields">
          ${fieldRow('Found you through', `<span class="qr-pill qr-${src.kind}">${escapeHtml(src.label)}</span>`)}
          ${fieldRow('Landed on', escapeHtml(pageName(q.landing_page) || q.landing_page || ''))}
          ${fieldRow('Filled the form on', escapeHtml(pageName(q.source_page) || q.source_page || ''))}
          ${fieldRow('Time on the site', escapeHtml(browsedFor(q)))}
          ${fieldRow('Ad or campaign', escapeHtml(campaign))}
          ${fieldRow('Ad click id', escapeHtml(q.click_id || ''))}
          ${fieldRow('Was on', escapeHtml([deviceOf(q), q.screen_size].filter(Boolean).join(' · ')))}
          ${fieldRow('Pages he read (' + pages.length + ')', walked)}
          ${fieldRow('Link he came in on', q.referrer ? `<span class="qr-raw">${escapeHtml(q.referrer)}</span>` : '')}
          ${fieldRow('Landing page tags', q.landing_query ? `<span class="qr-raw">${escapeHtml(q.landing_query)}</span>` : '')}
        </div>`}
  `;

  document.getElementById('quoteSheet').hidden = false;
  document.body.classList.add('qr-open');
}

function closeQuote() {
  document.getElementById('quoteSheet').hidden = true;
  document.body.classList.remove('qr-open');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

(async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  currentProfile = await loadProfile(currentUser.id);

  document.getElementById('userName').textContent = currentProfile ? currentProfile.full_name : currentUser.email;

  const isAdmin = currentProfile && currentProfile.role === 'admin';
  if (isAdmin) {
    document.getElementById('adminBadge').style.display = 'inline-block';
    document.getElementById('adminNavLinks').style.display = 'inline';
    document.getElementById('postAnnouncementWrap').style.display = 'inline-block';
    document.getElementById('quoteRequestsCard').style.display = 'block';
    document.getElementById('deskQuotesCard').style.display = 'block';
  }

  document.getElementById('quoteRequestsList').addEventListener('click', (e) => {
    const row = e.target.closest('[data-quote-id]');
    if (row) openQuote(row.dataset.quoteId);
  });
  document.getElementById('quoteSheet').addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeQuote();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('quoteSheet').hidden) closeQuote();
  });

  document.getElementById('logoutBtn').addEventListener('click', async (e) => {
    e.preventDefault();
    await sb.auth.signOut();
    window.location.href = 'login.html';
  });

  document.getElementById('announcementForm').addEventListener('submit', handleAnnouncementSubmit);
  document.getElementById('newAnnouncementBtn')?.addEventListener('click', () => {
    const form = document.getElementById('announcementForm');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
  });

  await loadAnnouncements();
  if (isAdmin) await Promise.all([loadQuoteRequests(), loadDeskQuotes()]);

  await liveData({
    reload: async () => {
      await loadAnnouncements();
      if (isAdmin) await Promise.all([loadQuoteRequests(), loadDeskQuotes()]);
    },
    isBusy: () => document.getElementById('announcementForm').style.display === 'block',
    tables: isAdmin ? ['announcements', 'quote_requests', 'desk_quotes'] : ['announcements'],
    channel: 'dashboard'
  });
})();
