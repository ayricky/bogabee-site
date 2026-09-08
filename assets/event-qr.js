(() => {
  const form = document.getElementById('qr-form');
  const input = document.getElementById('event-name');
  const error = document.getElementById('qr-error');
  let svg = '';
  let currentEvent = '';
  let generation = 0;
  async function generate() {
    const version = ++generation;
    currentEvent = input.value.replace(/\s+/g, ' ').trim();
    input.setCustomValidity(currentEvent ? '' : 'Please enter the event name.');
    if (!form.reportValidity()) return;
    error.hidden = true;
    try {
      const url = new URL('/event/', location.origin);
      url.searchParams.set('event', currentEvent);
      const qr = qrcode(0, 'M');
      qr.addData(url.href);
      qr.make();
      svg = qr.createSvgTag({ cellSize: 6, margin: 24, scalable: true, alt: 'Scan to sign in to this event' });
      document.getElementById('qr-image').innerHTML = svg;
      document.getElementById('poster-event').textContent = currentEvent;
      const link = document.getElementById('guest-link');
      link.href = url.href;
      link.textContent = url.href;
      url.searchParams.set('kiosk', '1');
      document.getElementById('kiosk-link').href = url.href;
      document.getElementById('poster').hidden = false;
      document.getElementById('qr-actions').hidden = false;
      const notice = document.getElementById('qr-availability');
      notice.textContent = 'Checking sign-in availability...';
      try {
        const response = await fetch('/api/event-check-in', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
        const result = await response.json();
        if (!response.ok || result.available !== true) throw new Error();
        if (version === generation) notice.textContent = 'Open the sign-in link and verify a test guest is saved before using this QR at an event.';
      } catch {
        if (version === generation) notice.textContent = 'This is a preview. Sign-in is not connected yet. Test the live link before printing for an event.';
      }
    } catch {
      error.textContent = 'Could not create the QR code. Please reload the page and try again.';
      error.hidden = false;
    }
  }
  form.addEventListener('submit', event => { event.preventDefault(); generate(); });
  input.addEventListener('input', () => {
    input.setCustomValidity('');
    document.getElementById('poster').hidden = true;
    document.getElementById('qr-actions').hidden = true;
  });
  document.getElementById('print-qr').addEventListener('click', () => window.print());
  document.getElementById('download-qr').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `bogabee-${currentEvent.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event'}.svg`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const eventName = new URLSearchParams(location.search).get('event');
  if (eventName && eventName.length <= 120) { input.value = eventName; generate(); }
})();
