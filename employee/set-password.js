// Where an invited welder lands from the emailed link.
//
// Supabase puts a one-time token in the URL when the link is opened. The client
// is created with the defaults, so it picks that up and establishes a session by
// itself — this page's job is only to take a password and set it.
//
// A man who follows a stale link must not be left staring at a dead form, so
// every failure path here says what happened and what to do about it.

const body = document.getElementById('body');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderExpired(detail) {
  body.innerHTML = `
    <p class="login-error">This invite link cannot be used.</p>
    <p class="login-sub">${esc(detail)}</p>
    <p class="login-sub">Ask the office to send you a new one, then open the newest email.</p>
    <a class="btn2 btn2-line" href="login.html">Back to sign in</a>`;
}

function renderForm(email) {
  document.getElementById('whoFor').textContent = email || 'State of the Arc Welding & Services';
  body.innerHTML = `
    <p class="login-sub">Pick a password you will remember. At least 8 characters.</p>
    <form id="pwForm">
      <label class="field-label" for="pw1">New password</label>
      <input class="input" id="pw1" type="password" autocomplete="new-password" minlength="8" required>
      <label class="field-label" for="pw2">Type it again</label>
      <input class="input" id="pw2" type="password" autocomplete="new-password" minlength="8" required>
      <p class="error-msg2" id="err"></p>
      <button class="btn2 btn2-solid" id="saveBtn" type="submit">Save password and sign in</button>
    </form>`;

  const pw1 = document.getElementById('pw1');
  const pw2 = document.getElementById('pw2');
  const err = document.getElementById('err');
  const btn = document.getElementById('saveBtn');
  pw1.focus();

  document.getElementById('pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    if (pw1.value.length < 8) { err.textContent = 'Use at least 8 characters.'; pw1.focus(); return; }
    if (pw1.value !== pw2.value) { err.textContent = 'Those two do not match.'; pw2.focus(); return; }

    btn.disabled = true; btn.textContent = 'Saving...';
    const { error } = await sb.auth.updateUser({ password: pw1.value });
    if (error) {
      err.textContent = error.message || 'Could not save that password. Try again.';
      btn.disabled = false; btn.textContent = 'Save password and sign in';
      return;
    }
    // The invite session is already a signed-in session, so there is nothing
    // further to do — send them straight to the work they were invited for.
    window.location.href = 'daily-entry.html';
  });
}

(async () => {
  // An error can come back in the URL itself (expired, already used). Read both
  // the hash and the query, because Supabase has used each over time.
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(location.search);
  const urlErr = hash.get('error_description') || query.get('error_description')
              || hash.get('error') || query.get('error');
  if (urlErr) { renderExpired(decodeURIComponent(urlErr.replace(/\+/g, ' '))); return; }

  // Give the client a moment to exchange the token in the URL for a session.
  let session = null;
  for (let i = 0; i < 20 && !session; i++) {
    const { data } = await sb.auth.getSession();
    session = data?.session || null;
    if (!session) await new Promise((r) => setTimeout(r, 100));
  }

  if (!session) {
    renderExpired('The link may have expired, or it may already have been used.');
    return;
  }
  renderForm(session.user?.email || '');
})();
