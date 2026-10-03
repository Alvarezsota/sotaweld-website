(async function () {
  const initialHash = window.location.hash;
  const isInviteOrRecovery = /type=invite|type=recovery|type=signup/.test(initialHash);

  const { data: { session } } = await sb.auth.getSession();

  const loginForm = document.getElementById('loginForm');
  const setPasswordForm = document.getElementById('setPasswordForm');

  if (session && isInviteOrRecovery) {
    loginForm.style.display = 'none';
    setPasswordForm.style.display = 'flex';
    setPasswordForm.style.flexDirection = 'column';

    setPasswordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorEl = document.getElementById('setPasswordError');
      const btn = document.getElementById('setPasswordBtn');
      errorEl.textContent = '';

      const pw1 = document.getElementById('newPassword').value;
      const pw2 = document.getElementById('confirmPassword').value;

      if (pw1 !== pw2) {
        errorEl.textContent = 'Passwords do not match.';
        return;
      }
      if (pw1.length < 6) {
        errorEl.textContent = 'Password must be at least 6 characters.';
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Saving...';

      const { error } = await sb.auth.updateUser({ password: pw1 });

      if (error) {
        errorEl.textContent = 'Something went wrong. Please try again.';
        btn.disabled = false;
        btn.textContent = 'Set Password & Continue';
        return;
      }

      window.location.href = await landingPageFor(session.user.id);
    });
    return;
  }

  if (session) {
    window.location.href = await landingPageFor(session.user.id);
    return;
  }

  const errorMsg = document.getElementById('errorMsg');
  const loginBtn = document.getElementById('loginBtn');

  // Put out by the door guard rather than by logging out. Say why, once --
  // otherwise it reads as the app having dropped him for no reason.
  const putOut = sessionStorage.getItem('sotaSignedOutReason');
  if (putOut) {
    sessionStorage.removeItem('sotaSignedOutReason');
    errorMsg.textContent = putOut;
  }

  /* A way back in without ringing the office.
   *
   * An invite link lasts a day. Aldo Galindo was invited one afternoon, did not
   * open it before it went stale, and by the next morning had no password and no
   * way to make one -- there was nothing on this page to help him. Gilbert had to
   * come and ask for the account to be reset by hand, which is not a thing that
   * should need a person.
   *
   * It lands on set-password.html, which already knows how to take the one-time
   * token out of the link and set a password with it.
   *
   * The answer is deliberately the same whether or not the address is one of
   * ours: a login page that says "no such man here" tells anybody who asks which
   * of your crew's addresses are real. */
  const forgotBtn = document.getElementById('forgotBtn');
  const forgotMsg = document.getElementById('forgotMsg');
  if (forgotBtn) {
    forgotBtn.addEventListener('click', async () => {
      const email = document.getElementById('email').value.trim();
      const errorEl = document.getElementById('errorMsg');
      errorEl.textContent = '';
      forgotMsg.style.display = 'none';

      if (!email) {
        errorEl.textContent = 'Type your email above first, then tap this again.';
        document.getElementById('email').focus();
        return;
      }

      forgotBtn.disabled = true;
      forgotBtn.textContent = 'Sending\u2026';
      try {
        await sb.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + '/employee/set-password.html',
        });
      } catch (_) {
        /* say the same thing either way -- see above */
      }
      forgotMsg.textContent = 'If that address is on the crew, a link to set a new password '
        + 'is on its way to it. It is good for one hour. Check junk mail if it is not there.';
      forgotMsg.style.display = '';
      forgotBtn.disabled = false;
      forgotBtn.textContent = 'Forgot your password?';
    });
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorMsg.textContent = '';
    loginBtn.disabled = true;
    loginBtn.textContent = 'Logging in...';

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    const { error } = await sb.auth.signInWithPassword({ email, password });

    if (error) {
      const closed = /banned|disabled|blocked/i.test(String(error.message || ''));
      errorMsg.textContent = closed
        ? 'Your access has been turned off. Call the office on (432) 248-1455.'
        : 'Incorrect email or password.';
      loginBtn.disabled = false;
      loginBtn.textContent = 'Log In';
      return;
    }

    // Password accepted. If this account has two-step sign-in, Supabase reports
    // that a higher assurance level is still needed - ask for the code before
    // letting them through.
    // If this check itself fails, do not strand someone who has just given a
    // correct password. Their session is still only aal1, so anything that
    // requires the second factor stays refused server-side regardless.
    try {
      const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal && aal.nextLevel === 'aal2' && aal.nextLevel !== aal.currentLevel) {
        showMfaStep();
        return;
      }
    } catch (err) {
      console.warn('Could not check two-step status; continuing with password only', err);
    }

    const { data: { user } } = await sb.auth.getUser();
    window.location.href = user ? await landingPageFor(user.id) : 'daily-entry.html';
  });

  function showMfaStep() {
    loginForm.style.display = 'none';
    const mfaForm = document.getElementById('mfaForm');
    const mfaCode = document.getElementById('mfaCode');
    const mfaError = document.getElementById('mfaError');
    const mfaBtn = document.getElementById('mfaBtn');
    mfaForm.style.display = 'block';
    mfaCode.focus();

    mfaForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = mfaCode.value.replace(/\D/g, '');
      if (code.length !== 6) { mfaError.textContent = 'Enter the six digits from the app.'; return; }

      mfaBtn.disabled = true; mfaBtn.textContent = 'Checking...';
      mfaError.textContent = '';

      const { data: factors } = await sb.auth.mfa.listFactors();
      const factor = (factors?.totp ?? []).find((f) => f.status === 'verified');
      if (!factor) {
        mfaError.textContent = 'No authenticator is set up on this account. Call the office.';
        mfaBtn.disabled = false; mfaBtn.textContent = 'Continue';
        return;
      }

      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
      if (error) {
        // A wrong code must not leave a half-signed-in session behind.
        mfaError.textContent = 'That code was not accepted. Codes change every 30 seconds.';
        mfaBtn.disabled = false; mfaBtn.textContent = 'Continue';
        mfaCode.value = '';
        mfaCode.focus();
        return;
      }

      const { data: { user } } = await sb.auth.getUser();
      window.location.href = user ? await landingPageFor(user.id) : 'daily-entry.html';
    });
  }
})();
