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
}

requestMe().then((user) => {
  if (user) {
    applyLoggedInState(user);
  } else {
    applyLoggedOutState();
  }
});
