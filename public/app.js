const form = document.getElementById('booking-form');
const tensionInput = document.getElementById('tension-input');
const tensionDisplay = document.getElementById('tension-display');
const priceSummary = document.getElementById('price-summary');
const messageEl = document.getElementById('form-message');
const submitBtn = document.getElementById('submit-btn');
const searchContext = document.getElementById('search-context');
const stringerContext = document.getElementById('stringer-context');
const selectedStringerInput = document.getElementById('selected-stringer');
const selectedPriceInput = document.getElementById('selected-price');
const selectedWaitInput = document.getElementById('selected-wait');

const LABOR_NOK = 175;
const STRING_NOK = 125;

function currentHasOwnString() {
  return form.elements.hasOwnString.value === 'yes';
}

function updatePriceSummary() {
  const hasOwnString = currentHasOwnString();
  const stringCharge = hasOwnString ? 0 : STRING_NOK;
  const total = LABOR_NOK + stringCharge;

  priceSummary.innerHTML = `
    <strong>Prissammendrag</strong>
    <div>Arbeid: NOK ${LABOR_NOK.toFixed(2)}</div>
    <div>Strengemateriale: NOK ${stringCharge.toFixed(2)}</div>
    <div class="total">Totalt: NOK ${total.toFixed(2)}</div>
  `;
}

function updateTensionLabel() {
  tensionDisplay.textContent = Number(tensionInput.value).toFixed(1);
}

function showMessage(text, isError = false) {
  messageEl.textContent = text;
  messageEl.classList.toggle('error', isError);
}

function renderSearchContext() {
  if (!searchContext) {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const location = params.get('location');
  const sport = params.get('sport');

  if (!location && !sport) {
    searchContext.textContent = '';
    return;
  }

  const parts = [];
  if (sport) parts.push(sport);
  if (location) parts.push(location);
  searchContext.textContent = `Valgt: ${parts.join(' i ')}`;
}

function renderSelectedStringerContext() {
  if (!stringerContext || !selectedStringerInput || !selectedPriceInput || !selectedWaitInput) {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const location = params.get('location') || '';
  const sport = params.get('sport') || '';
  const stringer = params.get('stringer') || '';
  const price = params.get('price') || '';
  const wait = params.get('wait') || '';

  selectedStringerInput.value = stringer;
  selectedPriceInput.value = price;
  selectedWaitInput.value = wait;

  if (!stringer) {
    const fallbackParams = new URLSearchParams();
    if (location) fallbackParams.set('location', location);
    if (sport) fallbackParams.set('sport', sport);
    const pickerUrl = `./stringers.html?${fallbackParams.toString()}`;
    stringerContext.innerHTML = `Du må velge stringer først. <a href="${pickerUrl}">Gå til valg av stringer</a>.`;
    showMessage('Velg stringer før du sender bestilling.', true);
    submitBtn.disabled = true;
    submitBtn.textContent = 'Velg stringer først';
    return;
  }

  const details = [];
  if (price) details.push(`fra NOK ${price}`);
  if (wait) details.push(`ventetid ${wait}`);
  const detailText = details.length > 0 ? ` (${details.join(', ')})` : '';
  stringerContext.textContent = `Valgt stringer: ${stringer}${detailText}`;
  submitBtn.disabled = false;
  submitBtn.textContent = 'Send bestilling';
  showMessage('');
}

form.addEventListener('change', () => {
  updatePriceSummary();
  updateTensionLabel();
});

tensionInput.addEventListener('input', updateTensionLabel);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showMessage('');

  const formData = new FormData(form);
  const payload = {
    customerName: formData.get('customerName'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    racketModel: formData.get('racketModel'),
    tensionKg: Number(formData.get('tensionKg')),
    hasOwnString: formData.get('hasOwnString') === 'yes',
    notes: formData.get('notes')
  };

  const selectedStringer = String(formData.get('selectedStringer') || '').trim();
  const selectedPrice = String(formData.get('selectedPrice') || '').trim();
  const selectedWait = String(formData.get('selectedWait') || '').trim();

  if (!selectedStringer) {
    showMessage('Du må velge stringer før du sender bestilling.', true);
    return;
  }

  const systemNoteParts = [`Valgt stringer: ${selectedStringer}`];
  if (selectedPrice) systemNoteParts.push(`fra NOK ${selectedPrice}`);
  if (selectedWait) systemNoteParts.push(`ventetid ${selectedWait}`);
  const userNotes = String(formData.get('notes') || '').trim();
  payload.notes = [systemNoteParts.join(', '), userNotes].filter(Boolean).join('\n');

  submitBtn.disabled = true;
  submitBtn.textContent = 'Sender bestilling...';

  try {
    const response = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (!response.ok) {
      throw new Error(data.error || 'Kunne ikke opprette bestilling.');
    }

    if (data.redirectUrl) {
      window.location.href = data.redirectUrl;
      return;
    }

    window.location.href = `./complete.html?reference=${encodeURIComponent(data.reference)}`;
  } catch (error) {
    if (error instanceof TypeError) {
      showMessage('Kunne ikke laste. Start serveren med "npm start" og åpne siden fra http://localhost:3000', true);
    } else {
      showMessage(error.message, true);
    }
    submitBtn.disabled = false;
    submitBtn.textContent = 'Send bestilling';
  }
});

updateTensionLabel();
updatePriceSummary();
renderSearchContext();
renderSelectedStringerContext();
