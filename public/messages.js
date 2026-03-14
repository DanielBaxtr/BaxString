const referenceInput = document.getElementById('reference-input');
const loadThreadBtn = document.getElementById('load-thread-btn');
const threadStatus = document.getElementById('thread-status');
const threadPanel = document.getElementById('thread-panel');
const bookingSummary = document.getElementById('booking-summary');
const acceptedBox = document.getElementById('accepted-box');
const messagesList = document.getElementById('messages-list');

const messageForm = document.getElementById('message-form');
const sendMessageBtn = document.getElementById('send-message-btn');
const sendStatus = document.getElementById('send-status');

const acceptForm = document.getElementById('accept-form');
const acceptBtn = document.getElementById('accept-btn');
const acceptStatus = document.getElementById('accept-status');

let activeReference = '';

function setStatus(el, message, type = '') {
  if (!el) return;
  el.textContent = message;
  el.classList.remove('error', 'success');
  if (type) el.classList.add(type);
}

function sanitizeReference(value) {
  return String(value || '').trim().toUpperCase();
}

function formatDateTime(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString('no-NO');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderAccepted(thread) {
  if (!acceptedBox) return;

  if (!thread.accepted) {
    acceptedBox.hidden = true;
    acceptedBox.textContent = '';
    return;
  }

  const parts = [`Booking akseptert av ${thread.acceptedBy || 'Stringr'}`];
  if (Number.isFinite(Number(thread.finalPriceNok))) parts.push(`Pris: NOK ${Number(thread.finalPriceNok)}`);
  if (thread.meetingPoint) parts.push(`Møtepunkt: ${thread.meetingPoint}`);
  if (thread.acceptedAt) parts.push(`Tid: ${formatDateTime(thread.acceptedAt)}`);

  acceptedBox.textContent = parts.join(' | ');
  acceptedBox.hidden = false;
}

function renderMessages(messages) {
  if (!messagesList) return;

  if (!Array.isArray(messages) || messages.length === 0) {
    messagesList.innerHTML = '<p class="message">Ingen meldinger ennå.</p>';
    return;
  }

  messagesList.innerHTML = messages
    .map((item) => {
      const roleLabel = item.senderRole === 'stringr' ? 'Stringr' : 'Kunde';
      const chips = [];
      if (Number.isFinite(Number(item.proposedPriceNok))) {
        chips.push(`<span class="meta-chip">Foreslått pris: NOK ${Number(item.proposedPriceNok)}</span>`);
      }
      if (item.meetingPoint) {
        chips.push(`<span class="meta-chip">Møtepunkt: ${escapeHtml(item.meetingPoint)}</span>`);
      }

      return `
        <article class="message-item">
          <div class="message-head">
            <strong>${escapeHtml(item.senderName || 'Ukjent')}</strong>
            <span class="role-pill">${roleLabel}</span>
            <span>${formatDateTime(item.createdAt)}</span>
          </div>
          <p class="message-body">${escapeHtml(item.message || '')}</p>
          ${chips.length > 0 ? `<div class="meta-line">${chips.join('')}</div>` : ''}
        </article>
      `;
    })
    .join('');
}

async function loadThread(reference) {
  const ref = sanitizeReference(reference);
  if (!ref) {
    setStatus(threadStatus, 'Skriv inn bookingreferanse.', 'error');
    return;
  }

  activeReference = ref;
  referenceInput.value = ref;
  setStatus(threadStatus, 'Laster tråd...');

  try {
    const response = await fetch(`/api/bookings/${encodeURIComponent(ref)}/messages`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Kunne ikke hente meldinger.');
    }

    threadPanel.hidden = false;
    bookingSummary.innerHTML = `
      <strong>Bookingreferanse:</strong> ${escapeHtml(data.reference)}<br />
      <strong>Kunde:</strong> ${escapeHtml(data.booking?.customerName || '-')}
    `;

    renderAccepted(data);
    renderMessages(data.messages || []);
    setStatus(threadStatus, 'Tråd lastet.', 'success');

    const next = new URL(window.location.href);
    next.searchParams.set('reference', ref);
    window.history.replaceState({}, '', next.toString());
  } catch (error) {
    threadPanel.hidden = true;
    setStatus(threadStatus, error.message || 'Kunne ikke hente tråd.', 'error');
  }
}

async function postMessage(event) {
  event.preventDefault();
  if (!activeReference) {
    setStatus(sendStatus, 'Åpne en bookingtråd først.', 'error');
    return;
  }

  const formData = new FormData(messageForm);
  const payload = {
    senderName: String(formData.get('senderName') || '').trim(),
    senderRole: String(formData.get('senderRole') || '').trim().toLowerCase(),
    message: String(formData.get('message') || '').trim(),
    meetingPoint: String(formData.get('meetingPoint') || '').trim(),
    proposedPriceNok: String(formData.get('proposedPriceNok') || '').trim()
  };

  if (!payload.senderName || !payload.senderRole || !payload.message) {
    setStatus(sendStatus, 'Fyll ut navn, rolle og melding.', 'error');
    return;
  }

  if (sendMessageBtn) {
    sendMessageBtn.disabled = true;
    sendMessageBtn.textContent = 'Sender...';
  }

  try {
    const response = await fetch(`/api/bookings/${encodeURIComponent(activeReference)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Kunne ikke sende melding.');
    }

    messageForm.reset();
    setStatus(sendStatus, 'Melding sendt.', 'success');
    await loadThread(activeReference);
  } catch (error) {
    setStatus(sendStatus, error.message || 'Kunne ikke sende melding.', 'error');
  } finally {
    if (sendMessageBtn) {
      sendMessageBtn.disabled = false;
      sendMessageBtn.textContent = 'Send melding';
    }
  }
}

async function acceptBooking(event) {
  event.preventDefault();
  if (!activeReference) {
    setStatus(acceptStatus, 'Åpne en bookingtråd først.', 'error');
    return;
  }

  const formData = new FormData(acceptForm);
  const payload = {
    acceptedBy: String(formData.get('acceptedBy') || '').trim(),
    finalPriceNok: String(formData.get('finalPriceNok') || '').trim(),
    meetingPoint: String(formData.get('meetingPoint') || '').trim()
  };

  if (!payload.acceptedBy) {
    setStatus(acceptStatus, 'Skriv inn navn før du aksepterer.', 'error');
    return;
  }

  if (acceptBtn) {
    acceptBtn.disabled = true;
    acceptBtn.textContent = 'Lagrer...';
  }

  try {
    const response = await fetch(`/api/bookings/${encodeURIComponent(activeReference)}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Kunne ikke akseptere booking.');
    }

    setStatus(acceptStatus, 'Booking markert som akseptert.', 'success');
    await loadThread(activeReference);
  } catch (error) {
    setStatus(acceptStatus, error.message || 'Kunne ikke akseptere booking.', 'error');
  } finally {
    if (acceptBtn) {
      acceptBtn.disabled = false;
      acceptBtn.textContent = 'Aksepter booking';
    }
  }
}

if (loadThreadBtn) {
  loadThreadBtn.addEventListener('click', () => loadThread(referenceInput.value));
}

if (messageForm) {
  messageForm.addEventListener('submit', postMessage);
}

if (acceptForm) {
  acceptForm.addEventListener('submit', acceptBooking);
}

const params = new URLSearchParams(window.location.search);
const prefilledReference = sanitizeReference(params.get('reference'));
if (prefilledReference) {
  loadThread(prefilledReference);
}
