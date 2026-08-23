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

  // A half-finished attempt blocks a new one, and listFactors() reports only
  // VERIFIED factors under .totp - so the abandoned unverified factor was
  // invisible to the cleanup and its name collided on the next try. Use .all
  // when the library provides it, and give each attempt a unique name so a
  // collision cannot strand enrolment even if cleanup fails.
  const { data: existing } = await sb.auth.mfa.listFactors();
  const known = existing?.all ?? existing?.totp ?? [];
  for (const f of known) {
    if (f.status !== 'verified') {
      await sb.auth.mfa.unenroll({ factorId: f.id }).catch(() => {});
    }
  }

  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const { data, error } = await sb.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `Authenticator ${stamp}`,
  });
  if (error) {
    const collision = /already exists/i.test(error.message || '');
    body.innerHTML = `<div class="sec-error">Could not start setup.<br>
      <span>${esc(error.message)}</span>
      ${collision ? `<br><br><button class="btn2 btn2-line small" id="retryBtn">Clear it and try again</button>` : ''}
    </div>`;
    if (collision) {
      document.getElementById('retryBtn').addEventListener('click', startEnrol);
    }
    return;
  }

  pendingFactorId = data.id;

  // Supabase returns totp.qr_code in different shapes depending on version -
  // sometimes raw SVG, sometimes a data: URI - and injecting the wrong one
  // silently produces an unscannable box. Draw it from totp.uri instead, which
  // is always the plain otpauth:// string, and keep their version as a fallback.
  const uri = data.totp.uri || '';
  const raw = data.totp.qr_code || '';
  let qrMarkup;
  if (raw.trim().startsWith('<svg')) {
    qrMarkup = raw;
  } else if (raw.startsWith('data:')) {
    qrMarkup = `<img alt="Setup QR code" src="${esc(raw)}">`;
  } else {
    qrMarkup = '<div class="sec-qr-pending">Drawing code&hellip;</div>';
  }

  body.innerHTML = `
    <div class="sec-card">
      <b class="sec-step">Step 1 &mdash; get the code onto your phone</b>
      <div class="sec-qr" id="qrBox">${qrMarkup}</div>

      <p class="sec-note">On your phone? Skip the scanning &mdash;
         <a class="sec-open" id="openApp" href="${esc(uri)}">tap here to open your authenticator app</a>.</p>

      <p class="sec-note">Or type this key into the app by hand:<br>
         <code class="sec-secret" id="secretText">${esc(data.totp.secret)}</code>
         <button class="btn2 btn2-ghost small" id="copyBtn" type="button">Copy</button></p>

      <b class="sec-step">Step 2 &mdash; enter the six digits it shows</b>
      <input class="input sec-code" id="code" inputmode="numeric" autocomplete="one-time-code"
             maxlength="6" placeholder="000000">
      <p class="sec-error-msg" id="err"></p>
      <div class="sec-actions">
        <button class="btn2 btn2-solid" id="verifyBtn">Turn on two-step sign-in</button>
        <button class="btn2 btn2-ghost" id="cancelBtn">Cancel</button>
      </div>
    </div>`;

  // Draw the QR ourselves so it does not depend on Supabase's format.
  if (uri) drawQr(uri);

  document.getElementById('copyBtn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(data.totp.secret);
      document.getElementById('copyBtn').textContent = 'Copied';
    } catch {
      // Clipboard is blocked in some webviews; select it so it can be copied by hand.
      const r = document.createRange();
      r.selectNodeContents(document.getElementById('secretText'));
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    }
  });

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


/** Draws the otpauth URI as a QR code. Loads the library only when enrolling. */
async function drawQr(uri) {
  const box = document.getElementById('qrBox');
  try {
    if (!window.QRCode) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js';
        s.onload = resolve;
        s.onerror = () => reject(new Error('could not load the QR library'));
        document.head.appendChild(s);
      });
    }
    const url = await window.QRCode.toDataURL(uri, {
      width: 380, margin: 1,
      color: { dark: '#000000', light: '#ffffff' },   // plain black on white scans best
    });
    box.innerHTML = `<img alt="Setup QR code" src="${url}">`;
  } catch (e) {
    // Not fatal: the key can still be typed in by hand.
    if (box && !box.querySelector('img, svg')) {
      box.innerHTML = '<div class="sec-qr-pending">Could not draw the code &mdash; ' +
                      'use the key below or the tap-to-open link.</div>';
    }
  }
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
