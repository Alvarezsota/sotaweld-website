(async function () {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    window.location.href = 'dashboard.html';
    return;
  }

  const form = document.getElementById('loginForm');
  const errorMsg = document.getElementById('errorMsg');
  const loginBtn = document.getElementById('loginBtn');

  form.addEventListener('submit', async (e) => {
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
