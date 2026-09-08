(() => {
  const params = new URLSearchParams(location.search);
  const eventName = (params.get('event') || '').replace(/\s+/g, ' ').trim();
  const kiosk = params.get('kiosk') === '1';
  const form = document.getElementById('check-in-form');
  const fields = document.getElementById('guest-fields');
  const name = document.getElementById('guest-name');
  const email = document.getElementById('guest-email');
  const phone = document.getElementById('guest-phone');
  const button = document.getElementById('submit-button');
  const availability = document.getElementById('availability');
  const error = document.getElementById('submit-error');
  const entry = document.getElementById('entry');
  const confirmation = document.getElementById('confirmation');
  let busy = false;
  let available = false;
  let resetTimer;

  function reset() {
    clearTimeout(resetTimer);
    form.reset();
    email.setCustomValidity('');
    phone.setCustomValidity('');
    name.setCustomValidity('');
    error.hidden = true;
    confirmation.hidden = true;
    entry.hidden = false;
    name.focus();
  }

  function armReset(delay) {
    if (!kiosk) return;
    clearTimeout(resetTimer);
    resetTimer = setTimeout(reset, delay);
  }

  for (const action of ['input', 'click']) {
    form.addEventListener(action, () => {
      email.setCustomValidity('');
      phone.setCustomValidity('');
      name.setCustomValidity('');
      if (!error.hidden && !busy) armReset(30000);
    });
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!available || busy) return;
    error.hidden = true;
    const guest = {
      name: name.value.trim(), email: email.value.trim(), phone: phone.value.trim(),
      eventName, website: document.getElementById('website').value
    };
    name.setCustomValidity(guest.name.length < 2 ? 'Please enter your full name.' : '');
    email.setCustomValidity(!guest.email && !guest.phone ? 'Please enter an email or phone number.' : '');
    const digits = guest.phone.replace(/\D/g, '');
    phone.setCustomValidity(guest.phone && (!/^[+\d\s().-]+$/.test(guest.phone) || digits.length < 7 || digits.length > 15) ? 'Please enter a valid phone number.' : '');
    if (!form.reportValidity()) return;
    clearTimeout(resetTimer);
    busy = true;
    fields.disabled = true;
    button.textContent = 'Signing in...';
    try {
      const response = await fetch('/api/event-check-in', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(guest),
        signal: AbortSignal.timeout(45000)
      });
      const result = await response.json().catch(() => { throw new TypeError('Unreadable response'); });
      if (!response.ok || result?.ok !== true) throw new Error(typeof result?.error === 'string' ? result.error : 'We could not complete your sign-in. Please try again or speak with the event host.');
      form.reset();
      entry.hidden = true;
      confirmation.hidden = false;
      document.getElementById('kiosk-note').hidden = !kiosk;
      document.getElementById('confirmation-title').focus();
      armReset(8000);
    } catch (failure) {
      error.textContent = failure.name === 'TimeoutError' || failure instanceof TypeError
        ? 'The connection was interrupted. Please ask the event host to check your sign-in before trying again.'
        : failure.message;
      error.hidden = false;
      armReset(30000);
    } finally {
      busy = false;
      fields.disabled = false;
      button.innerHTML = 'Sign in <span aria-hidden="true">&rarr;</span>';
    }
  });
  document.getElementById('next-guest').addEventListener('click', reset);
  if (kiosk) {
    form.autocomplete = 'off';
    for (const input of form.querySelectorAll('input')) input.autocomplete = 'off';
  }

  if (!eventName || eventName.length > 120) {
    availability.textContent = 'Please use the QR code for this event, or ask the event host for the sign-in link.';
    return;
  }
  document.getElementById('event-title').textContent = eventName;
  document.title = `${eventName} | Bogabee event sign-in`;
  fetch('/api/event-check-in', { signal: AbortSignal.timeout(8000), cache: 'no-store' })
    .then(response => { if (!response.ok) throw new Error(); return response.json(); })
    .then(result => {
      if (result.available !== true) throw new Error();
      available = true;
      fields.disabled = false;
      availability.hidden = true;
    })
    .catch(() => { availability.textContent = 'Event sign-in is not available yet. Please speak with the event host.'; });
})();
