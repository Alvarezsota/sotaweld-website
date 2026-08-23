// Two-step sign-in (TOTP) for the crew portal.
//
// Deliberately opt-in and per-account: enrolling here only affects the person
// signed in. Nobody is forced into it and no welder is affected, because only
// accounts with a verified factor are challenged at login.
//
// Losing the phone is not a lockout: the office can clear a factor with the
// service role, so there is always a way back in.

let currentUser = null;
let currentProfile = null;
let pendingFactorId = null;

const body = document.getElementById('body');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function verifiedFactors() {
  const { data, error } = await sb.auth.mfa.listFactors();
  if (error) throw error;
  return (data?.totp ?? []).filter((f) => f.status === 'verified');
}

function renderEnrolled(factors) {
  body.innerHTML = `
    <div class="sec-card on">
      <div class="sec-state">
        <span class="sec-dot on"></span>
        <div>
          <b>Two-step sign-in is on</b>
          <span>You will be asked for a code from your authenticator app each time you sign in.</span>
        </div>
      </div>
      <table class="sec-table">
        <tr><th>Device</th><th>Added</th><th></th></tr>
        ${factors.map((f) => `
          <tr>
            <td>${esc(f.friendly_name || 'Authenticator app')}</td>
            <td>${new Date(f.created_at).toLocaleDateString()}</td>
            <td style="text-align:right">
              <button class="btn2 btn2-danger small" data-remove="${esc(f.id)}">Remove</button>
            </td>
          </tr>`).join('')}
      </table>
      <p class="sec-note">Removing your last device turns two-step sign-in off. If you have lost
         your phone and cannot get a code, call the office and it can be cleared for you.</p>
    </div>`;

  body.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Turn off two-step sign-in for your account?')) return;
      btn.disabled = true;
      const { error } = await sb.auth.mfa.unenroll({ factorId: btn.dataset.remove });
      if (error) { alert('Could not remove it: ' + error.message); btn.disabled = false; return; }
      load();
    });
  });
}

function renderOff() {
  body.innerHTML = `
    <div class="sec-card">
      <div class="sec-state">
        <span class="sec-dot"></span>
        <div>
          <b>Two-step sign-in is off</b>
          <span>Your account is protected by a password only.</span>
        </div>
      </div>
      <p class="sec-note">You will need an authenticator app on your phone &mdash; Google
         Authenticator, Microsoft Authenticator or Authy all work and are free.</p>
      <button class="btn2 btn2-solid" id="startBtn">Turn it on</button>
    </div>`;
  document.getElementById('startBtn').addEventListener('click', startEnrol);
}

async function startEnrol() {
  body.innerHTML = '<div class="sec-loading">Setting up&hellip;</div>';

  // A previous half-finished attempt would block a new one, so clear any
  // unverified factor before enrolling again.
  const { data: existing } = await sb.auth.mfa.listFactors();
  for (const f of (existing?.totp ?? [])) {
    if (f.status !== 'verified') await sb.auth.mfa.unenroll({ factorId: f.id });
  }

  const { data, error } = await sb.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'Authenticator ' + new Date().toLocaleDateString(),
  });
  if (error) {
    body.innerHTML = `<div class="sec-error">Could not start setup.<br><span>${esc(error.message)}</span></div>`;
    return;
  }

  pendingFactorId = data.id;
  body.innerHTML = `
    <div class="sec-card">
      <b class="sec-step">Step 1 &mdash; scan this with your authenticator app</b>
      <div class="sec-qr">${data.totp.qr_code}</div>
      <p class="sec-note">Cannot scan it? Type this key into the app instead:<br>
         <code class="sec-secret">${esc(data.totp.secret)}</code></p>

      <b class="sec-step">Step 2 &mdash; enter the six digits it shows</b>
      <input class="input sec-code" id="code" inputmode="numeric" autocomplete="one-time-code"
             maxlength="6" placeholder="000000">
      <p class="sec-error-msg" id="err"></p>
      <div class="sec-actions">
        <button class="btn2 btn2-solid" id="verifyBtn">Turn on two-step sign-in</button>
        <button class="btn2 btn2-ghost" id="cancelBtn">Cancel</button>
      </div>
    </div>`;

  const code = document.getElementById('code');
  const err = document.getElementById('err');
  code.focus();

  document.getElementById('cancelBtn').addEventListener('click', async () => {
    if (pendingFactorId) await sb.auth.mfa.unenroll({ factorId: pendingFactorId });
    pendingFactorId = null;
    load();
  });

  const submit = async () => {
    const value = code.value.replace(/\D/g, '');
    if (value.length !== 6) { err.textContent = 'Enter the six digits from the app.'; return; }
    const btn = document.getElementById('verifyBtn');
    btn.disabled = true; btn.textContent = 'Checking...';
    err.textContent = '';

    const { error: vErr } = await sb.auth.mfa.challengeAndVerify({
      factorId: pendingFactorId, code: value,
    });
    if (vErr) {
      err.textContent = 'That code was not accepted. Codes change every 30 seconds - try the current one.';
      btn.disabled = false; btn.textContent = 'Turn on two-step sign-in';
      return;
    }
    pendingFactorId = null;
    load();
  };

  document.getElementById('verifyBtn').addEventListener('click', submit);
  code.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}

async function load() {
  try {
    const factors = await verifiedFactors();
    factors.length ? renderEnrolled(factors) : renderOff();
  } catch (e) {
    body.innerHTML = `<div class="sec-error">Could not read your security settings.<br>
                      <span>${esc(e.message || e)}</span></div>`;
  }
}

(async function init() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return; }
  currentUser = session.user;

  const { data: profile } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
  currentProfile = profile;
  document.getElementById('userName').textContent = profile ? profile.full_name : currentUser.email;
  if (profile && profile.role === 'admin') {
    document.getElementById('adminBadge').style.display = 'inline-block';
    document.getElementById('adminNavLinks').style.display = 'inline';
  }

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await sb.auth.signOut();
    window.location.href = 'login.html';
  });

  load();
})();
