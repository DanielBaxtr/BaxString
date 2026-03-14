const contactForm = document.getElementById('contact-form');
const contactStatus = document.getElementById('contact-status');
const contactSubmit = document.getElementById('contact-submit');

function setContactStatus(message, type = '') {
  if (!contactStatus) return;
  contactStatus.textContent = message;
  contactStatus.classList.remove('error', 'success');
  if (type) contactStatus.classList.add(type);
}

if (contactForm) {
  contactForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setContactStatus('');

    const formData = new FormData(contactForm);
    const payload = {
      name: String(formData.get('name') || '').trim(),
      email: String(formData.get('email') || '').trim(),
      message: String(formData.get('message') || '').trim()
    };

    if (!payload.name || !payload.email || !payload.message) {
      setContactStatus('Fyll ut navn, e-post og melding.', 'error');
      return;
    }

    if (contactSubmit) {
      contactSubmit.disabled = true;
      contactSubmit.textContent = 'Sender...';
    }

    try {
      const response = await fetch('/api/contact', {
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
        setContactStatus(data.error || 'Kunne ikke sende melding.', 'error');
        return;
      }

      contactForm.reset();
      setContactStatus('Takk! Meldingen din er sendt.', 'success');
    } catch {
      setContactStatus('Kunne ikke kontakte server. Prøv igjen.', 'error');
    } finally {
      if (contactSubmit) {
        contactSubmit.disabled = false;
        contactSubmit.textContent = 'Send melding';
      }
    }
  });
}
