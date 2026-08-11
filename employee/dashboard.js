let currentUser = null;
let currentProfile = null;
let openEntry = null;

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

async function refreshClockStatus() {
  const { data, error } = await sb
    .from('time_entries')
    .select('*')
    .eq('employee_id', currentUser.id)
    .is('clock_out', null)
    .order('clock_in', { ascending: false })
    .limit(1);

  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const clockBtn = document.getElementById('clockBtn');

  if (error) {
    statusText.textContent = 'Error loading status';
    return;
  }

  openEntry = data && data.length ? data[0] : null;

  if (openEntry) {
    statusDot.classList.add('on');
    statusText.textContent = 'Clocked in since ' + fmt(openEntry.clock_in);
    clockBtn.textContent = 'Clock Out';
  } else {
    statusDot.classList.remove('on');
    statusText.textContent = 'Clocked out';
    clockBtn.textContent = 'Clock In';
  }
  clockBtn.disabled = false;
}

async function handleClockToggle() {
  const clockBtn = document.getElementById('clockBtn');
  clockBtn.disabled = true;

  if (openEntry) {
    await sb.from('time_entries').update({ clock_out: new Date().toISOString() }).eq('id', openEntry.id);
  } else {
    await sb.from('time_entries').insert({ employee_id: currentUser.id });
  }

  await refreshClockStatus();
}

async function loadJobEntries() {
  const list = document.getElementById('jobList');
  const { data, error } = await sb
    .from('job_logs')
    .select('*')
    .eq('employee_id', currentUser.id)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error || !data || !data.length) {
    list.innerHTML = '<li class="empty-state">No entries yet.</li>';
    return;
  }

  list.innerHTML = data.map(entry => `
    <li>
      <strong>${escapeHtml(entry.job_name)}</strong>
      <div class="entry-meta">${fmt(entry.created_at)}</div>
      ${entry.description ? `<div>${escapeHtml(entry.description)}</div>` : ''}
      ${entry.photo_url ? `<img class="job-photo-preview" src="${entry.photo_url}" alt="Job photo">` : ''}
    </li>
  `).join('');
}

async function handleJobSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('jobSubmitBtn');
  const errEl = document.getElementById('jobError');
  errEl.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Submitting...';

  const jobName = document.getElementById('jobName').value.trim();
  const jobDesc = document.getElementById('jobDesc').value.trim();
  const fileInput = document.getElementById('jobPhoto');
  const file = fileInput.files[0];

  let photoUrl = null;

  try {
    if (file) {
      const path = `${currentUser.id}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await sb.storage.from('job-photos').upload(path, file);
      if (uploadError) throw uploadError;
      const { data: publicUrlData } = sb.storage.from('job-photos').getPublicUrl(path);
      photoUrl = publicUrlData.publicUrl;
    }

    const { error: insertError } = await sb.from('job_logs').insert({
      employee_id: currentUser.id,
      job_name: jobName,
      description: jobDesc || null,
      photo_url: photoUrl
    });
    if (insertError) throw insertError;

    document.getElementById('jobForm').reset();
    await loadJobEntries();
  } catch (err) {
    errEl.textContent = 'Something went wrong. Please try again.';
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit Entry';
  }
}

async function loadAnnouncements() {
  const listEl = document.getElementById('announcementList');
  const { data, error } = await sb
    .from('announcements')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error || !data || !data.length) {
    listEl.innerHTML = '<p class="empty-state">No announcements yet.</p>';
    return;
  }

  listEl.innerHTML = data.map(a => `
    <div class="announcement-item">
      <h3>${escapeHtml(a.title)}</h3>
      <p>${escapeHtml(a.body)}</p>
      <div class="date">${fmt(a.created_at)}</div>
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

  if (currentProfile && currentProfile.role === 'admin') {
    document.getElementById('adminBadge').style.display = 'inline-block';
    document.getElementById('postAnnouncementWrap').style.display = 'inline-block';
  }

  document.getElementById('logoutBtn').addEventListener('click', async (e) => {
    e.preventDefault();
    await sb.auth.signOut();
    window.location.href = 'login.html';
  });

  document.getElementById('clockBtn').addEventListener('click', handleClockToggle);
  document.getElementById('jobForm').addEventListener('submit', handleJobSubmit);
  document.getElementById('announcementForm').addEventListener('submit', handleAnnouncementSubmit);
  document.getElementById('newAnnouncementBtn')?.addEventListener('click', () => {
    const form = document.getElementById('announcementForm');
    form.style.display = form.style.display === 'none' ? 'flex' : 'none';
    form.style.flexDirection = 'column';
  });

  await refreshClockStatus();
  await loadJobEntries();
  await loadAnnouncements();
})();
