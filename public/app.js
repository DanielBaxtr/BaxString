const form = document.getElementById('booking-form');
const tensionInput = document.getElementById('tension-input');
const tensionDisplay = document.getElementById('tension-display');
const priceSummary = document.getElementById('price-summary');
const messageEl = document.getElementById('form-message');
const submitBtn = document.getElementById('submit-btn');

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
    <strong>Price summary</strong>
    <div>Restringing labor: NOK ${LABOR_NOK.toFixed(2)}</div>
    <div>String material: NOK ${stringCharge.toFixed(2)}</div>
    <div class="total">Total: NOK ${total.toFixed(2)}</div>
  `;
}

function updateTensionLabel() {
  tensionDisplay.textContent = Number(tensionInput.value).toFixed(1);
}

function showMessage(text, isError = false) {
  messageEl.textContent = text;
  messageEl.classList.toggle('error', isError);
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

  submitBtn.disabled = true;
  submitBtn.textContent = 'Sender booking...';

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
      throw new Error(data.error || 'Unable to create booking.');
    }

    if (data.redirectUrl) {
      window.location.href = data.redirectUrl;
      return;
    }

    window.location.href = `./complete.html?reference=${encodeURIComponent(data.reference)}`;
  } catch (error) {
    if (error instanceof TypeError) {
      showMessage('Load failed. Start serveren med "npm start" og åpne siden fra http://localhost:3000', true);
    } else {
      showMessage(error.message, true);
    }
    submitBtn.disabled = false;
    submitBtn.textContent = 'Send booking';
  }
});

updateTensionLabel();
updatePriceSummary();
