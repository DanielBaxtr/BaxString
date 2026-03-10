const ROLE_KEY = 'rmr_roles_v1';

function safeParse(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function readRoleMap() {
  return safeParse(localStorage.getItem(ROLE_KEY), {});
}

function saveRoleMap(roleMap) {
  localStorage.setItem(ROLE_KEY, JSON.stringify(roleMap));
}

function sanitizeRole(role) {
  return role === 'stringer' || role === 'customer' ? role : '';
}

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

function parsePrice(value) {
  const raw = String(value || '').trim();
  if (!raw) return NaN;
  const normalized = raw.replace(/\s+/g, '').replace(',', '.');
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : NaN;
}

function showStatus(element, message, type = '') {
  if (!element) return;
  element.textContent = message;
  element.classList.remove('error', 'success');
  if (type) element.classList.add(type);
}

function safeNextParam(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return './index.html';
  if (!value.startsWith('./')) return './index.html';
  if (value.includes('//')) return './index.html';
  return value;
}

function nextQuery(nextPath) {
  return `?next=${encodeURIComponent(nextPath)}`;
}

function goTo(path) {
  window.location.href = path;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  return { ok: response.ok, status: response.status, data };
}

async function getCurrentUser() {
  const { ok, data } = await requestJson('/api/me');
  if (!ok || !data?.user) {
    return null;
  }
  return data.user;
}

function getUserRole(email) {
  const key = normalizeEmail(email);
  if (!key) return '';
  const roleMap = readRoleMap();
  return sanitizeRole(roleMap[key]);
}

function setUserRole(email, role) {
  const key = normalizeEmail(email);
  if (!key) return;

  const nextRole = sanitizeRole(role);
  const roleMap = readRoleMap();

  if (!nextRole) {
    delete roleMap[key];
  } else {
    roleMap[key] = nextRole;
  }

  saveRoleMap(roleMap);
}

function initLoginPage() {
  const form = document.getElementById('login-form');
  if (!form) return;

  const emailInput = document.getElementById('login-email');
  const passwordInput = document.getElementById('login-password');
  const status = document.getElementById('auth-message');
  const registerLink = document.getElementById('to-register-link');

  const params = new URLSearchParams(window.location.search);
  const nextPath = safeNextParam(params.get('next'));
  if (registerLink) {
    registerLink.href = `./register.html${nextQuery(nextPath)}`;
  }

  getCurrentUser().then((user) => {
    if (user) {
      showStatus(status, `Du er allerede logget inn som ${user.email}.`, 'success');
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const email = normalizeEmail(emailInput.value);
    const password = String(passwordInput.value || '');

    if (!validEmail(email) || !password) {
      showStatus(status, 'Skriv inn gyldig e-post og passord.', 'error');
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Logger inn...';
    }

    try {
      const { ok, data } = await requestJson('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      if (!ok) {
        showStatus(status, data.error || 'Innlogging feilet.', 'error');
        return;
      }

      showStatus(status, 'Innlogging vellykket. Sender deg videre...', 'success');
      setTimeout(() => goTo(nextPath), 250);
    } catch {
      showStatus(status, 'Kunne ikke kontakte server.', 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Logg inn';
      }
    }
  });
}

function initRegisterPage() {
  const form = document.getElementById('register-form');
  if (!form) return;

  const nameInput = document.getElementById('register-name');
  const emailInput = document.getElementById('register-email');
  const passwordInput = document.getElementById('register-password');
  const confirmInput = document.getElementById('register-password-confirm');
  const status = document.getElementById('auth-message');
  const loginLink = document.getElementById('to-login-link');

  const params = new URLSearchParams(window.location.search);
  const nextPath = safeNextParam(params.get('next'));
  if (loginLink) {
    loginLink.href = `./login.html${nextQuery(nextPath)}`;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const name = String(nameInput.value || '').trim();
    const email = normalizeEmail(emailInput.value);
    const password = String(passwordInput.value || '');
    const confirmPassword = String(confirmInput.value || '');

    if (name.length < 2) {
      showStatus(status, 'Skriv inn fullt navn.', 'error');
      return;
    }

    if (!validEmail(email)) {
      showStatus(status, 'Skriv inn en gyldig e-postadresse.', 'error');
      return;
    }

    if (password.length < 8) {
      showStatus(status, 'Passord må ha minst 8 tegn.', 'error');
      return;
    }

    if (password !== confirmPassword) {
      showStatus(status, 'Passordene matcher ikke.', 'error');
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Oppretter bruker...';
    }

    try {
      const { ok, data } = await requestJson('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password })
      });

      if (!ok) {
        showStatus(status, data.error || 'Registrering feilet.', 'error');
        return;
      }

      showStatus(status, 'Bruker opprettet. Sender deg videre...', 'success');
      setTimeout(() => goTo(nextPath), 250);
    } catch {
      showStatus(status, 'Kunne ikke kontakte server.', 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Opprett bruker';
      }
    }
  });
}

function initAddListingPage() {
  const gate = document.getElementById('listing-gate');
  if (!gate) return;

  const rolePanel = document.getElementById('role-panel');
  const roleMessage = document.getElementById('role-selection-message');
  const roleInputs = Array.from(document.querySelectorAll('input[name="accountRole"]'));
  const listingCard = document.getElementById('listing-card');
  const listingForm = document.getElementById('listing-form');
  const sessionInfo = document.getElementById('session-info');
  const message = document.getElementById('listing-message');
  const logoutButton = document.getElementById('logout-btn');
  const gateLoginLink = document.getElementById('gate-login-link');
  const gateRegisterLink = document.getElementById('gate-register-link');
  const ownerNameInput = document.getElementById('owner-name');
  const ownerEmailInput = document.getElementById('owner-email');
  const listingSubmitBtn = listingForm ? listingForm.querySelector('button[type="submit"]') : null;

  const nextPath = './add-listing.html';
  if (gateLoginLink) gateLoginLink.href = `./login.html${nextQuery(nextPath)}`;
  if (gateRegisterLink) gateRegisterLink.href = `./register.html${nextQuery(nextPath)}`;

  function syncRoleCardStates() {
    roleInputs.forEach((input) => {
      const card = input.closest('.role-card');
      if (card) {
        card.classList.toggle('selected', input.checked);
      }
    });
  }

  function applyRole(currentUserEmail, role, persist = true) {
    const nextRole = sanitizeRole(role);

    if (persist && currentUserEmail) {
      setUserRole(currentUserEmail, nextRole);
    }

    roleInputs.forEach((input) => {
      input.checked = input.value === nextRole;
    });
    syncRoleCardStates();

    if (!nextRole) {
      if (listingCard) listingCard.hidden = true;
      showStatus(roleMessage, 'Velg rolle for å fortsette.', '');
      showStatus(message, '', '');
      return;
    }

    if (nextRole === 'customer') {
      if (listingCard) listingCard.hidden = true;
      showStatus(roleMessage, 'Kunde valgt. Du trenger ikke oppgi pris eller ventetid.', 'success');
      showStatus(message, '', '');
      return;
    }

    if (listingCard) listingCard.hidden = false;
    showStatus(roleMessage, 'Stringer valgt. Fyll inn pris, ventetid og detaljer under.', 'success');
  }

  async function initForAuthenticatedUser(user) {
    gate.hidden = true;
    if (rolePanel) rolePanel.hidden = false;
    if (logoutButton) logoutButton.hidden = false;
    if (sessionInfo) {
      sessionInfo.textContent = `Innlogget som ${user.email}.`;
    }

    if (ownerNameInput) {
      ownerNameInput.value = user.name || '';
      ownerNameInput.readOnly = true;
    }
    if (ownerEmailInput) {
      ownerEmailInput.value = user.email || '';
      ownerEmailInput.readOnly = true;
    }

    if (logoutButton) {
      logoutButton.addEventListener('click', async () => {
        await requestJson('/api/logout', { method: 'POST' });
        goTo('./login.html?next=./add-listing.html');
      });
    }

    const savedRole = getUserRole(user.email);
    applyRole(user.email, savedRole, false);

    roleInputs.forEach((input) => {
      input.addEventListener('change', () => {
        applyRole(user.email, input.value, true);
      });
    });

    if (!listingForm) return;

    listingForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      showStatus(message, '');

      const currentRole = getUserRole(user.email);
      if (currentRole !== 'stringer') {
        showStatus(message, 'Velg "Jeg er stringer" for å sende oppføring.', 'error');
        return;
      }

      const formData = new FormData(listingForm);
      const selectedSports = formData.getAll('sports').map((sport) => String(sport));
      const parsedPrice = parsePrice(formData.get('fromPrice'));

      if (selectedSports.length === 0) {
        showStatus(message, 'Velg minst én sport.', 'error');
        return;
      }

      if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
        showStatus(message, 'Skriv inn gyldig fra-pris (kun tall).', 'error');
        return;
      }

      const listing = {
        businessName: String(formData.get('businessName') || '').trim(),
        city: String(formData.get('city') || '').trim(),
        ownerName: String(formData.get('ownerName') || '').trim(),
        ownerEmail: normalizeEmail(formData.get('ownerEmail')),
        phone: String(formData.get('phone') || '').trim(),
        fromPrice: Math.round(parsedPrice),
        waitTime: String(formData.get('waitTime') || '').trim(),
        trustSignal: String(formData.get('trustSignal') || '').trim(),
        description: String(formData.get('description') || '').trim(),
        sports: selectedSports
      };

      if (!listing.businessName || !listing.city || !listing.phone) {
        showStatus(message, 'Fyll inn alle obligatoriske felt.', 'error');
        return;
      }

      if (listingSubmitBtn) {
        listingSubmitBtn.disabled = true;
        listingSubmitBtn.textContent = 'Lagrer oppføring...';
      }

      try {
        const { ok, data } = await requestJson('/api/stringers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(listing)
        });

        if (!ok) {
          showStatus(message, data.error || 'Kunne ikke lagre oppføring.', 'error');
          return;
        }

        showStatus(
          message,
          `Oppføring lagret for ${listing.city} (${listing.sports.join(', ')}). Den vises nå i Finn stringer.`,
          'success'
        );

        listingForm.reset();
        if (ownerNameInput) ownerNameInput.value = user.name || '';
        if (ownerEmailInput) ownerEmailInput.value = user.email || '';
      } catch {
        showStatus(message, 'Kunne ikke kontakte server.', 'error');
      } finally {
        if (listingSubmitBtn) {
          listingSubmitBtn.disabled = false;
          listingSubmitBtn.textContent = 'Send oppføring';
        }
      }
    });
  }

  getCurrentUser().then((user) => {
    if (!user) {
      gate.hidden = false;
      if (rolePanel) rolePanel.hidden = true;
      if (listingCard) listingCard.hidden = true;
      if (logoutButton) logoutButton.hidden = true;
      if (sessionInfo) sessionInfo.textContent = 'Ingen aktiv bruker.';
      return;
    }

    initForAuthenticatedUser(user);
  });
}

initLoginPage();
initRegisterPage();
initAddListingPage();
