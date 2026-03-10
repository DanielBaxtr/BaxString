async function requestMe() {
  try {
    const response = await fetch('/api/me', { credentials: 'same-origin' });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.user || null;
  } catch {
    return null;
  }
}

function applyLoggedOutState() {
  const loginLinks = document.querySelectorAll('.login-link, .footer-login');
  loginLinks.forEach((link) => {
    if (link.tagName !== 'A') return;
    link.textContent = 'Logg inn';
    link.setAttribute('href', './login.html');
  });
}

function applyLoggedInState(user) {
  const loginLinks = document.querySelectorAll('.login-link, .footer-login');
  loginLinks.forEach((link) => {
    if (link.tagName !== 'A') return;
    link.textContent = user?.name ? `Min side (${user.name})` : 'Min side';
    link.setAttribute('href', './add-listing.html');
  });

  const navActions = document.querySelector('.nav-actions');
  if (!navActions || navActions.querySelector('#nav-logout-btn')) return;

  const logoutBtn = document.createElement('button');
  logoutBtn.id = 'nav-logout-btn';
  logoutBtn.className = 'login-link nav-logout-btn';
  logoutBtn.type = 'button';
  logoutBtn.textContent = 'Logg ut';
  logoutBtn.style.border = '0';
  logoutBtn.style.background = 'transparent';
  logoutBtn.style.cursor = 'pointer';
  logoutBtn.addEventListener('click', async () => {
    try {
      await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
    } catch {
      // Ignore and refresh UI anyway.
    }
    window.location.reload();
  });

  navActions.prepend(logoutBtn);
}

requestMe().then((user) => {
  if (user) {
    applyLoggedInState(user);
  } else {
    applyLoggedOutState();
  }
});
