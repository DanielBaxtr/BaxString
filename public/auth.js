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
  const roleHeading = document.getElementById('role-heading');
  const roleSubtitle = document.getElementById('role-subtitle');
  const roleGrid = document.getElementById('role-grid');
  const editProfileBtn = document.getElementById('edit-profile-btn');
  const roleMessage = document.getElementById('role-selection-message');
  const roleInputs = Array.from(document.querySelectorAll('input[name="accountRole"]'));
  const profileSummary = document.getElementById('profile-summary');
  const profileSummaryGrid = document.getElementById('profile-summary-grid');
  const listingCard = document.getElementById('listing-card');
  const listingForm = document.getElementById('listing-form');
  const sessionInfo = document.getElementById('session-info');
  const message = document.getElementById('listing-message');
  const gateLoginLink = document.getElementById('gate-login-link');
  const gateRegisterLink = document.getElementById('gate-register-link');
  const ownerNameInput = document.getElementById('owner-name');
  const ownerEmailInput = document.getElementById('owner-email');
  const listingSubmitBtn = listingForm ? listingForm.querySelector('button[type="submit"]') : null;

  const nextPath = './add-listing.html';
  if (gateLoginLink) gateLoginLink.href = `./login.html${nextQuery(nextPath)}`;
  if (gateRegisterLink) gateRegisterLink.href = `./register.html${nextQuery(nextPath)}`;

  let currentUser = null;
  let currentListing = null;
  let isEditing = false;

  function syncRoleCardStates() {
    roleInputs.forEach((input) => {
      const card = input.closest('.role-card');
      if (card) {
        card.classList.toggle('selected', input.checked);
      }
    });
  }

  async function fetchMyListing() {
    const { ok, status, data } = await requestJson('/api/my-stringer');
    if (ok && data?.stringer) return data.stringer;
    if (status === 404) return null;
    throw new Error(data?.error || 'Kunne ikke hente oppføringen din.');
  }

  function setRolePanelText(role, editingMode) {
    if (!roleHeading || !roleSubtitle) return;

    if (!role) {
      roleHeading.textContent = 'Velg rolle';
      roleSubtitle.textContent = 'Før vi spør om pris og ventetid må du velge om du er stringer eller kunde.';
      return;
    }

    roleHeading.textContent = 'Din rolle';

    if (editingMode) {
      roleSubtitle.textContent = 'Du kan endre rolle eller oppdatere oppføringen din under.';
      return;
    }

    if (role === 'stringer') {
      roleSubtitle.textContent = 'Stringer-profilen din er lagret. Trykk "Gjør endringer" for å oppdatere.';
      return;
    }

    roleSubtitle.textContent = 'Du er registrert som kunde. Trykk "Gjør endringer" om du vil bytte rolle.';
  }

  function setFormValuesFromListing(listing) {
    if (!listingForm || !listing) return;

    if (listingForm.elements.businessName) listingForm.elements.businessName.value = listing.businessName || '';
    if (listingForm.elements.city) listingForm.elements.city.value = listing.city || '';
    if (listingForm.elements.phone) listingForm.elements.phone.value = listing.phone || '';
    if (listingForm.elements.fromPrice) listingForm.elements.fromPrice.value = String(listing.fromPrice || '');
    if (listingForm.elements.waitTime) listingForm.elements.waitTime.value = listing.waitTime || '';
    if (listingForm.elements.trustSignal) listingForm.elements.trustSignal.value = listing.trustSignal || '';
    if (listingForm.elements.description) listingForm.elements.description.value = listing.description || '';

    const selectedSports = Array.isArray(listing.sports) ? listing.sports : [];
    const sportInputs = Array.from(listingForm.querySelectorAll('input[name="sports"]'));
    sportInputs.forEach((input) => {
      input.checked = selectedSports.includes(input.value);
    });
  }

  function renderSummaryItem(label, value) {
    if (!profileSummaryGrid) return;
    const item = document.createElement('article');
    item.className = 'summary-item';

    const itemLabel = document.createElement('p');
    itemLabel.className = 'summary-label';
    itemLabel.textContent = label;

    const itemValue = document.createElement('p');
    itemValue.className = 'summary-value';
    itemValue.textContent = value;

    item.append(itemLabel, itemValue);
    profileSummaryGrid.appendChild(item);
  }

  function renderListingSummary(listing) {
    if (!profileSummaryGrid) return;
    profileSummaryGrid.innerHTML = '';

    if (!listing) return;

    const sportsText = Array.isArray(listing.sports) && listing.sports.length > 0 ? listing.sports.join(', ') : 'Ikke valgt';

    renderSummaryItem('Profilnavn', listing.businessName || '-');
    renderSummaryItem('By', listing.city || '-');
    renderSummaryItem('Fra-pris', Number.isFinite(Number(listing.fromPrice)) ? `${Number(listing.fromPrice)} kr` : '-');
    renderSummaryItem('Ventetid', listing.waitTime || '-');
    renderSummaryItem('Sporter', sportsText);
    renderSummaryItem('Tillitssignal', listing.trustSignal || '-');
    renderSummaryItem('Telefon', listing.phone || '-');
    renderSummaryItem('Beskrivelse', listing.description || 'Ingen beskrivelse');
  }

  function setViewMode(role) {
    isEditing = false;
    if (roleGrid) roleGrid.hidden = true;
    if (listingCard) listingCard.hidden = true;
    if (editProfileBtn) {
      editProfileBtn.hidden = !role;
      editProfileBtn.textContent = 'Gjør endringer';
    }

    setRolePanelText(role, false);
    applyRole(currentUser?.email, role, false);

    if (role === 'stringer' && currentListing) {
      if (profileSummary) profileSummary.hidden = false;
      renderListingSummary(currentListing);
      showStatus(roleMessage, 'Rolle: Stringer', 'success');
      return;
    }

    if (profileSummary) profileSummary.hidden = true;

    if (role === 'customer') {
      showStatus(roleMessage, 'Rolle: Kunde', 'success');
      return;
    }

    showStatus(roleMessage, 'Velg rolle for å fortsette.', '');
  }

  function setEditMode(role) {
    isEditing = true;
    if (roleGrid) roleGrid.hidden = false;
    if (profileSummary) profileSummary.hidden = true;
    if (editProfileBtn) {
      editProfileBtn.hidden = false;
      editProfileBtn.textContent = 'Avbryt';
    }

    setRolePanelText(role, true);
    applyRole(currentUser?.email, role, false);
    if (role === 'stringer' && currentListing) {
      setFormValuesFromListing(currentListing);
    }
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
      showStatus(roleMessage, isEditing ? 'Kunde valgt. Du trenger ikke oppgi pris eller ventetid.' : 'Rolle: Kunde', 'success');
      showStatus(message, '', '');
      return;
    }

    if (listingCard) listingCard.hidden = !isEditing;
    showStatus(
      roleMessage,
      isEditing ? 'Stringer valgt. Fyll inn pris, ventetid og detaljer under.' : 'Rolle: Stringer',
      'success'
    );
  }

  async function initForAuthenticatedUser(user) {
    currentUser = user;
    gate.hidden = true;
    if (rolePanel) rolePanel.hidden = false;
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

    let savedRole = getUserRole(user.email);

    try {
      currentListing = await fetchMyListing();
    } catch (error) {
      currentListing = null;
      showStatus(roleMessage, error.message || 'Kunne ikke hente oppføringen din.', 'error');
    }

    if (!savedRole && currentListing) {
      savedRole = 'stringer';
      setUserRole(user.email, savedRole);
    }

    roleInputs.forEach((input) => {
      input.addEventListener('change', () => {
        const nextRole = sanitizeRole(input.value);
        applyRole(user.email, nextRole, true);

        if (!nextRole) {
          setRolePanelText('', true);
          return;
        }

        if (nextRole === 'stringer' && currentListing) {
          setFormValuesFromListing(currentListing);
        }

        setRolePanelText(nextRole, true);
      });
    });

    if (editProfileBtn) {
      editProfileBtn.addEventListener('click', () => {
        const currentRole = getUserRole(user.email);
        if (isEditing) {
          setViewMode(currentRole);
          return;
        }
        setEditMode(currentRole);
      });
    }

    if (!savedRole) {
      isEditing = true;
      if (editProfileBtn) editProfileBtn.hidden = true;
      if (roleGrid) roleGrid.hidden = false;
      setRolePanelText('', true);
      applyRole(user.email, '', false);
    } else if (savedRole === 'stringer' && !currentListing) {
      setEditMode(savedRole);
      if (editProfileBtn) editProfileBtn.hidden = true;
      showStatus(roleMessage, 'Rolle: Stringer. Fyll inn oppføringsdetaljer under.', 'success');
    } else {
      if (savedRole === 'stringer' && currentListing) {
        setFormValuesFromListing(currentListing);
      }
      setViewMode(savedRole);
    }

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

        try {
          currentListing = await fetchMyListing();
        } catch {
          currentListing = {
            ...listing,
            ownerName: user.name,
            ownerEmail: user.email
          };
        }

        showStatus(message, 'Oppføring lagret. Den vises nå i Finn stringer.', 'success');
        setUserRole(user.email, 'stringer');
        setViewMode('stringer');
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
      if (profileSummary) profileSummary.hidden = true;
      if (sessionInfo) sessionInfo.textContent = 'Ingen aktiv bruker.';
      return;
    }

    initForAuthenticatedUser(user);
  });
}

initLoginPage();
initRegisterPage();
initAddListingPage();
