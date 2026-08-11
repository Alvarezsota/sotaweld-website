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

async function loadQuoteRequests() {
  const list = document.getElementById('quoteRequestsList');
  const { data, error } = await sb
    .from('quote_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error || !data || !data.length) {
    list.innerHTML = '<li class="empty-state2">No quote requests yet.</li>';
    return;
  }

  list.innerHTML = data.map(q => `
    <li>
      <strong>${escapeHtml(q.name)}</strong> &middot; <a href="tel:${escapeHtml(q.phone)}">${escapeHtml(q.phone)}</a>${q.email ? ` &middot; <a href="mailto:${escapeHtml(q.email)}">${escapeHtml(q.email)}</a>` : ''}
      <div class="entry-meta2">${fmt(q.created_at)} &middot; status: ${escapeHtml(q.status)}</div>
      <div>${escapeHtml(q.message)}</div>
    </li>
  `).join('');
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
  }

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
  if (isAdmin) await loadQuoteRequests();
})();
