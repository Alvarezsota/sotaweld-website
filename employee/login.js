(async function () {
  const initialHash = window.location.hash;
  const isInviteOrRecovery = /type=invite|type=recovery/.test(initialHash);

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

      window.location.href = 'dashboard.html';
    });
    return;
  }

  if (session) {
    window.location.href = 'dashboard.html';
    return;
  }

  const errorMsg = document.getElementById('errorMsg');
  const loginBtn = document.getElementById('loginBtn');

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorMsg.textContent = '';
    loginBtn.disabled = true;
    loginBtn.textContent = 'Logging in...';

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    const { error } = await sb.auth.signInWithPassword({ email, password });

    if (error) {
      errorMsg.textContent = 'Incorrect email or password.';
      loginBtn.disabled = false;
      loginBtn.textContent = 'Log In';
      return;
    }

    window.location.href = 'dashboard.html';
  });
})();
